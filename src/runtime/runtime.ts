import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { addObservation, initialState, replayAgentState, step } from '../core/agent';
import { defaultBudget, RunError } from '../core/contracts';
import type { AgentEvent, AgentState, Decision, EventPayload, ModelPort, RunBudget, RunId, RunLog, SessionId, SessionStore, Task, ToolPort, Usage } from '../core/contracts';
import { sanitize } from './redact';

export interface RuntimeStore extends SessionStore, RunLog {}
export function normalizeError(error: unknown): RunError {
  if (error instanceof RunError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/401|403|api.?key|authentication|unauthorized|no.*credential/i.test(message)) return new RunError('auth', message);
  if (/429|rate.?limit/i.test(message)) return new RunError('rate_limited', message);
  if (/timeout|timed.?out/i.test(message)) return new RunError('timeout', message);
  if (/402|502|503|fetch failed|insufficient balance|ECONN|ENOTFOUND/i.test(message)) return new RunError('provider_unavailable', message);
  return new RunError('runtime_error', message);
}
export async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  // Work may synchronously trigger cancellation before it is handed to us.
  // Still observe its rejection so the early abort cannot leak an unhandled Promise.
  if (signal.aborted) { void work.catch(() => {}); throw signal.reason; }
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
export class AgentRuntime {
  private readonly active = new Set<RunId>();
  constructor(private readonly store: RuntimeStore, private readonly model: ModelPort, private readonly tools: ToolPort, private readonly budget: RunBudget = defaultBudget) {}
  async *run(task: Task, caller?: AbortSignal): AsyncGenerator<AgentEvent> {
    const session = await this.store.createSession();
    const runId = randomUUID() as RunId;
    session.runs.push(runId); await this.store.saveSession(session);
    yield* this.execute(runId, session.id, sanitize(task), [], undefined, caller);
  }
  async *resume(runId: RunId, input: string, caller?: AbortSignal): AsyncGenerator<AgentEvent> {
    const events = await this.store.listEvents(runId); const run = await this.store.loadRun(runId);
    if (!run || run.status !== 'awaiting_human') throw new RunError('runtime_error', '只有等待输入的运行可以续跑。');
    if (!input.trim()) throw new RunError('runtime_error', '恢复输入不能为空。');
    yield* this.execute(runId, run.sessionId, run.task, events, input, caller);
  }
  async recover(runId: RunId): Promise<AgentState> {
    const events = await this.store.listEvents(runId); const run = await this.store.loadRun(runId);
    if (!run) throw new RunError('runtime_error', '运行不存在。');
    if (this.active.has(runId)) throw new RunError('runtime_error', '运行仍在执行中。');
    if (run.status === 'running') {
      // A crash can happen during a write. Do not execute the last intent twice.
      const completed = events.filter(e => e.type === 'tool_completed');
      const observations = events.filter(e => e.type === 'observation_added');
      const unmatched = completed.slice(observations.length);
      let sequence = events.length;
      for (const event of unmatched) {
        if (event.type !== 'tool_completed') continue;
        const observation: AgentEvent = { type: 'observation_added', observation: { name: event.name, status: event.status, result: event.result }, runId, sequence: ++sequence, timestamp: Date.now() };
        await this.store.appendEvent(observation); events.push(observation);
      }
      const usage: AgentEvent = { type: 'usage_reported', runId, sequence: ++sequence, timestamp: Date.now(), usage: { toolCalls: events.filter(e => e.type === 'tool_started').length, durationMs: Date.now() - run.startedAt, retries: events.filter(e => e.type === 'model_retry').length } };
      await this.store.appendEvent(usage); events.push(usage);
      const failure: AgentEvent = { type: 'run_failed', runId, sequence: ++sequence, timestamp: Date.now(), error: { code: 'interrupted', message: '上次进程中断；已恢复可审计状态。为避免重复写入，请检查 diff 后启动新任务。' } };
      await this.store.appendEvent(failure); events.push(failure);
    }
    return replayAgentState(events);
  }
  private async *execute(runId: RunId, sessionId: SessionId, task: Task, history: AgentEvent[], humanInput?: string, caller?: AbortSignal): AsyncGenerator<AgentEvent> {
    if (this.active.has(runId)) throw new RunError('runtime_error', '同一个运行只能有一个执行者。');
    this.active.add(runId);
    const segmentStarted = Date.now();
    const priorReport = history.findLast(event => event.type === 'usage_reported');
    const priorUsage = priorReport?.type === 'usage_reported' ? priorReport.usage : undefined;
    const initialModelUsage = this.model.getUsage?.() ?? {};
    // Human wait time is not execution time. Preserve consumed budgets across resume.
    const remaining = this.budget.timeoutMs - (priorUsage?.durationMs ?? 0);
    const timeout = AbortSignal.timeout(Math.max(1, remaining));
    const consumer = new AbortController();
    const signal = AbortSignal.any([timeout, consumer.signal, ...(caller ? [caller] : [])]);
    let sequence = history.length; let terminal = false; let paused = false;
    let state = history.length ? replayAgentState(history) : initialState(task);
    let toolCalls = history.filter(e => e.type === 'tool_started').length;
    let retries = history.filter(e => e.type === 'model_retry').length;
    let lastFingerprint = ''; let repeat = 0;
    const emit = async (payload: EventPayload): Promise<AgentEvent> => {
      const event = sanitize({ ...payload, runId, sequence: ++sequence, timestamp: Date.now() });
      await this.store.appendEvent(event); return event;
    };
    const cumulativeUsage = (): Usage => {
      const current = this.model.getUsage?.() ?? {};
      return { ...current,
        ...((current.inputTokens !== undefined || priorUsage?.inputTokens !== undefined) ? { inputTokens: (priorUsage?.inputTokens ?? 0) + Math.max(0, (current.inputTokens ?? 0) - (initialModelUsage.inputTokens ?? 0)) } : {}),
        ...((current.outputTokens !== undefined || priorUsage?.outputTokens !== undefined) ? { outputTokens: (priorUsage?.outputTokens ?? 0) + Math.max(0, (current.outputTokens ?? 0) - (initialModelUsage.outputTokens ?? 0)) } : {}),
        ...((current.costUSD !== undefined || priorUsage?.costUSD !== undefined) ? { costUSD: (priorUsage?.costUSD ?? 0) + Math.max(0, (current.costUSD ?? 0) - (initialModelUsage.costUSD ?? 0)) } : {}) };
    };
    const usage = (): EventPayload => ({ type: 'usage_reported', usage: { ...cumulativeUsage(), toolCalls, durationMs: (priorUsage?.durationMs ?? 0) + Date.now() - segmentStarted, retries } });
    const check = (): void => {
      signal.throwIfAborted();
      const cost = cumulativeUsage();
      if ((this.budget.maxInputTokens !== undefined && (cost?.inputTokens ?? 0) >= this.budget.maxInputTokens) || (this.budget.maxOutputTokens !== undefined && (cost?.outputTokens ?? 0) >= this.budget.maxOutputTokens)) throw new RunError('budget_tokens', '模型 Token 预算已耗尽。');
    };
    try {
      if (!history.length) yield await emit({ type: 'run_started', task, sessionId });
      else {
        const input = sanitize(humanInput ?? '');
        yield await emit({ type: 'human_input_received', input });
        state = { ...state, humanInputs: [...state.humanInputs, input] };
        yield await emit({ type: 'run_resumed' });
      }
      while (true) {
        check();
        if (state.iteration >= this.budget.maxIterations) throw new RunError('budget_iterations', '迭代预算已耗尽。');
        state = { ...state, iteration: state.iteration + 1 };
        yield await emit({ type: 'model_requested', iteration: state.iteration });
        let decision: Decision; let attempts = 0;
        while (true) {
          try { decision = sanitize(await abortable(step(state, this.model, signal), signal)); break; }
          catch (error) {
            if (signal.aborted) throw error;
            const normalized = normalizeError(error);
            if (!['rate_limited', 'timeout', 'provider_unavailable'].includes(normalized.code) || retries >= this.budget.maxRetries) throw normalized;
            attempts++; retries++;
            yield await emit({ type: 'model_retry', attempt: attempts, code: normalized.code });
            await delay(50 * 2 ** (attempts - 1), undefined, { signal });
          }
        }
        check();
        yield await emit({ type: 'decision_made', decision });
        switch (decision.kind) {
          case 'respond':
            yield await emit(usage());
            const done = await emit({ type: 'run_completed', status: decision.status, result: decision.content, ...(decision.missingMaterial ? { missingMaterial: decision.missingMaterial } : {}) });
            terminal = true; yield done; return;
          case 'ask_human': {
            yield await emit(usage());
            const waiting = await emit({ type: 'human_input_requested', question: decision.question });
            paused = true; yield waiting; return;
          }
          case 'call_tool': {
            if (toolCalls >= this.budget.maxToolCalls) throw new RunError('budget_tools', '工具调用预算已耗尽。');
            toolCalls++; const toolCallId = randomUUID(); const toolStarted = Date.now();
            yield await emit({ type: 'tool_started', toolCallId, intent: decision.intent });
            check();
            let result: Record<string, unknown>; let status: 'success' | 'error' = 'success';
            try {
              result = sanitize(await this.tools.execute(decision.intent, signal));
              signal.throwIfAborted();
              if (decision.intent.name === 'run_tests' && result['exitCode'] !== 0) status = 'error';
            } catch (error) {
              if (signal.aborted) throw error;
              status = 'error'; const normalized = normalizeError(error);
              result = sanitize({ code: normalized.code, message: normalized.message });
            }
            yield await emit({ type: 'tool_completed', toolCallId, name: decision.intent.name, status, result, durationMs: Date.now() - toolStarted });
            const observation = { name: decision.intent.name, status, result };
            state = addObservation(state, observation);
            yield await emit({ type: 'observation_added', observation });
            const fingerprint = JSON.stringify([decision.intent, observation]);
            repeat = fingerprint === lastFingerprint ? repeat + 1 : 0; lastFingerprint = fingerprint;
            if (repeat >= 2 || result['code'] === 'no_progress') throw new RunError('no_progress', '重复动作没有取得新信息，运行已停止。');
          }
        }
      }
    } catch (error) {
      yield await emit(usage());
      const event = caller?.aborted || consumer.signal.aborted
        ? await emit({ type: 'run_cancelled' })
        : await emit({ type: 'run_failed', error: signal.aborted
          ? { code: 'budget_timeout', message: '运行超过时间预算。' }
          : { code: normalizeError(error).code, message: normalizeError(error).message } });
      terminal = true; yield event;
    } finally {
      consumer.abort();
      if (!terminal && !paused) {
        await emit(usage());
        await emit({ type: 'run_cancelled' });
      }
      this.active.delete(runId);
    }
  }
}
