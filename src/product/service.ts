import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { OfflineCartModel, ScriptedModel } from '../adapters/offline';
import type { AgentEvent, ModelPort, RunId, RunRecord } from '../core/contracts';
import { AgentRuntime } from '../runtime/runtime';
import { JsonStore } from '../runtime/store';
import { sanitize } from '../runtime/redact';
import { WorkspaceTools } from '../tools/workspace';
import { createDemoWorkspace } from './demo-workspace';
import type { StartRequest } from './contracts';

export const startSchema = z.object({ root: z.string().min(1).max(1000), task: z.string().min(1).max(8000), mode: z.enum(['offline', 'pi']), allowWrites: z.boolean(), testFiles: z.array(z.string().min(1).max(1000)).min(1).max(20) }).strict();
export const idSchema = z.string().uuid();
export class WorkbenchService {
  readonly store: JsonStore;
  private active: { id: RunId; controller: AbortController; done: Promise<void> } | undefined;
  private starting = false;
  private readonly allowedRoots = new Set<string>();
  constructor(readonly directory: string, private readonly broadcast: (event: AgentEvent) => void) { this.store = new JsonStore(path.join(directory, 'store')); }
  authorizeRoot(root: string): void { this.allowedRoots.add(path.resolve(root).toLowerCase()); }
  async demo(): Promise<string> {
    const root = await createDemoWorkspace(path.join(this.directory, 'demo', `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`));
    this.authorizeRoot(root); return root;
  }
  private async model(mode: StartRequest['mode']): Promise<ModelPort> {
    if (mode === 'offline') return new OfflineCartModel();
    const { PiModelAdapter } = await import('../adapters/pi');
    return new PiModelAdapter(path.join(this.directory, 'sdk'));
  }
  private runtime(request: StartRequest, model: ModelPort): AgentRuntime {
    return new AgentRuntime(this.store, model, new WorkspaceTools({ root: request.root, allowWrites: request.allowWrites, testFiles: request.testFiles }));
  }
  private ensureAvailable(): void { if (this.active || this.starting) throw new Error('已有任务正在运行，请等待完成或先取消。'); }
  async start(raw: unknown): Promise<RunId> {
    this.ensureAvailable();
    this.starting = true;
    try {
    const request = startSchema.parse(raw);
    if (!this.allowedRoots.has(path.resolve(request.root).toLowerCase())) throw new Error('请通过选择目录或创建演示项目授权工作目录。');
    const reference = path.resolve('D:/tinyCode').toLowerCase();
    const root = path.resolve(request.root).toLowerCase();
    if (request.allowWrites && (root === reference || root.startsWith(reference + path.sep))) throw new Error('D:/tinyCode 是只读参考仓库，请选择独立的工作目录。');
    const model = await this.model(request.mode);
    const controller = new AbortController();
    const stream = this.runtime(request, model).run({ input: request.task, requirePassingTests: true }, controller.signal);
    return await this.dispatch(stream, controller, request);
    } finally { this.starting = false; }
  }
  private async dispatch(stream: AsyncGenerator<AgentEvent>, controller: AbortController, request?: StartRequest): Promise<RunId> {
    const first = await stream.next();
    if (first.done) throw new Error('运行未生成事件。');
    const runId = first.value.runId;
    if (request) {
      await mkdir(path.join(this.directory, 'context'), { recursive: true });
      try { await writeFile(path.join(this.directory, 'context', `${runId}.json`), JSON.stringify(sanitize(request))); }
      catch (error) { controller.abort(); await stream.return(undefined); throw error; }
    }
    this.broadcast(first.value);
    const done = (async (): Promise<void> => {
      try { for await (const event of stream) this.broadcast(event); }
      finally { if (this.active?.id === runId) this.active = undefined; }
    })();
    this.active = { id: runId, controller, done };
    // Runtime reports model/tool errors as product events. A disk failure may still reject.
    void done.catch(error => console.error('Run event storage failure:', error instanceof Error ? error.message : 'unknown'));
    return runId;
  }
  async cancel(rawId: unknown): Promise<boolean> {
    const id = idSchema.parse(rawId);
    if (this.active?.id !== id) return false;
    const pending = this.active.done;
    this.active.controller.abort(); await pending; return true;
  }
  async resume(rawId: unknown, rawInput: unknown): Promise<RunId> {
    this.ensureAvailable();
    this.starting = true;
    try {
    const id = idSchema.parse(rawId) as RunId;
    const input = z.string().min(1).max(4000).parse(rawInput);
    const context = startSchema.parse(JSON.parse(await readFile(path.join(this.directory, 'context', `${id}.json`), 'utf8')) as unknown);
    // Authorization comes from the persisted original task; resume cannot change root or permissions.
    const controller = new AbortController();
    return await this.dispatch(this.runtime(context, await this.model(context.mode)).resume(id, input, controller.signal), controller);
    } finally { this.starting = false; }
  }
  async history(): Promise<RunRecord[]> { return this.store.listRuns(); }
  async recoverInterrupted(): Promise<void> {
    const history = await this.history();
    for (const run of history) if (run.status === 'running') await new AgentRuntime(this.store, new ScriptedModel([]), { execute: async () => ({}) }).recover(run.runId);
  }
  async shutdown(): Promise<void> {
    if (this.active) { this.active.controller.abort(); await this.active.done; }
  }
}
