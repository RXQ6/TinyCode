import { describe, expect, it } from 'vitest';
import { decodeDecision, encodeDecision } from '../src/adapters/codec';
import { normalizeError } from '../src/runtime/runtime';
import type { Decision } from '../src/core/contracts';
describe('Pi production decision codec', () => {
  const decisions: Decision[] = [
    { kind: 'call_tool', intent: { name: 'read_file', arguments: { path: 'cart.ts' } } },
    { kind: 'ask_human', question: '文件在哪里？' },
    { kind: 'respond', status: 'partial', content: '缺材料', missingMaterial: ['tests'] },
    { kind: 'respond', status: 'complete', content: '通过' }
  ];
  it.each(decisions)('preserves $kind across SDK encode/decode boundary', decision => { expect(decodeDecision(encodeDecision(decision))).toEqual(decision); });
  it.each(['{"kind":"unknown"}', '{"kind":"call_tool","intent":{"name":"read_file"}}', 'not json'])('rejects malformed model response %s', text => { expect(() => decodeDecision(text)).toThrow(); });
  it('accepts fenced JSON from a provider', () => { expect(decodeDecision('```json\n' + encodeDecision(decisions[0]!) + '\n```')).toEqual(decisions[0]); });
  it.each([['401 Unauthorized', 'auth'], ['429 Rate limit', 'rate_limited'], ['402 Insufficient Balance', 'provider_unavailable'], ['503 backend unavailable', 'provider_unavailable'], ['fetch failed', 'provider_unavailable'], ['timed out', 'timeout']])('normalizes %s to %s', (message, code) => { expect(normalizeError(new Error(message)).code).toBe(code); });
});
