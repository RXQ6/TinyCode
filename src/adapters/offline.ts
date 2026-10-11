import type { AgentState, Decision, ModelPort, ToolIntent, Usage } from '../core/contracts';
import { decodeDecision, encodeDecision } from './codec';

export function call(name: string, args: ToolIntent['arguments'] = {}): Decision { return { kind: 'call_tool', intent: { name, arguments: args } }; }
/** A narrowly scoped deterministic policy for the bundled cart task. Never advertised as an LLM. */
export class OfflineCartModel implements ModelPort {
  async decide(state: AgentState, signal: AbortSignal): Promise<Decision> {
    signal.throwIfAborted();
    const observations = state.observations;
    let decision: Decision;
    const last = observations.at(-1);
    if (!observations.length) decision = call('list_files');
    else if (last?.status === 'error' && last.name !== 'run_tests') decision = { kind: 'respond', status: 'partial', content: '工具未能读取或修改材料。请检查工作目录和写入授权。', missingMaterial: [String(last.result['message'] ?? '可访问的文件')] };
    else if (!observations.some(o => o.name === 'read_file')) decision = call('read_file', { path: 'cart.ts' });
    else if (last?.name === 'read_file') {
      const content = String(last.result['content']);
      if (content.includes('sum + item.price,')) decision = call('edit_file', { path: 'cart.ts', oldText: 'sum + item.price,', newText: 'sum + item.price * item.quantity,' });
      else decision = call('run_tests');
    } else if (last?.name === 'edit_file') decision = call('run_tests');
    else if (last?.name === 'run_tests' && last.result['exitCode'] === 0) decision = { kind: 'respond', status: 'complete', content: '已修复商品数量和折扣计算。最后一次修改后的实际 Node 测试全部通过。' };
    else if (last?.name === 'run_tests' && last.result['exitCode'] !== 0 && String(last.result['stdout']).includes('discount')) {
      if (observations.filter(o => o.name === 'edit_file').length >= 2) decision = { kind: 'respond', status: 'partial', content: '折扣修复后测试仍失败，需要更多实现信息。', missingMaterial: ['未覆盖的折扣规则'] };
      else decision = call('edit_file', { path: 'cart.ts', oldText: 'return subtotal + discount;', newText: 'return Math.round(subtotal * (1 - discount) * 100) / 100;' });
    } else decision = { kind: 'respond', status: 'partial', content: '离线策略只处理内置购物车任务；请配置 Pi 模型处理其他项目。', missingMaterial: ['适用于当前任务的模型决策'] };
    // Same serialized Decision boundary as the production Pi model adapter.
    return decodeDecision(encodeDecision(decision));
  }
  getUsage(): Usage { return { model: 'offline-cart-policy', inputTokens: 0, outputTokens: 0, costUSD: 0 }; }
}
export class ScriptedModel implements ModelPort {
  private index = 0;
  constructor(private readonly decisions: readonly Decision[]) {}
  async decide(_state: AgentState, signal: AbortSignal): Promise<Decision> {
    signal.throwIfAborted();
    const decision = this.decisions[this.index++] ?? this.decisions.at(-1);
    if (!decision) throw new Error('empty script');
    return decodeDecision(encodeDecision(decision));
  }
}
