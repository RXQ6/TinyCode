import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RunError } from '../core/contracts';
import type { ToolIntent, ToolPort } from '../core/contracts';

const MAX_FILE = 100000;
const blocked = /^(?:\.git|\.env(?:\..*)?|\.aws|\.ssh|node_modules|auth\.json|credentials.*)$/i;
export function secretPath(name: string): boolean { return blocked.test(name) && name !== '.env.example'; }
function stringArg(intent: ToolIntent, name: string): string {
  const value = intent.arguments[name];
  if (typeof value !== 'string') throw new RunError('invalid_tool', `${name} 必须是字符串。`);
  return value;
}
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export interface WorkspaceOptions { root: string; allowWrites: boolean; testFiles: string[]; nodeExecutable?: string }
export class WorkspaceTools implements ToolPort {
  private readonly reads = new Map<string, string>();
  constructor(private readonly options: WorkspaceOptions) {}
  private async resolve(relative: string): Promise<string> {
    if (path.isAbsolute(relative) || relative.includes(':') || relative.includes('\0')) throw new RunError('invalid_tool', '只允许工作目录内的相对路径。');
    const root = await realpath(this.options.root);
    const target = path.resolve(root, relative);
    const tail = path.relative(root, target);
    if (tail.startsWith('..') || path.isAbsolute(tail)) throw new RunError('invalid_tool', '路径超出工作目录。');
    let current = root;
    for (const component of tail.split(path.sep).filter(Boolean)) {
      if (secretPath(component)) throw new RunError('invalid_tool', '拒绝访问私密或内部目录。');
      current = path.join(current, component);
      if ((await lstat(current)).isSymbolicLink()) throw new RunError('invalid_tool', '拒绝通过链接访问文件。');
    }
    return target;
  }
  async execute(intent: ToolIntent, signal: AbortSignal): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    if (intent.name === 'list_files') {
      const relative = typeof intent.arguments['path'] === 'string' ? intent.arguments['path'] : '.';
      const directory = await this.resolve(relative);
      const entries = await readdir(directory, { withFileTypes: true });
      return { path: relative, entries: entries.filter(e => !secretPath(e.name) && !e.isSymbolicLink()).slice(0, 200).map(e => ({ name: e.name, directory: e.isDirectory() })), source: 'filesystem' };
    }
    if (intent.name === 'read_file' || intent.name === 'edit_file') {
      const relative = stringArg(intent, 'path');
      const file = await this.resolve(relative);
      const stat = await lstat(file);
      if (!stat.isFile() || stat.size > MAX_FILE) throw new RunError('invalid_tool', '只允许读取 100 KB 以下的普通文本文件。');
      const before = await readFile(file, 'utf8');
      signal.throwIfAborted();
      if (before.includes('\0')) throw new RunError('invalid_tool', '不支持二进制文件。');
      if (intent.name === 'read_file') {
        this.reads.set(file, digest(before));
        return { path: relative, content: before, source: 'filesystem' };
      }
      if (!this.options.allowWrites) throw new RunError('invalid_tool', '写入未授权；启动任务时启用允许修改。');
      if (this.reads.get(file) !== digest(before)) throw new RunError('invalid_tool', '文件必须先读取；若文件已变化，请重新读取。');
      const oldText = stringArg(intent, 'oldText');
      const newText = stringArg(intent, 'newText');
      if (!oldText || before.split(oldText).length !== 2) throw new RunError('invalid_tool', 'oldText 必须在文件中唯一匹配。');
      if (oldText === newText) throw new RunError('no_progress', '替换内容没有变化。');
      const after = before.replace(oldText, newText);
      if (Buffer.byteLength(after) > MAX_FILE) throw new RunError('invalid_tool', '修改后文件过大。');
      signal.throwIfAborted();
      await writeFile(file, after, 'utf8');
      this.reads.set(file, digest(after));
      return { path: relative, oldText, newText, beforeHash: digest(before), afterHash: digest(after), source: 'filesystem' };
    }
    if (intent.name === 'run_tests') {
      if (!this.options.testFiles.length) throw new RunError('invalid_tool', '没有配置 Node 测试文件。');
      for (const file of this.options.testFiles) {
        if (!/\.(?:test|spec)\.(?:ts|tsx|js|mjs)$/.test(file)) throw new RunError('invalid_tool', '测试入口必须为 *.test.ts/js 或 *.spec.ts/js 文件。');
        await this.resolve(file);
      }
      return this.runTests(signal);
    }
    throw new RunError('invalid_tool', `未知工具：${intent.name}`);
  }
  private async runTests(signal: AbortSignal): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const executable = this.options.nodeExecutable ?? process.execPath;
      const env: NodeJS.ProcessEnv = {};
      for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
        if (process.env[key]) env[key] = process.env[key];
      }
      env['ELECTRON_RUN_AS_NODE'] = '1';
      const child = spawn(executable, ['--test', ...this.options.testFiles], { cwd: this.options.root, shell: false, windowsHide: true, env, detached: process.platform !== 'win32' });
      let stdout = ''; let stderr = ''; let overflow = false; let settled = false;
      const kill = (): void => {
        if (!child.pid) return;
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, shell: false });
          killer.on('error', () => child.kill());
        } else {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        }
      };
      const abort = (): void => { kill(); };
      signal.addEventListener('abort', abort, { once: true });
      const capture = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
        const value = chunk.toString();
        if (target === 'stdout') stdout = (stdout + value).slice(0, 48000);
        else stderr = (stderr + value).slice(0, 12000);
        if (stdout.length >= 48000 || stderr.length >= 12000) { overflow = true; kill(); }
      };
      child.stdout.on('data', (chunk: Buffer) => capture('stdout', chunk));
      child.stderr.on('data', (chunk: Buffer) => capture('stderr', chunk));
      const finish = (error?: Error): void => {
        if (settled) return; settled = true;
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
      };
      child.on('error', error => finish(error));
      child.on('close', code => {
        if (settled) return;
        finish();
        if (signal.aborted) reject(signal.reason);
        else if (overflow) reject(new RunError('invalid_tool', '测试输出超过上限，进程已停止。'));
        else resolve({ exitCode: code ?? -1, stdout, stderr, command: ['node', '--test', ...this.options.testFiles], source: 'process' });
      });
      if (signal.aborted) abort();
    });
  }
}
