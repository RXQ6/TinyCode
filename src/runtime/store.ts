import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { orderedEvents, replayRun } from '../core/agent';
import { RunError } from '../core/contracts';
import type { AgentEvent, RunId, RunLog, RunRecord, Session, SessionId, SessionStore } from '../core/contracts';
import { decodeEvent, decodeSession } from '../adapters/codec';
import { sanitize } from './redact';

function validId(id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new RunError('runtime_error', '运行或会话 ID 无效。');
  return id;
}
function missing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }
export class JsonStore implements SessionStore, RunLog {
  private readonly locks = new Map<string, Promise<void>>();
  constructor(private readonly directory: string) {}
  private file(id: string, kind: 'sessions' | 'runs'): string { return path.join(this.directory, kind, `${validId(id)}.${kind === 'runs' ? 'jsonl' : 'json'}`); }
  async createSession(): Promise<Session> {
    const session: Session = { id: randomUUID() as SessionId, createdAt: Date.now(), runs: [] };
    await this.saveSession(session); return session;
  }
  async loadSession(id: SessionId): Promise<Session | undefined> {
    try { return decodeSession(JSON.parse(await readFile(this.file(id, 'sessions'), 'utf8')) as unknown); }
    catch (error) { if (missing(error)) return undefined; throw error; }
  }
  async saveSession(session: Session): Promise<void> {
    await mkdir(path.join(this.directory, 'sessions'), { recursive: true });
    const file = this.file(session.id, 'sessions'); const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(sanitize(session)), 'utf8'); await rename(temp, file);
  }
  async appendEvent(event: AgentEvent): Promise<void> {
    const previous = this.locks.get(event.runId) ?? Promise.resolve();
    const pending = previous.then(async () => {
      await mkdir(path.join(this.directory, 'runs'), { recursive: true });
      const existing = await this.listEvents(event.runId);
      const duplicate = existing.find(e => e.sequence === event.sequence);
      const clean = decodeEvent(sanitize(event));
      if (duplicate) {
        if (JSON.stringify(duplicate) === JSON.stringify(clean)) return;
        throw new RunError('runtime_error', '不能覆盖已有事件序号。');
      }
      if (event.sequence !== existing.length + 1) throw new RunError('runtime_error', '事件序号不连续。');
      if (existing.some(e => ['run_completed', 'run_failed', 'run_cancelled'].includes(e.type))) throw new RunError('runtime_error', '终态后不能追加事件。');
      await appendFile(this.file(event.runId, 'runs'), JSON.stringify(clean) + '\n', { encoding: 'utf8', flush: true });
    });
    this.locks.set(event.runId, pending);
    try { await pending; } finally { if (this.locks.get(event.runId) === pending) this.locks.delete(event.runId); }
  }
  async listEvents(runId: RunId): Promise<AgentEvent[]> {
    let raw: string;
    try { raw = await readFile(this.file(runId, 'runs'), 'utf8'); }
    catch (error) { if (missing(error)) return []; throw error; }
    try {
      const events = orderedEvents(raw.split('\n').filter(Boolean).map(line => decodeEvent(JSON.parse(line) as unknown)));
      if (events.some((e, index) => e.runId !== runId || e.sequence !== index + 1)) throw new Error('sequence');
      return events;
    } catch { throw new RunError('runtime_error', '运行日志损坏或截断；保留原文件，不能安全自动恢复。'); }
  }
  async loadRun(runId: RunId): Promise<RunRecord | undefined> { return replayRun(await this.listEvents(runId)); }
  async listRuns(): Promise<RunRecord[]> {
    let files: string[];
    try { files = await readdir(path.join(this.directory, 'runs')); }
    catch (error) { if (missing(error)) return []; throw error; }
    const runs = await Promise.all(files.filter(f => f.endsWith('.jsonl')).map(f => this.loadRun(f.slice(0, -6) as RunId)));
    return runs.filter((r): r is RunRecord => r !== undefined).sort((a, b) => b.startedAt - a.startedAt);
  }
}
