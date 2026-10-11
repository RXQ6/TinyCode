import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OfflineCartModel } from '../src/adapters/offline';
import { createDemoWorkspace } from '../src/product/demo-workspace';
import { AgentRuntime } from '../src/runtime/runtime';
import { JsonStore } from '../src/runtime/store';
import { WorkspaceTools } from '../src/tools/workspace';
import type { AgentEvent } from '../src/core/contracts';

const base = path.resolve('.workbench', 'demo', String(Date.now()));
const root = await createDemoWorkspace(path.join(base, 'workspace'));
const store = new JsonStore(path.join(base, 'store'));
const runtime = new AgentRuntime(store, new OfflineCartModel(), new WorkspaceTools({ root, allowWrites: true, testFiles: ['cart.test.ts'] }));
const events: AgentEvent[] = [];
for await (const event of runtime.run({ input: '修复购物车数量与折扣计算，并通过测试。', requirePassingTests: true })) {
  events.push(event);
  if (event.type === 'tool_completed') console.log(`${event.sequence}: ${event.name} ${event.status}${event.result['exitCode'] !== undefined ? ` exit=${String(event.result['exitCode'])}` : ''}`);
  if (event.type === 'run_failed') console.error(event.error);
  if (event.type === 'run_completed') console.log(event.result);
}
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/demo-run.json', JSON.stringify({ root, events }, null, 2));
console.log(`Evidence: ${path.resolve('artifacts/demo-run.json')}`);
if (events.at(-1)?.type !== 'run_completed' || !events.some(e => e.type === 'tool_completed' && e.name === 'run_tests' && e.result['exitCode'] === 1)) process.exitCode = 1;
