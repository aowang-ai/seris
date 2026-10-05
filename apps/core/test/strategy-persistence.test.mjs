import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Load each release in a fresh process so PKG_ROOT, module caches and app data
// have the same lifetimes as a real packaged application upgrade.
test('packaged upgrade migrates drafts and preserves them after every old cache is removed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'seris-strategy-upgrade-'));
  const core = fileURLToPath(new URL('../', import.meta.url));
  const cache = join(dir, 'cache/core');
  const data = join(dir, 'app-data');
  const first = join(cache, 'bbbbbbbbbbbbbbbb');
  const second = join(cache, 'dddddddddddddddd');
  const simple = name => `import { sma } from '@seris/strategy';\nexport const strategy = { name: '${name}', description: 'Durable draft', timeframe: '1h', params: {}, warmup: () => 1, onCandle: candles => { sma(candles, 1); return { kind: 'hold' }; } };`;
  const put = async (root, name, source, doc = '# Strategy') => {
    const skill = join(root, 'skills/strategies', name);
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, 'strategy.ts'), source);
    await writeFile(join(skill, 'SKILL.md'), doc);
    return join(skill, 'strategy.ts');
  };
  const prepare = async pkg => {
    await mkdir(pkg, { recursive: true });
    await cp(join(core, 'dist'), join(pkg, 'dist'), { recursive: true });
    await cp(join(core, 'package.json'), join(pkg, 'package.json'));
    await cp(join(core, 'skills/strategies/ma-trail-stop'), join(pkg, 'skills/strategies/ma-trail-stop'), { recursive: true });
    await symlink(join(core, 'node_modules'), join(pkg, 'node_modules'), 'dir');
  };
  const run = (pkg, code) => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: pkg, encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, SERIS_DATA_DIR: data, SERIS_LEGACY_CORE_DIR: cache },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  };
  try {
    const baseline = await readFile(join(core, 'skills/strategies/ma-trail-stop/strategy.ts'), 'utf8');
    const legacy = baseline.replaceAll('ma-trail-stop', 'legacy-draft')
      .replace("import type { Candle, Strategy } from '@seris/strategy';", "import type { Candle, Strategy } from '../../../dist/strategy/types.js';")
      .replace("import { atr, highest, sma } from '@seris/strategy';", "import { atr, highest, sma } from '../../../dist/strategy/indicators.js';");
    const original = await put(join(cache, 'aaaaaaaaaaaaaaaa'), 'legacy-draft', legacy);
    const older = await put(join(cache, 'aaaaaaaaaaaaaaaa'), 'duplicate-draft', simple('duplicate-draft').replace('Durable draft', 'older copy'));
    await utimes(older, new Date(1000), new Date(1000));
    const newer = await put(join(cache, 'cccccccccccccccc'), 'duplicate-draft', simple('duplicate-draft').replace('Durable draft', 'newer copy'));
    await utimes(newer, new Date(2000), new Date(2000));
    await put(join(cache, 'aaaaaaaaaaaaaaaa'), 'durable-wins', simple('durable-wins').replace('Durable draft', 'cached copy'));
    const authoritative = await put(data, 'durable-wins', simple('durable-wins').replace('Durable draft', 'user edited copy'));
    await prepare(first);
    run(first, `
      import assert from 'node:assert/strict';
      import { scanStrategies, getStrategyByName } from './dist/strategy/loader.js';
      import { strategySaveDraftTool } from './dist/tools/strategies.js';
      import { strategyRoute } from './dist/gateway/strategies.js';
      import { SkillRegistry } from './dist/skills/registry.js';
      import { installedSkillsRoot } from './dist/runtime/paths.js';
      const catalogs = await Promise.all([scanStrategies(), scanStrategies()]);
      for (const entries of catalogs) assert.ok(entries.every(e => e.problems.length === 0));
      assert.equal((await getStrategyByName('duplicate-draft')).strategy.description, 'newer copy');
      assert.equal((await getStrategyByName('durable-wins')).strategy.description, 'user edited copy');
      const fresh = await strategySaveDraftTool.execute('approved-save', {
        name: 'fresh-draft', description: 'Fresh: persisted', source: ${JSON.stringify(simple('fresh-draft'))}
      });
      assert.equal(fresh.details.valid, true, JSON.stringify(fresh.details.problems));
      assert.equal(fresh.details.dir, ${JSON.stringify(join(data, 'skills/strategies/fresh-draft'))});
      await assert.rejects(strategySaveDraftTool.execute('duplicate-save', {name:'ma-trail-stop',source:${JSON.stringify(simple('ma-trail-stop'))}}), /already exists/);
      const route = await strategyRoute('/api/strategies/get', 'GET', new URL('http://localhost/api/strategies/get?name=legacy-draft'), async () => null);
      assert.equal(route.valid, true);
      const skills = await SkillRegistry.load('./skills', [installedSkillsRoot()]);
      const freshSkill = await skills.dispatch('fresh-draft');
      assert.equal(freshSkill.description, 'Fresh: persisted');
      assert.deepEqual(freshSkill.problems, []);
    `);
    assert.equal(await readFile(join(data, 'skills/strategies/legacy-draft/strategy.ts'), 'utf8'), legacy);
    assert.equal(await readFile(original, 'utf8'), legacy, 'migration leaves the original available for recovery');
    assert.match(await readFile(authoritative, 'utf8'), /user edited copy/);
    await prepare(second);
    for (const id of ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc']) await rm(join(cache, id), { recursive: true, force: true });
    run(second, `
      import assert from 'node:assert/strict';
      import { scanStrategies, getStrategyByName } from './dist/strategy/loader.js';
      import { runBacktest } from './dist/strategy/runner.js';
      const entries = await scanStrategies();
      assert.deepEqual(entries.map(e => e.name).sort(), ['ma-trail-stop','legacy-draft','fresh-draft','duplicate-draft','durable-wins'].sort());
      assert.ok(entries.every(e => e.problems.length === 0), JSON.stringify(entries));
      for (const name of ['legacy-draft', 'fresh-draft']) {
        const loaded = await getStrategyByName(name);
        const candles = Array.from({length:100}, (_,i) => ({time:1700000000000+i*3600000,open:100+i,high:102+i,low:99+i,close:101+i,volume:1000}));
        const result = await runBacktest({strategy:loaded.strategy,candles,initialCash:10000});
        assert.ok(Number.isFinite(result.finalEquity));
        assert.equal(result.candles,100);
      }
    `);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
