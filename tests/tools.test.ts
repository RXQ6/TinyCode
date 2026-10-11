import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceTools } from '../src/tools/workspace';
const signal = new AbortController().signal;
let root: string; let tools: WorkspaceTools;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tinycode-tools-'));
  await writeFile(path.join(root, 'math.ts'), 'export const add = (a: number, b: number) => a - b;');
  tools = new WorkspaceTools({ root, allowWrites: true, testFiles: [] });
});
describe('real workspace tools', () => {
  it('reads and applies unique replacement', async () => {
    await tools.execute({ name: 'read_file', arguments: { path: 'math.ts' } }, signal);
    const result = await tools.execute({ name: 'edit_file', arguments: { path: 'math.ts', oldText: 'a - b', newText: 'a + b' } }, signal);
    expect(result['oldText']).toBe('a - b'); expect(await readFile(path.join(root, 'math.ts'), 'utf8')).toContain('a + b');
  });
  it('refuses blind and stale writes', async () => {
    const edit = { name: 'edit_file', arguments: { path: 'math.ts', oldText: 'a - b', newText: 'a + b' } };
    await expect(tools.execute(edit, signal)).rejects.toMatchObject({ code: 'invalid_tool' });
    await tools.execute({ name: 'read_file', arguments: { path: 'math.ts' } }, signal);
    await writeFile(path.join(root, 'math.ts'), 'changed externally');
    await expect(tools.execute(edit, signal)).rejects.toMatchObject({ code: 'invalid_tool' });
  });
  it.each(['../outside.ts', 'D:/outside.ts', '.env', '.git/config'])('refuses %s', async file => {
    await expect(tools.execute({ name: 'read_file', arguments: { path: file } }, signal)).rejects.toMatchObject({ code: 'invalid_tool' });
  });
  it('refuses junctions', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'tinycode-outside-'));
    await mkdir(path.join(root, 'safe'));
    await symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(tools.execute({ name: 'list_files', arguments: { path: 'link' } }, signal)).rejects.toMatchObject({ code: 'invalid_tool' });
  });
  it('rejects arbitrary tools and missing test config', async () => {
    await expect(tools.execute({ name: 'bash', arguments: { command: 'echo unsafe' } }, signal)).rejects.toMatchObject({ code: 'invalid_tool' });
    await expect(tools.execute({ name: 'run_tests', arguments: {} }, signal)).rejects.toMatchObject({ code: 'invalid_tool' });
  });
  it('cancels before executing', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(tools.execute({ name: 'read_file', arguments: { path: 'math.ts' } }, controller.signal)).rejects.toThrow();
  });
});
