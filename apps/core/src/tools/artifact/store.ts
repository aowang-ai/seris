/** Shared artifact storage helpers. */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { dataPath } from '../../runtime/paths.js';

export function artifactsDir(): string {
  const env = process.env.SERIS_ARTIFACTS_DIR;
  return env ? resolve(env) : dataPath('artifacts');
}

export async function ensureDir(): Promise<string> {
  const dir = artifactsDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact';
}

export async function writeArtifact(
  filename: string,
  data: Buffer | Uint8Array,
): Promise<{ path: string; bytes: number }> {
  const dir = await ensureDir();
  const safe = sanitizeFilename(filename);
  const path = join(dir, safe);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  await writeFile(path, buf);
  return { path, bytes: buf.length };
}
