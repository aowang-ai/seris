/**
 * smoke-seris.ts — end-to-end check of the in-process runtime (no Electron).
 * Creates a session, fires one prompt, prints streamed events, prints history.
 *
 *   pnpm build && ANTHROPIC_AUTH_TOKEN=… node dist/smoke-seris.js
 */

import { mkdtempSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSerisRuntime } from './runtime/createSerisRuntime.js';

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'seris-smoke-'));
  process.env.SERIS_DATA_DIR = dir;
  const runtime = await createSerisRuntime({ sessionsRoot:join(dir,'sessions'), cwd:join(dir,'workspace') });
  try {
  assert.ok(runtime.configured, 'Set a model API key for this live smoke');

  runtime.onEvent((e) => {
    if (e.type === 'text-delta') process.stdout.write(e.delta ?? '');
    else console.log(`\n[event ${e.type}] ${e.toolName ?? e.error ?? ''}`);
  });

  const session = await runtime.createSession();
  console.log('session:', session.id);

  const q = process.argv[2] ?? 'What is the current BTC funding rate on Hyperliquid? One short sentence.';
  console.log('prompt:', q, '\n---');
  await runtime.prompt(session.id, q);
  console.log('\n---\nhistory:');
  console.log((await runtime.sessionHistory(session.id)).map((h) => `${h.role}: ${h.text.slice(0, 80)}`));

  assert.equal(runtime.runState(session.id)?.status,'completed',runtime.runState(session.id)?.error);
  console.log('OK');
  } finally { await runtime.dispose(); rmSync(dir,{recursive:true,force:true}); }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
