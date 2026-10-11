import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgentEvent, RunId, RunRecord } from '../core/contracts';
import type { Info, Result } from '../product/contracts';
import './style.css';

const labels: Record<string, string> = { list_files: '查看目录', read_file: '读取代码', edit_file: '修改代码', run_tests: '执行测试' };
const statusLabels: Record<RunRecord['status'], string> = { running: '运行中', awaiting_human: '等待输入', completed: '已结束', failed: '失败', cancelled: '已取消' };
function Icon({ name }: { name: 'file' | 'folder' | 'play' | 'code' | 'check' | 'clock' | 'activity' }): React.JSX.Element {
  const paths = { file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z M14 2v6h6 M8 13h8 M8 17h5', folder: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7h18', play: 'M7 3l14 9-14 9V3z', code: 'M8 6l-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18', check: 'M5 12l4 4L19 6', clock: 'M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', activity: 'M4 19V13 M12 19V8 M20 19V3' };
  return <svg className="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]}/></svg>;
}
function EmptyWorkspace(): React.JSX.Element {
  return <div className="empty">
    <div className="steps"><div className="step active"><span>1</span><strong>查看代码</strong><small>了解当前项目</small></div><div className="step"><span>2</span><strong>修改代码</strong><small>应用任务修复</small></div><div className="step"><span>3</span><strong>测试与修复</strong><small>用实际结果验证</small></div></div>
    <div className="code-illustration" aria-hidden="true"><div className="illustration-orbit"/><div className="back-sheet"/><div className="code-window"><div className="window-dots"><i/><i/><i/></div><Icon name="code"/></div><span className="illustration-check"><Icon name="check"/></span></div>
    <h2>让每次修改都有据可查</h2><p>创建演示项目或选择工作目录，开始一次编码任务。<br/>代码差异、测试输出与修复过程都会保存在这里。</p>
    <div className="workflow-notes"><div><Icon name="file"/><strong>读取真实代码</strong><span>查看文件与当前实现</span></div><div><Icon name="code"/><strong>记录每次修改</strong><span>保留修改前后的差异</span></div><div><Icon name="check"/><strong>通过测试验证</strong><span>失败反馈进入下一轮</span></div></div>
  </div>;
}
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
  const testEvents = toolEvents.filter(e => e.type === 'tool_completed' && e.name === 'run_tests');
  const editCount = toolEvents.filter(e => e.type === 'tool_completed' && e.name === 'edit_file' && e.status === 'success').length;
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
      <aside className="sidebar panel"><div className="panel-heading"><span className="heading-icon"><Icon name="file"/></span><div><h2>任务配置</h2><p>从一个目标，开始一次可验证的修改。</p></div></div>
        <div className="field-group"><h3><Icon name="code"/>编码任务</h3><button className="demo-button" onClick={() => void demo()} disabled={isRunning}>＋ 创建演示项目</button></div>
        <div className="field-group"><label><span><Icon name="folder"/>工作目录</span><input aria-label="工作目录" value={root} readOnly placeholder="创建演示或选择项目" title={root}/></label>
        <button className="quiet" onClick={async () => { const value = resultValue(await window.workbench.chooseWorkspace()); if (value) setRoot(value); }} disabled={isRunning}><Icon name="folder"/>选择工作目录</button></div>
        <div className="field-group"><label><span><Icon name="activity"/>决策模式</span><select value={mode} onChange={e => setMode(e.target.value === 'pi' ? 'pi' : 'offline')} disabled={isRunning}><option value="offline">离线购物车策略</option><option value="pi">Pi 真实模型</option></select></label>
        <p className="helper">{mode === 'offline' ? '只处理内置购物车任务。文件修改与测试进程都是真实执行。' : `Provider: ${info?.provider ?? 'openai'} / ${info?.model ?? '未配置'}。在启动应用前设置模型和密钥环境变量。`}</p>
        </div><div className="field-group"><label><span><Icon name="file"/>任务描述</span><textarea value={task} onChange={e => setTask(e.target.value)} disabled={isRunning} rows={3} maxLength={8000}/></label><div className="character-count">{task.length} / 8000</div></div>
        <div className="field-group"><label><span><Icon name="code"/>Node 测试文件</span><input value={testFiles} onChange={e => setTestFiles(e.target.value)} disabled={isRunning}/></label>
        <p className="helper">多个文件用逗号分隔。测试会执行该项目的代码。</p></div>
        <label className="check"><input type="checkbox" checked={allowWrites} onChange={e => setAllowWrites(e.target.checked)} disabled={isRunning}/>允许修改所选项目的文件</label>
        <button className="primary" onClick={() => void start()} disabled={isRunning || !root || !task.trim()}><Icon name="play"/>开始任务</button>
        {isRunning && selected ? <button className="cancel" onClick={async () => { resultValue(await window.workbench.cancel(selected)); }}>取消运行</button> : null}
        {error ? <p role="alert" className="error-banner">{error}</p> : null}
      </aside>
      <main className="trace panel"><div className="section-heading"><div className="panel-heading"><span className="heading-icon"><Icon name="play"/></span><div><h1>执行过程</h1><p>查看代码修改、测试反馈与下一轮修复。</p></div></div><span className="state-pill">{isRunning ? '正在执行…' : selected ? '记录已保存' : '准备开始'}</span></div>
        {toolEvents.length ? <div className="timeline">{toolEvents.map(event => <ToolEvidence key={event.sequence} event={event}/>)}</div> : <EmptyWorkspace/>}
        {isRunning ? <p className="live-status" role="status">{last?.type === 'tool_started' ? `正在${labels[last.intent.name] ?? last.intent.name}…` : '正在生成下一步决策…'}</p> : null}
        {waiting ? <section className="human"><h2>需要你的输入</h2><p>{waiting.question}</p><label>补充信息<input value={humanInput} onChange={e => setHumanInput(e.target.value)}/></label><button className="primary" onClick={() => void resume()} disabled={!humanInput.trim()}>继续运行</button></section> : null}
      </main>
      <aside className="right-column"><section className="outcome panel"><div className="panel-heading"><span className="heading-icon"><Icon name="activity"/></span><h2>验证结果</h2></div>
        <div className="result-summary">
        <div className={`result-icon ${completion?.type === 'run_completed' && completion.status === 'complete' ? 'passed' : ''}`}>{completion?.type === 'run_completed' && completion.status === 'complete' ? '✓' : last?.type === 'run_cancelled' ? '■' : '○'}</div>
        <h3>{completion?.type === 'run_completed' ? completion.status === 'complete' ? '任务完成' : '部分完成' : failure ? '运行失败' : last?.type === 'run_cancelled' ? '运行已取消' : waiting ? '等待输入' : isRunning ? '正在验证' : '等待任务'}</h3>
        </div>
        {completion?.type === 'run_completed' ? <><p>{completion.result}</p>{completion.missingMaterial?.length ? <p className="failure">缺少：{completion.missingMaterial.join('、')}</p> : null}</> : null}
        {failure?.type === 'run_failed' ? <p role="alert" className="failure">{failure.error.message}<br/><small>{failure.error.code}</small></p> : null}
        <div className="result-stats"><div><Icon name="file"/><strong>{selected ? editCount : '—'}</strong><span>成功修改</span></div><div><Icon name="code"/><strong>{selected ? testEvents.length : '—'}</strong><span>测试轮次</span></div><div className="stat-error"><strong>{selected ? testEvents.filter(e => e.type === 'tool_completed' && e.status === 'error').length : '—'}</strong><span>失败轮次</span></div><div className="stat-success"><strong>{selected ? testEvents.filter(e => e.type === 'tool_completed' && e.status === 'success').length : '—'}</strong><span>通过轮次</span></div></div>
        {usage?.type === 'usage_reported' ? <dl><dt>工具调用</dt><dd>{usage.usage.toolCalls}</dd><dt>运行时间</dt><dd>{(usage.usage.durationMs / 1000).toFixed(2)} s</dd><dt>模型</dt><dd>{usage.usage.model ?? '未知'}</dd><dt>输入 / 输出 Token</dt><dd>{usage.usage.inputTokens ?? '未报告'} / {usage.usage.outputTokens ?? '未报告'}</dd><dt>成本</dt><dd>{usage.usage.costUSD === undefined ? 'Provider 未报告' : `$${usage.usage.costUSD.toFixed(4)}`}</dd></dl> : <p className="helper">最后一次修改后测试通过，才会标记为完成。</p>}
        </section><section className="event-panel panel"><details className="raw-events" open={!events.length}><summary>事件轨迹（{events.length}）</summary>{events.length ? <ol>{events.map(event => <li key={event.sequence}><span>{event.sequence}</span>{event.type}</li>)}</ol> : <div className="event-empty"><Icon name="file"/><strong>暂无事件记录</strong><p>任务开始后，可在这里回看每一步执行。</p></div>}</details></section>
        <section className="history panel"><div className="panel-heading"><span className="heading-icon"><Icon name="clock"/></span><h2>运行记录</h2></div>{runs.length ? runs.slice(0, 30).map(run => <button key={run.runId} className={`history-item ${selected === run.runId ? 'selected' : ''}`} onClick={() => void selectRun(run.runId)} disabled={isRunning}><span>{run.task.input}</span><small><i className={`history-dot ${run.status}`}/>{statusLabels[run.status]} · {new Date(run.startedAt).toLocaleString('zh-CN')}</small></button>) : <div className="history-empty"><Icon name="clock"/><p>还没有运行记录</p><span>开始第一个任务，保存你的修复过程。</span></div>}</section>
        <details className="store-note"><summary>本地记录位置</summary><p>{info?.storePath ?? '加载中'}</p></details>
      </aside>
    </div>
  </div>;
}
const rootElement = document.getElementById('root');
if (rootElement) createRoot(rootElement).render(<StrictMode><App/></StrictMode>);
