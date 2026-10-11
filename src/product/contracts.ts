import type { AgentEvent, RunId, RunRecord } from '../core/contracts';
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface StartRequest { root: string; task: string; mode: 'offline' | 'pi'; allowWrites: boolean; testFiles: string[] }
export interface Info { defaultRoot: string; storePath: string; provider: string; model: string; version: string }
export interface DesktopAPI {
  info(): Promise<Result<Info>>;
  chooseWorkspace(): Promise<Result<string | null>>;
  demo(): Promise<Result<string>>;
  start(request: StartRequest): Promise<Result<RunId>>;
  cancel(runId: RunId): Promise<Result<boolean>>;
  history(): Promise<Result<RunRecord[]>>;
  events(runId: RunId): Promise<Result<AgentEvent[]>>;
  resume(runId: RunId, input: string): Promise<Result<RunId>>;
  onEvent(listener: (event: AgentEvent) => void): () => void;
}
