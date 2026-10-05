import { createReadStream } from 'node:fs';
import { copyFile, chmod, link, lstat, open, readdir, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';

const digest = async path => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};

async function filesIn(dir) {
  const files = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (entry.isFile()) files.push({ path, ...await lstat(path) });
    // Preserve pnpm's symlinks without following them outside the deployment.
  }
  return files;
}

async function isMachO(path) {
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(4);
    await file.read(header, 0, 4, 0);
    return ['cefaedfe', 'cffaedfe', 'feedface', 'feedfacf', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(header.toString('hex'));
  } finally { await file.close(); }
}

export async function stripAndSign(path) {
  const { mode } = await lstat(path);
  const temporary = `${path}.seris-${randomUUID()}`;
  try {
    // Deployments may share inodes with pnpm's store. Never modify those inodes.
    await copyFile(path, temporary);
    await chmod(temporary, mode & 0o777);
    execFileSync('strip', ['-x', temporary], { stdio: ['ignore', 'ignore', 'pipe'] });
    execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', temporary], { stdio: ['ignore', 'ignore', 'pipe'] });
    execFileSync('codesign', ['--verify', '--strict', temporary], { stdio: ['ignore', 'ignore', 'pipe'] });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export async function optimizeRuntime(root, { stripNative = process.platform === 'darwin' } = {}) {
  const files = await filesIn(root);
  const stats = { originalBytes: files.reduce((n, f) => n + f.size, 0), prunedFiles: 0, strippedFiles: 0, linkedFiles: 0, storedBytes: 0 };
  const native = new Map();
  for (const file of files) {
    const dependency = relative(root, file.path).split(sep)[0] === 'node_modules';
    if (dependency && /(?:\.map|\.d\.(?:ts|mts|cts))$/.test(file.path)) {
      await rm(file.path);
      stats.prunedFiles++;
      continue;
    }
    if (stripNative && await isMachO(file.path)) {
      const key = `${file.mode}:${file.size}:${await digest(file.path)}`;
      const existing = native.get(key);
      if (existing) {
        await rm(file.path);
        await link(existing, file.path);
      } else {
        await stripAndSign(file.path);
        native.set(key, file.path);
        stats.strippedFiles++;
      }
    }
  }
  const identical = new Map();
  for (const file of await filesIn(root)) {
    const key = `${file.mode}:${file.size}:${await digest(file.path)}`;
    const existing = identical.get(key);
    if (existing) {
      await rm(file.path);
      await link(existing, file.path);
      stats.linkedFiles++;
    } else {
      identical.set(key, file.path);
      stats.storedBytes += file.size;
    }
  }
  return stats;
}
