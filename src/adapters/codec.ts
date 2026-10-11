import { z } from 'zod';
import { RunError } from '../core/contracts';
import type { AgentEvent, Decision, Session, SessionId } from '../core/contracts';

const intent = z.object({ name: z.string().min(1).max(80), arguments: z.record(z.string(), z.unknown()) });
export const decisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('call_tool'), intent }),
  z.object({ kind: z.literal('ask_human'), question: z.string().min(1).max(3000) }),
  z.object({ kind: z.literal('respond'), content: z.string().max(24000), status: z.enum(['complete', 'partial']), missingMaterial: z.array(z.string()).optional() })
]);
export function decodeDecision(text: string): Decision {
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const decision = decisionSchema.parse(JSON.parse(cleaned) as unknown);
    if (decision.kind === 'respond') return { kind: 'respond', content: decision.content, status: decision.status, ...(decision.missingMaterial ? { missingMaterial: decision.missingMaterial } : {}) };
    return decision;
  } catch { throw new RunError('runtime_error', '模型必须返回一个有效的 JSON 决策。'); }
}
export function encodeDecision(decision: Decision): string { return JSON.stringify(decisionSchema.parse(decision)); }
const observation = z.object({ name: z.string(), status: z.enum(['success', 'error']), result: z.record(z.string(), z.unknown()) });
const task = z.object({ input: z.string(), requirePassingTests: z.boolean() });
const errorCode = z.enum(['budget_iterations', 'budget_tools', 'budget_timeout', 'budget_tokens', 'no_progress', 'rate_limited', 'timeout', 'auth', 'invalid_tool', 'provider_unavailable', 'runtime_error', 'interrupted', 'invalid_completion']);
const payload = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run_started'), task, sessionId: z.string() }),
  z.object({ type: z.literal('run_resumed') }),
  z.object({ type: z.literal('model_requested'), iteration: z.number().int().positive() }),
  z.object({ type: z.literal('model_retry'), attempt: z.number(), code: errorCode }),
  z.object({ type: z.literal('decision_made'), decision: decisionSchema }),
  z.object({ type: z.literal('tool_started'), toolCallId: z.string(), intent }),
  z.object({ type: z.literal('tool_completed'), toolCallId: z.string(), name: z.string(), status: z.enum(['success', 'error']), result: z.record(z.string(), z.unknown()), durationMs: z.number() }),
  z.object({ type: z.literal('observation_added'), observation }),
  z.object({ type: z.literal('human_input_requested'), question: z.string() }),
  z.object({ type: z.literal('human_input_received'), input: z.string() }),
  z.object({ type: z.literal('usage_reported'), usage: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional(), model: z.string().optional(), costUSD: z.number().optional(), toolCalls: z.number(), durationMs: z.number(), retries: z.number() }) }),
  z.object({ type: z.literal('run_completed'), status: z.enum(['complete', 'partial']), result: z.string(), missingMaterial: z.array(z.string()).optional() }),
  z.object({ type: z.literal('run_failed'), error: z.object({ code: errorCode, message: z.string() }) }),
  z.object({ type: z.literal('run_cancelled') })
]);
const eventSchema = z.intersection(z.object({ runId: z.string(), sequence: z.number().int().positive(), timestamp: z.number().nonnegative() }), payload);
export function decodeEvent(value: unknown): AgentEvent {
  // Branding is applied only after runtime validation at this trusted boundary.
  return eventSchema.parse(value) as AgentEvent;
}
export function decodeSession(value: unknown): Session {
  return z.object({ id: z.string(), createdAt: z.number(), runs: z.array(z.string()) }).parse(value) as Session;
}
export function sessionId(value: string): SessionId { return value as SessionId; }
