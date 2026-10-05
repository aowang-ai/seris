import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, cp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = await mkdtemp(join(tmpdir(), 'seris-distribution-'));
const resources = fileURLToPath(new URL('../src-tauri/resources/', import.meta.url));
let child;
try {
  await cp(resources, join(dir, 'resources'), { recursive: true });
  for (const name of ['LICENSE', 'NOTICE', 'Node-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt', 'Seris-brand-LICENSE.md', 'OFL-Geist.txt']) {
    const text = await readFile(join(dir, 'resources/licenses', name), 'utf8');
    assert.ok(text.length > 100, `Empty license: ${name}`);
  }
  await mkdir(join(dir, 'core'));
  await new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-xzf', join(dir, 'resources/core.tar.gz'), '-C', join(dir, 'core')]);
    tar.on('exit', code => code ? reject(new Error(`tar exited ${code}`)) : resolve());
    tar.on('error', reject);
  });
  await assert.rejects(access(join(dir, 'core/skills/installed')), { code: 'ENOENT' });
  const node = join(dir, 'resources/runtime', process.platform === 'win32' ? 'node.exe' : 'node');
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
  const created = await fetch(`${connection.url}/api/sessions`, {
    method: 'POST', headers: { authorization: `Bearer ${connection.token}` },
  });
  assert.equal(created.status, 201);
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Shutdown timeout')), 7000);
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Shutdown exit ${code}`)); });
  });
  child.stdin.end();
  await exited;
  console.log('Packaged Node/core: empty PATH, no checkout, needs-config, session API and stdin shutdown passed');
} finally {
  if (child?.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGKILL'); await exited;
  }
  await rm(dir, { recursive: true, force: true });
}
