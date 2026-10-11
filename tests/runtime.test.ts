import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { replayAgentState } from '../src/core/agent';
import { defaultBudget, RunError } from '../src/core/contracts';
import type { AgentEvent, Decision, ModelPort, RunId, ToolPort } from '../src/core/contracts';
import { call, OfflineCartModel, ScriptedModel } from '../src/adapters/offline';
import { JsonStore } from '../src/runtime/store';
import { AgentRuntime } from '../src/runtime/runtime';
import { createDemoWorkspace } from '../src/product/demo-workspace';
import { WorkspaceTools } from '../src/tools/workspace';

const task = { input: '修复购物车', requirePassingTests: true };
const partial: Decision = { kind: 'respond', status: 'partial', content: '缺文件', missingMaterial: ['cart.ts'] };
const tools: ToolPort = { execute: async intent => ({ name: intent.name, exitCode: 0 }) };
async function setup(): Promise<JsonStore> { return new JsonStore(await mkdtemp(path.join(tmpdir(), 'tinycode-runtime-'))); }
async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> { const events: AgentEvent[] = []; for await (const event of stream) events.push(event); return events; }
describe('Runtime invariants', () => {
  it('runs real read → edit → failing tests → repair → passing tests', async () => {
    const root = await createDemoWorkspace(await mkdtemp(path.join(tmpdir(), 'tinycode-cart-')));
    const store = await setup();
    const runtime = new AgentRuntime(store, new OfflineCartModel(), new WorkspaceTools({ root, allowWrites: true, testFiles: ['cart.test.ts'] }));
    const events = await collect(runtime.run(task));
    expect(events.at(-1)?.type).toBe('run_completed');
    const tests = events.filter(e => e.type === 'tool_completed' && e.name === 'run_tests');
    expect(tests.map(e => e.type === 'tool_completed' ? e.result['exitCode'] : null)).toEqual([1, 0]);
    expect(events.map(e => e.sequence)).toEqual(events.map((_, i) => i + 1));
    expect(await store.listEvents(events[0]!.runId)).toEqual(events);
    const state = replayAgentState(events);
    expect(replayAgentState([...events, ...events].reverse())).toEqual(state);
    expect(state.observations).toHaveLength(6);
    expect(await readFile(path.join(root, 'cart.ts'), 'utf8')).toContain('(1 - discount)');
  });
  it('isolates sessions', async () => {
    const store = await setup();
    const a = await collect(new AgentRuntime(store, new ScriptedModel([call('read_file', { path: 'a.ts' }), partial]), tools).run(task));
    const b = await collect(new AgentRuntime(store, new ScriptedModel([partial]), tools).run({ ...task, input: '另一任务' }));
    expect(a[0]?.runId).not.toBe(b[0]?.runId);
    expect(replayAgentState(b).observations).toEqual([]);
    expect(a[0]?.type === 'run_started' && b[0]?.type === 'run_started' && a[0].sessionId !== b[0].sessionId).toBe(true);
  });
  it('tool failures become observations; later tools still run', async () => {
    const events = await collect(new AgentRuntime(await setup(), new ScriptedModel([call('bad'), call('run_tests'), { kind: 'respond', content: '完成', status: 'complete' }]), {
      execute: async intent => { if (intent.name === 'bad') throw new RunError('invalid_tool', 'unknown'); return { exitCode: 0 }; }
    }).run(task));
    expect(replayAgentState(events).observations.map(o => o.status)).toEqual(['error', 'success']);
    expect(events.at(-1)?.type).toBe('run_completed');
  });
  it.each(['iterations', 'tools', 'timeout', 'tokens'] as const)('enforces %s budget', async kind => {
    const model: ModelPort = kind === 'timeout'
      ? { decide: async (_state, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) }
      : new ScriptedModel([call('read_file')]);
    if (kind === 'tokens') {
      let consumed = 0; const decide = model.decide.bind(model);
      model.decide = async (state, signal) => { consumed += 10; return decide(state, signal); };
      model.getUsage = () => ({ inputTokens: consumed });
    }
    const events = await collect(new AgentRuntime(await setup(), model, tools, { ...defaultBudget, maxIterations: kind === 'iterations' ? 1 : 10, maxToolCalls: kind === 'tools' ? 0 : 10, timeoutMs: kind === 'timeout' ? 30 : 10000, ...(kind === 'tokens' ? { maxInputTokens: 5 } : {}) }).run(task));
    const last = events.at(-1);
    expect(last).toMatchObject({ type: 'run_failed', error: { code: `budget_${kind}` } });
    expect(events.at(-2)?.type).toBe('usage_reported');
  });
  it('retries transient failures only up to maxRetries', async () => {
    let count = 0;
    const model: ModelPort = { decide: async () => { count++; throw new RunError('rate_limited', '429'); } };
    const events = await collect(new AgentRuntime(await setup(), model, tools, { ...defaultBudget, maxRetries: 2 }).run(task));
    expect(count).toBe(3); expect(events.filter(e => e.type === 'model_retry')).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: 'run_failed', error: { code: 'rate_limited' } });
  });
  it('does not retry auth errors', async () => {
    let calls = 0;
    const events = await collect(new AgentRuntime(await setup(), { decide: async () => { calls++; throw new RunError('auth', 'no key'); } }, tools).run(task));
    expect(calls).toBe(1); expect(events.at(-1)).toMatchObject({ type: 'run_failed', error: { code: 'auth' } });
  });
  it('cancels in-flight model and persists cancellation without a next tool', async () => {
    const store = await setup(); const controller = new AbortController(); let rejected = false; let toolCalls = 0;
    const model: ModelPort = { decide: async (_state, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { rejected = true; reject(signal.reason); }, { once: true });
      controller.abort();
    }) };
    const events = await collect(new AgentRuntime(store, model, { execute: async () => { toolCalls++; return {}; } }).run(task, controller.signal));
    expect(rejected).toBe(true); expect(toolCalls).toBe(0); expect(events.at(-1)?.type).toBe('run_cancelled');
    expect((await store.loadRun(events[0]!.runId))?.status).toBe('cancelled');
  });
  it('cancels a real in-flight test process', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tinycode-cancel-'));
    await writeFile(path.join(root, 'slow.test.ts'), "import { test } from 'node:test'; test('slow', async () => new Promise(() => {})); setInterval(() => {}, 1000);");
    const controller = new AbortController();
    const runtime = new AgentRuntime(await setup(), new ScriptedModel([call('run_tests')]), new WorkspaceTools({ root, allowWrites: false, testFiles: ['slow.test.ts'] }));
    const events: AgentEvent[] = [];
    for await (const event of runtime.run(task, controller.signal)) {
      events.push(event);
      if (event.type === 'tool_started') setTimeout(() => controller.abort(), 100);
    }
    expect(events.at(-1)?.type).toBe('run_cancelled');
    expect(events.filter(e => e.type === 'tool_started')).toHaveLength(1);
  });
  it('persists cancellation when consumer closes the stream', async () => {
    const store = await setup(); const iterator = new AgentRuntime(store, new ScriptedModel([partial]), tools).run(task);
    const first = await iterator.next(); await iterator.return(undefined);
    expect(first.value && (await store.loadRun(first.value.runId))?.status).toBe('cancelled');
  });
  it('guards repeated nonprogress', async () => {
    const events = await collect(new AgentRuntime(await setup(), new ScriptedModel([call('read_file')]), tools).run(task));
    expect(events.at(-1)).toMatchObject({ type: 'run_failed', error: { code: 'no_progress' } });
  });
  it('resumes a durable human pause after constructing a new runtime', async () => {
    const store = await setup();
    const events = await collect(new AgentRuntime(store, new ScriptedModel([{ kind: 'ask_human', question: '测试入口？' }]), tools).run(task));
    const runId = events[0]!.runId;
    expect((await store.loadRun(runId))?.status).toBe('awaiting_human');
    await collect(new AgentRuntime(store, new ScriptedModel([call('run_tests'), { kind: 'respond', content: '完成', status: 'complete' }]), tools).resume(runId, 'cart.test.ts'));
    const recovered = await store.listEvents(runId);
    expect(replayAgentState(recovered).humanInputs).toEqual(['cart.test.ts']);
    expect(recovered.at(-1)?.type).toBe('run_completed');
  });
  it('excludes human waiting from timeout and preserves usage after resume', async () => {
    const store = await setup(); const clock = vi.spyOn(Date, 'now'); let consumed = 0;
    const model: ModelPort = new ScriptedModel([{ kind: 'ask_human', question: '补充材料？' }, partial]);
    const decide = model.decide.bind(model);
    model.decide = async (state, signal) => { consumed += 3; return decide(state, signal); };
    model.getUsage = () => ({ inputTokens: consumed });
    const runtime = new AgentRuntime(store, model, tools, { ...defaultBudget, timeoutMs: 10000 });
    try {
      clock.mockReturnValue(1000000);
      const events = await collect(runtime.run(task));
      clock.mockReturnValue(1600000); // Ten minutes of human wait; no execution time consumed.
      const resumed = await collect(runtime.resume(events[0]!.runId, '已补充'));
      expect(resumed.at(-1)?.type).toBe('run_completed');
      expect(resumed.find(e => e.type === 'usage_reported')).toMatchObject({ usage: { inputTokens: 6, durationMs: 0 } });
    } finally { clock.mockRestore(); }
  });
  it('recovers durable observations but never re-executes a crashed write', async () => {
    const store = await setup(); const session = await store.createSession(); const runId = randomUUID() as RunId;
    await store.appendEvent({ type: 'run_started', task, sessionId: session.id, runId, sequence: 1, timestamp: Date.now() });
    await store.appendEvent({ type: 'tool_completed', name: 'read_file', toolCallId: 'x', result: { content: 'saved' }, status: 'success', durationMs: 0, runId, sequence: 2, timestamp: Date.now() });
    const runtime = new AgentRuntime(store, new ScriptedModel([partial]), { execute: async () => { throw new Error('must not run'); } });
    const state = await runtime.recover(runId);
    expect(state.observations).toHaveLength(1); expect((await store.loadRun(runId))?.status).toBe('failed');
    expect(await runtime.recover(runId)).toEqual(state);
  });
  it('redacts environment secrets in events and state', async () => {
    const secret = 'fixture-secret-value-889933'; process.env['TINYCODE_TEST_SECRET'] = secret;
    try {
      const events = await collect(new AgentRuntime(await setup(), new ScriptedModel([call('read_file'), partial]), { execute: async () => ({ content: secret }) }).run(task));
      expect(JSON.stringify(events)).not.toContain(secret);
      expect(replayAgentState(events).observations[0]?.result['content']).toBe('[REDACTED]');
    } finally { delete process.env['TINYCODE_TEST_SECRET']; }
  });
  it('append is idempotent and forbids conflicting sequence', async () => {
    const store = await setup(); const events = await collect(new AgentRuntime(store, new ScriptedModel([partial]), tools).run(task));
    await store.appendEvent(events[0]!); expect(await store.listEvents(events[0]!.runId)).toEqual(events);
    await expect(store.appendEvent({ ...events[0]!, timestamp: 0 })).rejects.toThrow();
  });
  it('recovery of terminal run produces exact state', async () => {
    const store = await setup(); const events = await collect(new AgentRuntime(store, new ScriptedModel([partial]), tools).run(task));
    expect(await new AgentRuntime(store, new ScriptedModel([partial]), tools).recover(events[0]!.runId)).toEqual(replayAgentState(events));
  });
});
