/** runtime/paths.ts — workspace paths. */

import { join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = fileURLToPath(new URL('.', import.meta.url));
export const PKG_ROOT = join(SRC_DIR, '..', '..');

export function dataRoot(): string { return resolve(process.env.SERIS_DATA_DIR?.trim() || process.cwd()); }
export function dataPath(...parts: string[]): string { return join(dataRoot(), '.data', ...parts); }
export function workspaceRoot(): string { return resolve(process.env.SERIS_WORKSPACE?.trim() || join(dataRoot(), 'workspace')); }

export function resolveSkillsRoot(): string {
  const env = process.env.SERIS_SKILLS_DIR?.trim();
  if (env) return isAbsolute(env) ? env : join(process.cwd(), env);
  return join(PKG_ROOT, 'skills');
}

export function installedSkillsRoot(): string { return join(dataRoot(), 'skills'); }

export function ensureArtifactsDir(): string {
  return process.env.SERIS_ARTIFACTS_DIR?.trim() || dataPath('artifacts');
}
