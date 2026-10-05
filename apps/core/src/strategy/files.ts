/** User strategies belong to app data, never to a versioned runtime cache. */
import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { installedSkillsRoot, PKG_ROOT } from '../runtime/paths.js';

export function userStrategiesRoot(): string { return join(installedSkillsRoot(), 'strategies'); }
export function bundledStrategiesRoot(): string { return join(PKG_ROOT, 'skills', 'strategies'); }
export function validStrategyName(name: unknown): name is string {
  return typeof name === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(name);
}

const migrations = new Map<string, Promise<void>>();

async function directories(root: string): Promise<string[]> {
  try { return (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

function legacyCacheRoot(): string | undefined {
  // An explicit root also lets distribution tests keep migration isolated.
  if (process.env.SERIS_LEGACY_CORE_DIR) return resolve(process.env.SERIS_LEGACY_CORE_DIR);
  if (/^[a-f0-9]{16}$/.test(basename(PKG_ROOT)) && basename(dirname(PKG_ROOT)) === 'core') return dirname(PKG_ROOT);
  return undefined;
}

async function migrate(cacheRoot: string | undefined, target: string): Promise<void> {
  const packages = [PKG_ROOT];
  if (cacheRoot) {
    for (const id of await directories(cacheRoot)) {
      if (/^[a-f0-9]{16}$/.test(id)) packages.push(join(cacheRoot, id));
    }
  }
  const candidates: { name: string; dir: string; modified: number }[] = [];
  for (const pkg of new Set(packages)) {
    const root = join(pkg, 'skills', 'strategies');
    for (const name of await directories(root)) {
      // This was the sole built-in strategy in the affected releases.
      if (!validStrategyName(name) || name === 'ma-trail-stop') continue;
      const dir = join(root, name);
      try { candidates.push({ name, dir, modified: (await stat(join(dir, 'strategy.ts'))).mtimeMs }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  candidates.sort((a, b) => b.modified - a.modified || a.dir.localeCompare(b.dir));
  for (const candidate of candidates) {
    const dest = join(target, candidate.name);
    if (existsSync(dest)) continue; // The user's durable copy always wins.
    await mkdir(target, { recursive: true });
    const staging = join(target, `.migration-${randomUUID()}`);
    try {
      await cp(candidate.dir, staging, { recursive: true });
      if (!existsSync(dest)) await rename(staging, dest);
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
}

/** Copy legacy drafts atomically; leave originals available for recovery. */
export async function ensureStrategyStorage(): Promise<void> {
  const target = userStrategiesRoot();
  const cache = legacyCacheRoot();
  const key = `${target}\0${cache ?? ''}`;
  let pending = migrations.get(key);
  if (!pending) {
    pending = migrate(cache, target).catch(error => { migrations.delete(key); throw error; });
    migrations.set(key, pending);
  }
  await pending;
}

export async function findStrategyDirectory(name: string): Promise<string | null> {
  if (!validStrategyName(name)) return null;
  await ensureStrategyStorage();
  for (const root of [userStrategiesRoot(), bundledStrategiesRoot()]) {
    const dir = join(root, name);
    if (existsSync(join(dir, 'strategy.ts'))) return dir;
  }
  return null;
}
