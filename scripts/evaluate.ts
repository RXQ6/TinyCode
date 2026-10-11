import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { OfflineCartModel } from '../src/adapters/offline';
import { decodeDecision, encodeDecision } from '../src/adapters/codec';
import { replayAgentState } from '../src/core/agent';
import type { AgentEvent } from '../src/core/contracts';
import { createDemoWorkspace } from '../src/product/demo-workspace';
import { AgentRuntime } from '../src/runtime/runtime';
import { JsonStore } from '../src/runtime/store';
import { WorkspaceTools } from '../src/tools/workspace';

const names = ['quantity-discount', 'decimal-prices', 'large-quantity', 'quarter-discount', 'small-amount'];
const summary: { scenario: string; passed: boolean; toolCalls: number; exitCodes: unknown[]; runId: string }[] = [];
await mkdir('artifacts/golden', { recursive: true });
for (const [index, name] of names.entries()) {
  const base = path.resolve('.workbench', 'eval', String(Date.now()), name);
  const root = await createDemoWorkspace(path.join(base, 'workspace'), index);
  const store = new JsonStore(path.join(base, 'store'));
  const runtime = new AgentRuntime(store, new OfflineCartModel(), new WorkspaceTools({ root, allowWrites: true, testFiles: ['cart.test.ts'] }));
  const events: AgentEvent[] = [];
  for await (const event of runtime.run({ input: `修复购物车：${name}`, requirePassingTests: true })) events.push(event);
  const exitCodes = events.filter(e => e.type === 'tool_completed' && e.name === 'run_tests').map(e => e.type === 'tool_completed' ? e.result['exitCode'] : null);
  const passed = events.at(-1)?.type === 'run_completed' && JSON.stringify(exitCodes) === '[1,0]';
  assert.equal(passed, true, name);
  assert.deepEqual(replayAgentState([...events, ...events].reverse()), replayAgentState(events));
  for (const event of events) if (event.type === 'decision_made') assert.deepEqual(decodeDecision(encodeDecision(event.decision)), event.decision);
  await writeFile(`artifacts/golden/${name}.json`, JSON.stringify({ scenario: name, mode: 'offline-real-tools', events }, null, 2));
  summary.push({ scenario: name, passed, toolCalls: events.filter(e => e.type === 'tool_started').length, exitCodes, runId: events[0]!.runId });
  console.log(`${name}: PASS, tests 1 → 0`);
}
await writeFile('artifacts/evaluation.json', JSON.stringify({ generatedAt: new Date().toISOString(), mode: 'offline-real-tools', summary }, null, 2));
