import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkbenchService, idSchema } from '../product/service';
import type { Result } from '../product/contracts';
import type { RunId } from '../core/contracts';
import { redactText } from '../runtime/redact';

const here = path.dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | undefined;
let service: WorkbenchService;
let shuttingDown = false;
function trusted(event: IpcMainInvokeEvent): void {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('拒绝未知窗口调用。');
  const url = event.senderFrame.url;
  if (url !== window.webContents.getURL()) throw new Error('拒绝未知页面调用。');
}
function handle<T>(channel: string, action: (...args: unknown[]) => Promise<T>): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<Result<T>> => {
    try { trusted(event); return { ok: true, value: await action(...args) }; }
    catch (error) { return { ok: false, error: redactText(error instanceof Error ? error.message : '操作失败') }; }
  });
}
async function createWindow(): Promise<void> {
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({ width: 1360, height: 900, minWidth: 900, minHeight: 650, title: 'TinyCode Workbench', backgroundColor: '#edf2f7', show: false,
    webPreferences: { preload: path.join(here, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = undefined; });
  if (process.env['ELECTRON_RENDERER_URL']) await window.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else await window.loadFile(path.join(here, '../renderer/index.html'));
}
async function initialize(): Promise<void> {
const base = process.env['TINYCODE_DATA_DIR'] ?? path.join(app.getPath('userData'), 'workbench');
service = new WorkbenchService(base, event => { if (window && !window.isDestroyed()) window.webContents.send('agent:event', event); });
await service.recoverInterrupted();
session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  const dev = Boolean(process.env['ELECTRON_RENDERER_URL']);
  callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [dev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:*; img-src 'self' data:; object-src 'none'; base-uri 'none'"
    : "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'"] } });
});
handle('app:info', async () => ({ defaultRoot: '', storePath: base, provider: process.env['TINYCODE_PROVIDER'] ?? 'openai', model: process.env['TINYCODE_MODEL'] ?? '未配置', version: app.getVersion() }));
handle('workspace:choose', async () => {
  const selection = await dialog.showOpenDialog(window!, { properties: ['openDirectory'], title: '选择允许代理读取和测试的项目' });
  const root = selection.filePaths[0] ?? null;
  if (!selection.canceled && root) { service.authorizeRoot(root); return root; }
  return null;
});
handle('workspace:demo', () => service.demo());
handle('agent:start', request => service.start(request));
handle('agent:cancel', id => service.cancel(id));
handle('agent:history', () => service.history());
handle('agent:events', id => service.store.listEvents(idSchema.parse(id) as RunId));
handle('agent:resume', (id, input) => service.resume(id, input));
app.on('before-quit', event => {
  if (shuttingDown) return;
  event.preventDefault(); shuttingDown = true;
  void service.shutdown().finally(() => app.quit());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
await createWindow();
}
// Avoid keeping the ESM entry pending on ready: this deadlocked launch in our
// Electron 41 + Playwright loader verification. Register the callback instead.
void app.whenReady().then(initialize).catch(error => {
  console.error('Workbench startup failed:', error instanceof Error ? error.message : 'unknown');
  app.exit(1);
});
