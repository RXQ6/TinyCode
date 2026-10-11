import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PiModelAdapter, encodeModelState } from '../src/adapters/pi';
import { initialState } from '../src/core/agent';
describe('real Pi package integration, no paid request', () => {
  it('imports the pinned SDK and assembles isolated tools-disabled session', async () => {
    const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent');
    const directory = await mkdtemp(path.join(tmpdir(), 'tinycode-pi-smoke-'));
    const runtime = await ModelRuntime.create({ authPath: path.join(directory, 'auth.json'), modelsPath: null, modelsStorePath: path.join(directory, 'models.json'), refreshOnCreate: false, allowModelNetwork: false });
    const model = runtime.getModels('openai')[0]; expect(model).toBeDefined();
    const settings = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
    const loader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager: settings, noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true, systemPromptOverride: () => 'Return a JSON decision.', appendSystemPromptOverride: () => [] });
    await loader.reload();
    const { session } = await createAgentSession({ cwd: directory, agentDir: directory, ...(model ? { model } : {}), modelRuntime: runtime, settingsManager: settings, sessionManager: SessionManager.inMemory(directory), resourceLoader: loader, noTools: 'all' });
    try { expect(session.getActiveToolNames()).toEqual([]); expect(session.state.messages).toEqual([]); await session.abort(); }
    finally { session.dispose(); }
  }, 60000);
  it('reports missing configuration as auth, never fake success', async () => {
    const original = process.env['TINYCODE_MODEL']; delete process.env['TINYCODE_MODEL'];
    try {
      await expect(new PiModelAdapter('.workbench/sdk-test').decide(initialState({ input: 'repair', requirePassingTests: true }), new AbortController().signal)).rejects.toMatchObject({ code: 'auth' });
    } finally { if (original !== undefined) process.env['TINYCODE_MODEL'] = original; }
  });
  it('passes only pure task state to the model codec', () => {
    const state = initialState({ input: '修复', requirePassingTests: true });
    expect(JSON.parse(encodeModelState(state))).toEqual(state);
  });
});
