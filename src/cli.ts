import path from 'node:path';
import { OfflineCartModel } from './adapters/offline';
import { PiModelAdapter } from './adapters/pi';
import { AgentRuntime } from './runtime/runtime';
import { JsonStore } from './runtime/store';
import { WorkspaceTools } from './tools/workspace';

const args = process.argv.slice(2);
function option(name: string): string | undefined { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; }
const workspace = option('--workspace'); const task = option('--task'); const tests = option('--tests');
if (!workspace || !task || !tests || args.includes('--help')) {
  console.log('Usage: npm run agent -- --workspace <dir> --tests <file.test.ts[,other.test.ts]> --task "修复代码" [--allow-writes] [--offline]');
  if (!args.includes('--help')) process.exitCode = 1;
} else {
  const root = path.resolve(workspace); const allowWrites = args.includes('--allow-writes');
  const reference = path.resolve('D:/tinyCode').toLowerCase();
  if (allowWrites && (root.toLowerCase() === reference || root.toLowerCase().startsWith(reference + path.sep))) throw new Error('参考仓库仅供只读查阅。');
  const directory = path.resolve('.workbench', 'cli');
  const controller = new AbortController();
  const cancel = (): void => controller.abort(); process.once('SIGINT', cancel);
  try {
    const runtime = new AgentRuntime(new JsonStore(path.join(directory, 'store')), args.includes('--offline') ? new OfflineCartModel() : new PiModelAdapter(path.join(directory, 'sdk')),
      new WorkspaceTools({ root, allowWrites, testFiles: tests.split(',').map(file => file.trim()) }));
    for await (const event of runtime.run({ input: task, requirePassingTests: true }, controller.signal)) {
      console.log(JSON.stringify(event));
      if (event.type === 'run_failed' || event.type === 'run_cancelled' || (event.type === 'run_completed' && event.status === 'partial')) process.exitCode = 1;
    }
  } finally { process.removeListener('SIGINT', cancel); }
}
