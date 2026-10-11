import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkbenchService } from '../src/product/service';
import type { StartRequest } from '../src/product/contracts';
async function service(): Promise<WorkbenchService> { return new WorkbenchService(await mkdtemp(path.join(tmpdir(), 'tinycode-service-')), () => {}); }
function request(root: string): StartRequest { return { root, task: '修复购物车', mode: 'offline', allowWrites: true, testFiles: ['cart.test.ts'] }; }
describe('desktop service boundary', () => {
  it('requires explicit workspace selection', async () => {
    const instance = await service();
    await expect(instance.start(request('D:/unselected'))).rejects.toThrow('授权工作目录');
  });
  it('keeps the reference repository read only even when selected', async () => {
    const instance = await service(); instance.authorizeRoot('D:/tinyCode');
    await expect(instance.start(request('D:/tinyCode'))).rejects.toThrow('只读参考仓库');
  });
  it('rejects simultaneous starts before the first async initialization completes', async () => {
    const instance = await service(); const root = await instance.demo();
    const first = instance.start(request(root));
    await expect(instance.start(request(root))).rejects.toThrow('已有任务');
    await first; await instance.shutdown();
  });
  it('redacts persisted resume context as well as run events', async () => {
    const instance = await service(); const root = await instance.demo();
    const secret = 'private-config-fixture-333999'; process.env['TINYCODE_CONTEXT_SECRET'] = secret;
    try {
      const id = await instance.start({ ...request(root), task: `修复购物车 ${secret}` });
      await instance.shutdown();
      const context = await readFile(path.join(instance.directory, 'context', `${id}.json`), 'utf8');
      expect(context).not.toContain(secret); expect(context).toContain('[REDACTED]');
      expect(JSON.stringify(await instance.store.listEvents(id))).not.toContain(secret);
    } finally { delete process.env['TINYCODE_CONTEXT_SECRET']; }
  });
});
