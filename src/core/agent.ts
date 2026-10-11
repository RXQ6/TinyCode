import { RunError } from './contracts';
import type { AgentEvent, AgentState, Decision, ModelPort, Observation, RunRecord, RunStatus } from './contracts';

export function initialState(task: AgentState['task']): AgentState {
  return { task, observations: [], humanInputs: [], iteration: 0 };
}
export function addObservation(state: AgentState, observation: Observation): AgentState {
  return { ...state, observations: [...state.observations, observation] };
}
export async function step(state: AgentState, model: ModelPort, signal: AbortSignal): Promise<Decision> {
  signal.throwIfAborted();
  const decision = await model.decide(state, signal);
  signal.throwIfAborted();
  if (decision.kind === 'respond' && decision.status === 'complete' && state.task.requirePassingTests) {
    const lastEdit = state.observations.findLastIndex(o => o.name === 'edit_file' && o.status === 'success');
    const lastTest = state.observations.findLastIndex(o => o.name === 'run_tests');
    const test = state.observations[lastTest];
    if (lastTest < 0 || lastTest <= lastEdit || test?.status !== 'success' || test.result['exitCode'] !== 0) {
      throw new RunError('invalid_completion', '完成前必须在最后一次修改之后执行测试并得到 exitCode 0。');
    }
  }
  if (decision.kind === 'respond' && decision.status === 'partial' && !decision.missingMaterial?.length) {
    throw new RunError('invalid_completion', '部分结果必须列出缺少的材料。');
  }
  return decision;
}
export function orderedEvents(events: readonly AgentEvent[]): AgentEvent[] {
  const seen = new Map<number, AgentEvent>();
  for (const event of events) {
    const previous = seen.get(event.sequence);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) throw new RunError('runtime_error', '重复序号包含冲突事件。');
    seen.set(event.sequence, event);
  }
  return [...seen.values()].sort((a, b) => a.sequence - b.sequence);
}
export function replayAgentState(events: readonly AgentEvent[]): AgentState {
  const ordered = orderedEvents(events);
  const start = ordered[0];
  if (start?.type !== 'run_started') throw new RunError('runtime_error', '事件日志缺少 run_started。');
  let state = initialState(start.task);
  for (const event of ordered) {
    if (event.type === 'model_requested') state = { ...state, iteration: event.iteration };
    if (event.type === 'observation_added') state = addObservation(state, event.observation);
    if (event.type === 'human_input_received') state = { ...state, humanInputs: [...state.humanInputs, event.input] };
  }
  return state;
}
export function replayRun(events: readonly AgentEvent[]): RunRecord | undefined {
  const ordered = orderedEvents(events);
  const start = ordered[0];
  if (start?.type !== 'run_started') return undefined;
  let status: RunStatus = 'running';
  for (const event of ordered) {
    if (event.type === 'human_input_requested') status = 'awaiting_human';
    if (event.type === 'run_resumed') status = 'running';
    if (event.type === 'run_completed') status = 'completed';
    if (event.type === 'run_failed') status = 'failed';
    if (event.type === 'run_cancelled') status = 'cancelled';
  }
  return { runId: start.runId, sessionId: start.sessionId, task: start.task, status, startedAt: start.timestamp, updatedAt: ordered.at(-1)?.timestamp ?? start.timestamp };
}
