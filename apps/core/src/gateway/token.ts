/**
 * gateway/token.ts — bearer token for the loopback gateway.
 *
 * Minted fresh on every boot; the Tauri shell (or a dev user) discovers it
 * from the gateway's "ready at" stdout line. Browser startup uses a one-use ticket; SSE uses an authenticated fetch.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

export type BearerToken = string;

export function mintBearerToken(): BearerToken {
  return randomBytes(24).toString('base64url');
}

export function fingerprint(token: BearerToken): string {
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/** Compare the bearer without leaking matching prefix lengths. */
export function verifyBearer(headerValue: string | undefined, token: BearerToken): boolean {
  if (!headerValue) return false;
  const m = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  if (!m) return false;
  const actual=Buffer.from(m[1]),expected=Buffer.from(token);
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
