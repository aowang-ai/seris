/** macOS native supervisor smoke; uses only its own disposable app instance. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';

if (process.platform !== 'darwin') throw new Error('This supervisor smoke currently targets the macOS .app bundle');
const dir = await mkdtemp(join(tmpdir(), 'seris-native-'));
const bundle = realpathSync(process.argv[2] ?? fileURLToPath(new URL('../src-tauri/target/release/bundle/macos/Seris.app', import.meta.url)));
const executable = join(bundle, 'Contents/MacOS/seris-desktop');
const env = Object.fromEntries(['HOME', 'TMPDIR', 'USER', 'LOGNAME', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
const child = spawn(executable, [], { env: { ...env, PATH: '', SERIS_DATA_DIR: dir, SERIS_LEGACY_CORE_DIR: join(dir, 'legacy-core') }, stdio: ['ignore', 'ignore', 'pipe'] });
let logs = '', sidecar;
const account = `seris-smoke-${randomUUID()}`;

child.stderr.on('data', data => { logs = (logs + data).slice(-8192); });
child.once('error', error => { logs += String(error); });
const children = () => {
  try { return execFileSync('/usr/bin/pgrep', ['-P', String(child.pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean).map(Number); }
  catch { return []; }
};
const port = pid => {
  if (!pid) return null;
  try {
    const out = execFileSync('/usr/sbin/lsof', ['-Pan', '-p', String(pid), '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return Number(out.match(/127\.0\.0\.1:(\d+)/)?.[1]) || null;
  } catch { return null; }
};
const eventually = async fn => {
  // First launch unpacks the bundled core before the gateway's own readiness
  // timer starts. Include that cold-cache work in this external smoke budget.
  for (let i = 0; i < 900; i++) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 100)); }
  throw new Error(`Native supervisor timeout: ${logs}`);
};
const kill = (pid, signal = 'SIGKILL') => { if (pid) { try { process.kill(pid, signal); } catch {} } };
try {
  const first = await eventually(() => { const pid = children()[0]; return port(pid) ? pid : null; });
  const before = await (await fetch(`http://127.0.0.1:${port(first)}/healthz`)).json();
  assert.equal(before.state, 'needs-config');
  // A saved keyless connection still exercises the native credential read pipe
  // (NoEntry) and verifies that model metadata is restored after a crash.
  await mkdir(join(dir, '.data'), { recursive: true });
  await writeFile(join(dir, '.data/models.json'), JSON.stringify({connections:[{id:account,name:'Smoke service',provider:'openai-compatible',baseUrl:'http://127.0.0.1:9/v1',modelId:'fixture',requiresKey:false}],selected:{connectionId:account,modelId:'fixture'}}));
  kill(first);
  sidecar = await eventually(() => { const pid = children()[0]; return pid !== first && port(pid) ? pid : null; });
  const after = await (await fetch(`http://127.0.0.1:${port(sidecar)}/healthz`)).json();
  assert.notEqual(after.epoch, before.epoch);
  assert.equal(after.state, 'ready', `${JSON.stringify(after)} ${logs}`);
  assert.equal(after.credentials.storage, 'keychain');
  assert.equal(after.credentials.available, true);
  kill(child.pid, 'SIGTERM');
  await eventually(() => { try { process.kill(sidecar, 0); return false; } catch { return true; } });
  console.log('Native bundle: startup, saved configuration and keychain bridge after crash restart, parent-exit cleanup passed');
} finally {
  for (const pid of [...children(), sidecar, child.pid]) kill(pid);
  if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('exit', resolve));
  await rm(dir, { recursive: true, force: true });
}
