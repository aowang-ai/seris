/** Verify two actual macOS bundles against disposable data, without a checkout or system Node. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [oldApp, newApp] = process.argv.slice(2).map(path => resolve(path));
if (!oldApp || !newApp) throw new Error('Usage: node verify-upgrade.mjs OLD.app NEW.app (requires Binance public API access)');
const root = await mkdtemp(join(tmpdir(), 'seris-bundle-upgrade-'));
const data = join(root, 'app-data');
const env = Object.fromEntries(['HOME', 'TMPDIR', 'USER', 'LOGNAME', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
Object.assign(env, { PATH: '', SERIS_DATA_DIR: data, SERIS_LEGACY_CORE_DIR: join(root, 'legacy-core') });
async function unpack(app, name) {
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  const resources = join(app, 'Contents/Resources');
  const core = join(root, name);
  await mkdir(core);
  execFileSync('tar', ['-xzf', join(resources, 'core.tar.gz'), '-C', core]);
  return { core, node: join(resources, 'runtime/node') };
}
async function gateway(bundle) {
  const child = spawn(bundle.node, ['dist/gateway/server.js'], { cwd: bundle.core, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stderr.on('data', d => { logs = (logs + d).slice(-4000); });
  const launchUrl = await new Promise((ok, fail) => {
    const timer = setTimeout(() => { child.kill(); fail(new Error(`Packaged gateway startup timed out: ${logs}`)); }, 60000);
    let out = '';
    child.stdout.on('data', d => {
      out += d;
      const match = out.match(/seris ready at (http:\/\/127\.0\.0\.1:\d+\/\?ticket=[^\s]+)/);
      if (match) { clearTimeout(timer); ok(match[1]); }
    });
    child.once('error', e => { clearTimeout(timer); fail(e); });
    child.once('exit', code => { clearTimeout(timer); fail(new Error(`Packaged gateway exited ${code}: ${logs}`)); });
  });
  const launch = new URL(launchUrl);
  const bootstrap = await fetch(`${launch.origin}/api/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: launch.searchParams.get('ticket') }) });
  assert.equal(bootstrap.status, 200);
  const { token } = await bootstrap.json();
  return {
    async get(path) {
      const response = await fetch(launch.origin + path, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200, path);
      return response.json();
    },
    async close() {
      child.kill('SIGTERM');
      if (child.exitCode === null && child.signalCode === null) await new Promise(ok => child.once('exit', ok));
    },
  };
}
let active;
try {
  const old = await unpack(oldApp, 'old-core');
  const current = await unpack(newApp, 'new-core');
  assert.match(JSON.parse(await readFile(join(old.core, 'package.json'))).version, /-beta\./);
  assert.equal(JSON.parse(await readFile(join(current.core, 'package.json'))).version, '0.1.0');
  await mkdir(join(data, '.data'), { recursive: true });
  // Keyless metadata exercises migration without touching the user's credentials.
  const models = { connections: [{ id: 'upgrade-verification', name: 'Upgrade verification', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', modelId: 'verification-only', requiresKey: false }], selected: { connectionId: 'upgrade-verification', modelId: 'verification-only' } };
  await writeFile(join(data, '.data/models.json'), JSON.stringify(models));
  const seed = `
    import assert from 'node:assert/strict';
    import { readFile, writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    import { SessionStore } from './dist/runtime/sessionStore.js';
    import { MarketService } from './dist/markets/service.js';
    import { instrumentFromId } from './dist/markets/instruments.js';
    import { strategySaveDraftTool } from './dist/tools/strategies.js';
    import { getStrategyByName } from './dist/strategy/loader.js';
    import { getKlinesTool } from './dist/tools/market-data.js';
    import { runBacktest } from './dist/strategy/runner.js';
    import { saveBacktestRun } from './dist/strategy/store.js';
    const store = await SessionStore.open(join(process.env.SERIS_DATA_DIR, 'sessions'));
    const session = await store.create();
    await store.setName(session.id, 'Beta to stable upgrade');
    await store.append(session.id, {role:'user',content:'Keep this conversation after upgrading.',timestamp:Date.now()});
    await store.close();
    const watchlist = new MarketService().add(instrumentFromId('binance-tradifi:NVDAUSDT'));
    const source = (await readFile('./skills/strategies/ma-trail-stop/strategy.ts','utf8')).replaceAll('ma-trail-stop','upgrade-preserved');
    const saved = await strategySaveDraftTool.execute('upgrade-save', {name:'upgrade-preserved',description:'Upgrade verification',source});
    assert.equal(saved.details.valid,true,JSON.stringify(saved.details.problems));
    const candles = (await getKlinesTool.execute('real-candles',{symbol:'BTCUSDT',interval:'1h',limit:200})).details.candles.filter(c => c.closeTime < Date.now());
    assert.ok(candles?.length >= 100, 'Real Binance candles must be available');
    const loaded = await getStrategyByName('upgrade-preserved');
    const detail = await runBacktest({strategy:loaded.strategy,candles,initialCash:10000});
    const summary = await saveBacktestRun({strategyName:'upgrade-preserved',symbol:'BTCUSDT',interval:'1h',params:detail.params,initialCash:10000,finalEquity:detail.finalEquity,candles:detail.candles,metrics:detail.metrics,startedAt:Date.now(),endedAt:Date.now()},detail);
    await writeFile(${JSON.stringify(join(root, 'expected.json'))},JSON.stringify({sessionId:session.id,watchlist,source,summary,detail}));
  `;
  await writeFile(join(old.core, 'seed-upgrade.mjs'), seed);
  execFileSync(old.node, ['seed-upgrade.mjs'], { cwd: old.core, env, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  const expected = JSON.parse(await readFile(join(root, 'expected.json')));
  async function verify(bundle, label) {
    active = await gateway(bundle);
    const sessions = await active.get('/api/sessions');
    assert.equal(sessions.find(s => s.id === expected.sessionId)?.name, 'Beta to stable upgrade');
    const snapshot = await active.get(`/api/sessions/${expected.sessionId}/snapshot`);
    assert.ok(JSON.stringify(snapshot).includes('Keep this conversation after upgrading.'));
    const config = await active.get('/api/config');
    assert.deepEqual(config.selected, models.selected);
    assert.equal(config.connections[0].name, models.connections[0].name);
    assert.equal(config.configured, true);
    assert.deepEqual((await active.get('/api/markets/state')).watchlist, expected.watchlist);
    const strategy = await active.get('/api/strategies/get?name=upgrade-preserved');
    assert.equal(strategy.valid, true);
    assert.equal(strategy.source, expected.source);
    assert.ok((await active.get('/api/strategies/backtests?name=upgrade-preserved')).runs.some(r => r.id === expected.summary.id));
    assert.deepEqual(await active.get(`/api/strategies/backtests/get?id=${expected.summary.id}`), expected.detail);
    await active.close(); active = null;
    console.log(`${label}: model metadata, conversation, watchlist, strategy source and ${expected.detail.candles} real-candle backtest details preserved`);
  }
  await verify(old, 'Published Beta baseline');
  await verify(current, '0.1.0 upgrade');
  await rm(old.core, { recursive: true, force: true });
  await verify(current, '0.1.0 restart after removing old runtime');
  console.log('Packaged upgrade passed without the checkout, system Node or old runtime');
} finally {
  await active?.close();
  if (process.env.SERIS_VERIFY_KEEP === '1') console.log(`Verification data kept at ${root}`);
  else await rm(root, { recursive: true, force: true });
}
