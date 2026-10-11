import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const npmCLI = process.env['npm_execpath'];
if (!npmCLI) throw new Error('请用 npm run verify 启动验收。');
const commands = ['typecheck', 'test', 'build', 'test:e2e'];
const results: { command: string; exitCode: number; durationMs: number; log: string; passedTests?: number }[] = [];
await mkdir('artifacts/verification-logs', { recursive: true });
for (const command of commands) {
  console.log(`Running npm run ${command}`);
  const started = Date.now();
  let output = '';
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [npmCLI, 'run', command], { cwd: process.cwd(), shell: false, windowsHide: true, env: process.env });
    const capture = (chunk: Buffer): void => { const text = chunk.toString(); output += text; process.stdout.write(text); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    child.on('error', reject); child.on('close', code => resolve(code ?? -1));
  });
  const file = `artifacts/verification-logs/${command.replace(':', '-')}.log`;
  await writeFile(file, output);
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
  const count = command === 'test' ? clean.match(/Tests\s+(\d+) passed/)?.[1] : command === 'test:e2e' ? clean.match(/(\d+) passed \(/)?.[1] : undefined;
  results.push({ command: `npm run ${command}`, exitCode, durationMs: Date.now() - started, log: path.resolve(file), ...(count ? { passedTests: Number(count) } : {}) });
  if (exitCode !== 0) break;
}
const lock = JSON.parse(await readFile('package-lock.json', 'utf8')) as { packages: Record<string, { version?: string }> };
const versions: Record<string, string | undefined> = { node: process.version };
for (const name of ['@earendil-works/pi-coding-agent', 'electron', 'react', 'typescript', '@playwright/test']) versions[name] = lock.packages[`node_modules/${name}`]?.version;
const success = results.length === commands.length && results.every(result => result.exitCode === 0);
await writeFile('artifacts/verification.json', JSON.stringify({ verifiedAt: new Date().toISOString(), timezone: 'Asia/Shanghai', onlineProviderRun: false, versions, success, results }, null, 2));
console.log(`Verification ${success ? 'PASS' : 'FAIL'}: ${path.resolve('artifacts/verification.json')}`);
if (!success) process.exitCode = 1;
