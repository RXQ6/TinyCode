import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { WorkbenchPage } from './workbench.page';

async function launch(directory: string): Promise<ElectronApplication> {
  const env: Record<string, string> = { TINYCODE_DATA_DIR: directory };
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
  delete env['ELECTRON_RUN_AS_NODE'];
  return electron.launch({ args: ['.'], env });
}
test('desktop runs repair loop and replays history after restart', async ({}, testInfo) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tinycode-e2e-'));
  let app = await launch(directory);
  try {
    const page = await app.firstWindow(); const workbench = new WorkbenchPage(page);
    await expect(page.getByRole('heading', { name: '任务配置' })).toBeVisible();
    expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu() === null)).toBe(true);
    await page.screenshot({ path: 'artifacts/ui-redesign-empty.png', fullPage: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(950, 800));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1360, 900));
    await workbench.demo();
    const root = await page.getByLabel('工作目录').inputValue();
    await workbench.start(); await workbench.expectComplete();
    expect(await readFile(path.join(root, 'cart.ts'), 'utf8')).toContain('(1 - discount)');
    const security = await app.evaluate(({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0]?.webContents;
      if (!wc) throw new Error('missing window');
      // Electron's runtime introspection method is omitted from public declarations.
      const inspect = Reflect.get(wc, 'getLastWebPreferences') as (() => Electron.WebPreferences);
      const preferences = inspect.call(wc);
      return { contextIsolation: preferences?.contextIsolation, sandbox: preferences?.sandbox, nodeIntegration: preferences?.nodeIntegration };
    });
    expect(security).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false });
    expect(await page.evaluate(() => typeof (window as unknown as Record<string, unknown>)['require'])).toBe('undefined');
    await page.screenshot({ path: testInfo.outputPath('completed.png'), fullPage: true });
    await page.screenshot({ path: 'artifacts/ui-redesign-completed.png', fullPage: true });
    await app.close(); app = await launch(directory);
    const reopened = await app.firstWindow();
    await reopened.getByRole('button', { name: /修复购物车数量与折扣计算.*已结束/ }).click();
    await new WorkbenchPage(reopened).expectComplete();
  } finally { await app.close(); }
});
test('desktop shows partial result when writes are disabled', async () => {
  const app = await launch(await mkdtemp(path.join(tmpdir(), 'tinycode-e2e-readonly-')));
  try {
    const page = await app.firstWindow(); const workbench = new WorkbenchPage(page);
    await workbench.demo(); await page.getByLabel('允许修改所选项目的文件').uncheck();
    const root = await page.getByLabel('工作目录').inputValue();
    await workbench.start();
    await expect(page.getByRole('heading', { name: '部分完成', exact: true })).toBeVisible();
    await expect(page.getByText('写入未授权；启动任务时启用允许修改。', { exact: true })).toBeVisible();
    expect(await readFile(path.join(root, 'cart.ts'), 'utf8')).toContain('sum + item.price,');
  } finally { await app.close(); }
});
test('desktop cancels a real test process and persists cancelled state', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tinycode-e2e-cancel-'));
  const app = await launch(directory);
  try {
    const page = await app.firstWindow(); const workbench = new WorkbenchPage(page);
    await workbench.demo();
    const root = await page.getByLabel('工作目录').inputValue();
    await writeFile(path.join(root, 'cart.test.ts'), "import { test } from 'node:test'; test('slow', async () => new Promise(() => {})); setInterval(() => {}, 1000);");
    await workbench.start();
    await expect(page.getByRole('status')).toHaveText('正在执行测试…');
    await page.getByRole('button', { name: '取消运行' }).click();
    await expect(page.getByRole('heading', { name: '运行已取消' })).toBeVisible();
    const history = await page.evaluate(() => window.workbench.history());
    expect(history.ok && history.value[0]?.status).toBe('cancelled');
  } finally { await app.close(); }
});
