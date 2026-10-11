import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgentEvent, RunId, RunRecord } from '../core/contracts';
import type { Info, Result } from '../product/contracts';
import './style.css';

const labels: Record<string, string> = { list_files: '查看目录', read_file: '读取代码', edit_file: '修改代码', run_tests: '执行测试' };
const statusLabels: Record<RunRecord['status'], string> = { running: '运行中', awaiting_human: '等待输入', completed: '已结束', failed: '失败', cancelled: '已取消' };
function ToolEvidence({ event }: { event: AgentEvent }): React.JSX.Element | null {
  if (event.type !== 'tool_completed') return null;
  const result = event.result;
  return <article className={`tool-row ${event.status}`}>
    <header><span className="tool-status">{event.status === 'success' ? '✓' : '!'}</span><strong>{labels[event.name] ?? event.name}</strong><span className="tool-path">{String(result['path'] ?? '')}</span><span>{event.durationMs} ms</span></header>
    {event.name === 'edit_file' && result['oldText'] !== undefined ? <div className="diff"><pre className="removed">− {String(result['oldText'])}</pre><pre className="added">+ {String(result['newText'])}</pre></div> : null}
    {event.name === 'run_tests' ? <><p className="exit-code">退出码 {String(result['exitCode'] ?? '未启动')}</p><details open={event.status === 'error'}><summary>测试输出</summary><pre>{String(result['stdout'] ?? result['message'] ?? '')}{String(result['stderr'] ?? '')}</pre></details></> : null}
    {event.name === 'read_file' && result['content'] !== undefined ? <details><summary>查看读取内容</summary><pre>{String(result['content'])}</pre></details> : null}
    {event.name === 'list_files' ? <pre className="file-list">{Array.isArray(result['entries']) ? result['entries'].map((item: { name: string; directory: boolean }) => `${item.directory ? '▸ ' : ''}${item.name}`).join('\n') : ''}</pre> : null}
    {result['message'] ? <p className="failure">{String(result['message'])}</p> : null}
  </article>;
}
function App(): React.JSX.Element {
  const [info, setInfo] = useState<Info | null>(null);
  const [root, setRoot] = useState(''); const [mode, setMode] = useState<'offline' | 'pi'>('offline');
  const [task, setTask] = useState('修复购物车数量与折扣计算，并运行测试验证。');
  const [testFiles, setTestFiles] = useState('cart.test.ts'); const [allowWrites, setAllowWrites] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [eventsByRun, setEventsByRun] = useState<Record<string, AgentEvent[]>>({});
  const [selected, setSelected] = useState<RunId | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [humanInput, setHumanInput] = useState('');
  function resultValue<T>(result: Result<T>): T | undefined {
    if (!result.ok) { setError(result.error); return undefined; } return result.value;
  }
  async function refreshHistory(): Promise<void> {
    const result = await window.workbench.history(); if (result.ok) setRuns(result.value); else setError(result.error);
  }
  useEffect(() => {
    void window.workbench.info().then(result => { if (result.ok) setInfo(result.value); else setError(result.error); });
    void refreshHistory();
    return window.workbench.onEvent(event => {
      setEventsByRun(previous => {
        const events = previous[event.runId] ?? [];
        if (events.some(e => e.sequence === event.sequence)) return previous;
        return { ...previous, [event.runId]: [...events, event].sort((a, b) => a.sequence - b.sequence) };
      });
      if (['run_completed', 'run_failed', 'run_cancelled', 'human_input_requested'].includes(event.type)) { setBusy(false); void refreshHistory(); }
    });
  }, []);
  const events = selected ? eventsByRun[selected] ?? [] : [];
  const last = events.at(-1);
  const isRunning = busy || Boolean(events.length && !['run_completed', 'run_failed', 'run_cancelled', 'human_input_requested'].includes(last?.type ?? ''));
  const toolEvents = events.filter(e => e.type === 'tool_completed');
  const usage = events.findLast(e => e.type === 'usage_reported');
  const completion = events.findLast(e => e.type === 'run_completed');
  const failure = events.findLast(e => e.type === 'run_failed');
  const waiting = last?.type === 'human_input_requested' ? last : null;
  async function demo(): Promise<void> {
    setError(''); const value = resultValue(await window.workbench.demo());
    if (value) { setRoot(value); setMode('offline'); setAllowWrites(true); setTestFiles('cart.test.ts'); setTask('修复购物车数量与折扣计算，并运行测试验证。'); }
  }
  async function start(): Promise<void> {
    setError(''); setBusy(true); setSelected(null);
    try {
      const id = resultValue(await window.workbench.start({ root, task, mode, allowWrites, testFiles: testFiles.split(',').map(s => s.trim()).filter(Boolean) }));
      if (id) setSelected(id); else setBusy(false);
      await refreshHistory();
    } catch (err) { setBusy(false); setError(err instanceof Error ? err.message : '启动失败，请重启工作台。'); }
  }
  async function selectRun(id: RunId): Promise<void> {
    if (isRunning) return;
    setSelected(id); const value = resultValue(await window.workbench.events(id));
    if (value) setEventsByRun(previous => ({ ...previous, [id]: value }));
  }
  async function resume(): Promise<void> {
    if (!selected) return;
    setBusy(true); setError(''); const id = resultValue(await window.workbench.resume(selected, humanInput));
    if (!id) setBusy(false); else setHumanInput('');
  }
  return <div className="workbench">
    <header className="app-header"><div className="brand-mark">tc</div><div><strong>TinyCode Workbench</strong><span>从一次修改，到可验证的完成</span></div><div className="mode-badge">{mode === 'offline' ? '离线策略 · 真实工具' : 'Pi 模型'}</div></header>
    <div className="layout">
      <aside className="sidebar"><h2>编码任务</h2>
        <button className="demo-button" onClick={() => void demo()} disabled={isRunning}>创建演示项目</button>
        <label>工作目录<input aria-label="工作目录" value={root} readOnly placeholder="创建演示或选择项目"/></label>
        <button className="quiet" onClick={async () => { const value = resultValue(await window.workbench.chooseWorkspace()); if (value) setRoot(value); }} disabled={isRunning}>选择工作目录</button>
        <label>决策模式<select value={mode} onChange={e => setMode(e.target.value === 'pi' ? 'pi' : 'offline')} disabled={isRunning}><option value="offline">离线购物车策略</option><option value="pi">Pi 真实模型</option></select></label>
        <p className="helper">{mode === 'offline' ? '只处理内置购物车任务。文件修改与测试进程都是真实执行。' : `Provider: ${info?.provider ?? 'openai'} / ${info?.model ?? '未配置'}。在启动应用前设置模型和密钥环境变量。`}</p>
        <label>任务描述<textarea value={task} onChange={e => setTask(e.target.value)} disabled={isRunning} rows={4}/></label>
        <label>Node 测试文件<input value={testFiles} onChange={e => setTestFiles(e.target.value)} disabled={isRunning}/></label>
        <p className="helper">多个文件用逗号分隔。测试会执行该项目的代码。</p>
        <label className="check"><input type="checkbox" checked={allowWrites} onChange={e => setAllowWrites(e.target.checked)} disabled={isRunning}/>允许修改所选项目的文件</label>
        <button className="primary" onClick={() => void start()} disabled={isRunning || !root || !task.trim()}>开始任务</button>
        {isRunning && selected ? <button className="cancel" onClick={async () => { resultValue(await window.workbench.cancel(selected)); }}>取消运行</button> : null}
        {error ? <p role="alert" className="error-banner">{error}</p> : null}
        <section className="history"><h2>运行记录</h2>{runs.length ? runs.slice(0, 30).map(run => <button key={run.runId} className={`history-item ${selected === run.runId ? 'selected' : ''}`} onClick={() => void selectRun(run.runId)} disabled={isRunning}><span>{run.task.input}</span><small>{statusLabels[run.status]} · {new Date(run.startedAt).toLocaleTimeString('zh-CN')}</small></button>) : <p className="helper">完成第一个任务后，可在这里回看证据。</p>}</section>
      </aside>
      <main className="trace"><div className="section-heading"><h1>执行过程</h1><span>{isRunning ? '正在执行…' : selected ? '记录已保存' : '准备开始'}</span></div>
        {toolEvents.length ? <div className="timeline">{toolEvents.map(event => <ToolEvidence key={event.sequence} event={event}/>)}</div> : <div className="empty"><div className="loop-sketch"><span>查看代码</span><b>→</b><span>修改代码</span><b>→</b><span>测试与修复</span></div><h2>看见代理如何完成任务</h2><p>创建一个独立的演示项目。工作台会保存每次工具调用、代码差异和测试输出，让完成状态有据可查。</p><p className="helper">演示先修复数量，测试发现折扣仍错误，再继续修复。</p></div>}
        {isRunning ? <p className="live-status" role="status">{last?.type === 'tool_started' ? `正在${labels[last.intent.name] ?? last.intent.name}…` : '正在生成下一步决策…'}</p> : null}
        {waiting ? <section className="human"><h2>需要你的输入</h2><p>{waiting.question}</p><label>补充信息<input value={humanInput} onChange={e => setHumanInput(e.target.value)}/></label><button className="primary" onClick={() => void resume()} disabled={!humanInput.trim()}>继续运行</button></section> : null}
      </main>
      <aside className="outcome"><h2>验证结果</h2>
        <div className={`result-icon ${completion?.type === 'run_completed' && completion.status === 'complete' ? 'passed' : ''}`}>{completion?.type === 'run_completed' && completion.status === 'complete' ? '✓' : last?.type === 'run_cancelled' ? '■' : '○'}</div>
        <h3>{completion?.type === 'run_completed' ? completion.status === 'complete' ? '任务完成' : '部分完成' : failure ? '运行失败' : last?.type === 'run_cancelled' ? '运行已取消' : waiting ? '等待输入' : isRunning ? '正在验证' : '等待任务'}</h3>
        {completion?.type === 'run_completed' ? <><p>{completion.result}</p>{completion.missingMaterial?.length ? <p className="failure">缺少：{completion.missingMaterial.join('、')}</p> : null}</> : null}
        {failure?.type === 'run_failed' ? <p role="alert" className="failure">{failure.error.message}<br/><small>{failure.error.code}</small></p> : null}
        {usage?.type === 'usage_reported' ? <dl><dt>工具调用</dt><dd>{usage.usage.toolCalls}</dd><dt>运行时间</dt><dd>{(usage.usage.durationMs / 1000).toFixed(2)} s</dd><dt>模型</dt><dd>{usage.usage.model ?? '未知'}</dd><dt>输入 / 输出 Token</dt><dd>{usage.usage.inputTokens ?? '未报告'} / {usage.usage.outputTokens ?? '未报告'}</dd><dt>成本</dt><dd>{usage.usage.costUSD === undefined ? 'Provider 未报告' : `$${usage.usage.costUSD.toFixed(4)}`}</dd></dl> : <p className="helper">最后一次修改后测试通过，才会标记为完成。</p>}
        <details className="raw-events"><summary>事件轨迹（{events.length}）</summary><ol>{events.map(event => <li key={event.sequence}>{event.sequence} {event.type}</li>)}</ol></details>
        <p className="store-note">运行证据保存于<br/>{info?.storePath ?? '加载中'}</p>
      </aside>
    </div>
  </div>;
}
const rootElement = document.getElementById('root');
if (rootElement) createRoot(rootElement).render(<StrictMode><App/></StrictMode>);
