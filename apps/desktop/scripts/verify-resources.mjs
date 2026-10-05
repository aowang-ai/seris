import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, cp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = await mkdtemp(join(tmpdir(), 'seris-distribution-'));
const resources = fileURLToPath(new URL('../src-tauri/resources/', import.meta.url));
let child;
try {
  await cp(resources, join(dir, 'resources'), { recursive: true });
  await mkdir(join(dir, 'core'));
  await new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-xzf', join(dir, 'resources/core.tar.gz'), '-C', join(dir, 'core')]);
    tar.on('exit', code => code ? reject(new Error(`tar exited ${code}`)) : resolve());
    tar.on('error', reject);
  });
  await assert.rejects(access(join(dir, 'core/skills/installed')), { code: 'ENOENT' });
  const node = join(dir, 'resources/runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  if (process.platform === 'darwin') execFileSync('codesign', ['--verify', '--strict', node]);
  // Exercise the stripped native addon, esbuild and document dependencies from
  // the extracted deployment, without resolving anything from the checkout.
  execFileSync(node, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import { readFile } from 'node:fs/promises';
    import { Decimal, QuoteContext, OAuth } from 'longbridge';
    import { transform } from 'esbuild';
    import { chromium } from 'playwright-core';
    import { pdfCreateTool } from './dist/tools/artifact/pdf.js';
    import { docxCreateTool } from './dist/tools/artifact/docx.js';
    import { xlsxCreateTool, xlsxToCsvTool } from './dist/tools/artifact/xlsx.js';
    import { pptxCreateTool } from './dist/tools/artifact/pptx.js';
    assert.equal(new Decimal('12.34').toString(), '12.34');
    assert.equal(typeof QuoteContext, 'function');
    assert.equal(typeof OAuth, 'function');
    assert.equal(typeof chromium.connectOverCDP, 'function');
    assert.ok((await transform('const n: number = 3', { loader: 'ts' })).code.includes('3'));
    const specs = [
      [pdfCreateTool, { filename: 'test.pdf', pages: [{ paragraphs: ['Packaged runtime'] }] }, '%PDF'],
      [docxCreateTool, { filename: 'test.docx', sections: [{ paragraphs: ['Packaged runtime'] }] }, 'PK'],
      [xlsxCreateTool, { filename: 'test.xlsx', sheets: { Data: [['Price'], [12.34]] } }, 'PK'],
      [pptxCreateTool, { filename: 'test.pptx', slides: [{ title: 'Packaged runtime' }] }, 'PK'],
    ];
    for (const [tool, args, prefix] of specs) {
      const result = (await tool.execute('distribution-test', args)).details;
      assert.equal(result.real, true, JSON.stringify(result));
      assert.equal((await readFile(result.path)).subarray(0, prefix.length).toString(), prefix);
      if (args.filename.endsWith('.xlsx')) assert.equal((await xlsxToCsvTool.execute('distribution-test', { path: result.path })).details.csv, 'Price\\n12.34');
    }
    console.log('Packaged native SDK, strategy compiler, browser library and PDF/Word/Excel/PowerPoint passed');
  `], { cwd: join(dir, 'core'), env: { PATH: '', SERIS_ARTIFACTS_DIR: join(dir, 'artifacts') }, stdio: 'inherit' });
  child = spawn(node, [join(dir, 'core/dist/gateway/server.js')], {
    cwd: dir, env: { PATH: '', SERIS_DATA_DIR: join(dir, 'data'), SERIS_MANAGED: '1', SERIS_PORT: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const connection = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Readiness timeout')), 15000);
    child.stdout.on('data', data => {
      buffer += data;
      const line = buffer.split('\n').find(s => s.startsWith('seris ready at '));
      if (line) { clearTimeout(timer); resolve(JSON.parse(line.slice(15))); }
    });
    child.stderr.on('data', data => process.stderr.write(data));
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Early exit ${code}`)); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  const health = await (await fetch(`${connection.url}/healthz`)).json();
  assert.equal(health.state, 'needs-config');
  const headers = { authorization: `Bearer ${connection.token}` };
  const catalog = await (await fetch(`${connection.url}/api/strategies/list`, { headers })).json();
  const strategy = catalog.strategies.find(s => s.name === 'ma-trail-stop');
  assert.ok(strategy, 'The packaged strategy must be discoverable');
  assert.equal(strategy.valid, true, JSON.stringify(strategy.problems));
  const detail = await (await fetch(`${connection.url}/api/strategies/get?name=ma-trail-stop`, { headers })).json();
  assert.equal(detail.valid, true, JSON.stringify(detail.problems));
  assert.equal(detail.params.fast.default, 10);
  const created = await fetch(`${connection.url}/api/sessions`, {
    method: 'POST', headers,
  });
  assert.equal(created.status, 201);
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Shutdown timeout')), 7000);
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Shutdown exit ${code}`)); });
  });
  child.stdin.end();
  await exited;
  console.log('Packaged Node/core: empty PATH, no checkout, strategy loading, session API and stdin shutdown passed');
} finally {
  if (child?.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGKILL'); await exited;
  }
  await rm(dir, { recursive: true, force: true });
}
