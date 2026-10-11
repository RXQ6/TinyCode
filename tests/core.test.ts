import { describe, expect, it } from 'vitest';
import { addObservation, initialState, step } from '../src/core/agent';
import type { Decision, ModelPort } from '../src/core/contracts';
const task = { input: '修复总价', requirePassingTests: true };
const respond: Decision = { kind: 'respond', status: 'complete', content: '完成' };
const model: ModelPort = { decide: async () => respond };
describe('pure Core', () => {
  it('rejects unsupported completion', async () => { await expect(step(initialState(task), model, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid_completion' }); });
  it('requires tests after the latest edit', async () => {
    let state = addObservation(initialState(task), { name: 'run_tests', status: 'success', result: { exitCode: 0 } });
    state = addObservation(state, { name: 'edit_file', status: 'success', result: {} });
    await expect(step(state, model, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid_completion' });
    state = addObservation(state, { name: 'run_tests', status: 'success', result: { exitCode: 0 } });
    expect(await step(state, model, new AbortController().signal)).toEqual(respond);
  });
  it('requires partial missing material', async () => {
    await expect(step(initialState(task), { decide: async () => ({ kind: 'respond', status: 'partial', content: '缺材料' }) }, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid_completion' });
  });
  it('does not mutate prior state', () => {
    const state = initialState(task); addObservation(state, { name: 'read_file', status: 'success', result: {} });
    expect(state.observations).toHaveLength(0);
  });
});
