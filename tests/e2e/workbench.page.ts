import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
export class WorkbenchPage {
  constructor(readonly page: Page) {}
  async demo(): Promise<void> {
    await this.page.getByRole('button', { name: '创建演示项目' }).click();
    await expect(this.page.getByLabel('工作目录')).not.toHaveValue('');
  }
  async start(): Promise<void> { await this.page.getByRole('button', { name: '开始任务', exact: true }).click(); }
  async expectComplete(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: '任务完成', exact: true })).toBeVisible();
    await expect(this.page.getByText('退出码 1', { exact: true })).toBeVisible();
    await expect(this.page.getByText('退出码 0', { exact: true })).toBeVisible();
  }
}
