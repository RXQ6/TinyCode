export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type RunId = Brand<string, 'RunId'>;
export type SessionId = Brand<string, 'SessionId'>;
export interface Task { readonly input: string; readonly requirePassingTests: boolean }
export interface ToolIntent { readonly name: string; readonly arguments: Record<string, unknown> }
export type Decision =
  | { kind: 'call_tool'; intent: ToolIntent }
  | { kind: 'ask_human'; question: string }
  | { kind: 'respond'; content: string; status: 'complete' | 'partial'; missingMaterial?: string[] };
export interface Observation {
  readonly name: string;
  readonly status: 'success' | 'error';
  readonly result: Record<string, unknown>;
}
export interface AgentState {
  readonly task: Task;
  readonly observations: readonly Observation[];
  readonly humanInputs: readonly string[];
  readonly iteration: number;
}
export interface Usage { inputTokens?: number; outputTokens?: number; model?: string; costUSD?: number }
export interface ModelPort {
  decide(state: AgentState, signal: AbortSignal): Promise<Decision>;
  /** Monotonic cumulative usage over this adapter's lifetime. Runtime records run deltas. */
  getUsage?(): Usage;
}
export interface ToolPort {
  execute(intent: ToolIntent, signal: AbortSignal): Promise<Record<string, unknown>>;
}
export type RunErrorCode = 'budget_iterations' | 'budget_tools' | 'budget_timeout' | 'budget_tokens'
  | 'no_progress' | 'rate_limited' | 'timeout' | 'auth' | 'invalid_tool'
  | 'provider_unavailable' | 'runtime_error' | 'interrupted' | 'invalid_completion';
export class RunError extends Error {
  constructor(public readonly code: RunErrorCode, message: string) { super(message); this.name = 'RunError'; }
}
export interface RunBudget {
  maxIterations: number; maxToolCalls: number; maxRetries: number; timeoutMs: number;
  maxInputTokens?: number; maxOutputTokens?: number;
}
export const defaultBudget: RunBudget = { maxIterations: 24, maxToolCalls: 18, maxRetries: 2, timeoutMs: 120000 };
export type RunStatus = 'running' | 'awaiting_human' | 'completed' | 'failed' | 'cancelled';
export type EventPayload =
  | { type: 'run_started'; task: Task; sessionId: SessionId }
  | { type: 'run_resumed' }
  | { type: 'model_requested'; iteration: number }
  | { type: 'model_retry'; attempt: number; code: RunErrorCode }
  | { type: 'decision_made'; decision: Decision }
  | { type: 'tool_started'; toolCallId: string; intent: ToolIntent }
  | { type: 'tool_completed'; toolCallId: string; name: string; status: 'success' | 'error'; result: Record<string, unknown>; durationMs: number }
  | { type: 'observation_added'; observation: Observation }
  | { type: 'human_input_requested'; question: string }
  | { type: 'human_input_received'; input: string }
  | { type: 'usage_reported'; usage: Usage & { toolCalls: number; durationMs: number; retries: number } }
  | { type: 'run_completed'; status: 'complete' | 'partial'; result: string; missingMaterial?: string[] }
  | { type: 'run_failed'; error: { code: RunErrorCode; message: string } }
  | { type: 'run_cancelled' };
export type AgentEvent = EventPayload & { runId: RunId; sequence: number; timestamp: number };
export interface RunRecord {
  runId: RunId; sessionId: SessionId; status: RunStatus; task: Task; startedAt: number; updatedAt: number;
}
export interface Session { id: SessionId; createdAt: number; runs: RunId[] }
export interface SessionStore {
  createSession(): Promise<Session>;
  loadSession(id: SessionId): Promise<Session | undefined>;
  saveSession(session: Session): Promise<void>;
}
export interface RunLog {
  appendEvent(event: AgentEvent): Promise<void>;
  listEvents(runId: RunId): Promise<AgentEvent[]>;
  loadRun(runId: RunId): Promise<RunRecord | undefined>;
}
