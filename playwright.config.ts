import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/e2e', fullyParallel: true, workers: 2, timeout: 45000, expect: { timeout: 15000 }, reporter: [['list']], use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' } });
