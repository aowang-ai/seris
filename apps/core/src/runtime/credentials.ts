import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

export interface SecretStore {
  readonly storage: 'keychain' | 'memory';
  read(id: string): Promise<string | undefined>;
  write(id: string, key: string): Promise<void>;
  delete(id: string): Promise<void>;
}
export class MemorySecrets implements SecretStore {
  readonly storage = 'memory';
  private keys = new Map<string, string>();
  async read(id: string) {
    return this.keys.get(id);
  }
  async write(id: string, key: string) {
    this.keys.set(id, key);
  }
  async delete(id: string) {
    this.keys.delete(id);
  }
}
/** The native parent owns the OS keychain; requests stay on private pipes, outside UI and logs. */
export function createSecretStore(): SecretStore {
  if (process.env.SERIS_SECRET_STORE !== 'keyring') return new MemorySecrets();
  const pending = new Map<
    string,
    {
      resolve: (key?: string) => void;
      reject: (error: Error) => void;
      timer?: NodeJS.Timeout;
    }
  >();
  const lines = createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    let response: { type?: string; id?: string; key?: string; error?: string };
    try {
      response = JSON.parse(line);
    } catch {
      return;
    }
    if (!response || response.type !== 'credential' || !response.id) return;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timer);
    if (response.error)
      request.reject(new Error('System credential store is unavailable'));
    else
      request.resolve(
        typeof response.key === 'string' ? response.key : undefined,
      );
  });
  lines.on('close', () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Native credential connection closed'));
    }
    pending.clear();
  });
  const request = (
    op: 'read' | 'write' | 'delete',
    account: string,
    key?: string,
  ) =>
    new Promise<string | undefined>((resolve, reject) => {
      const id = randomUUID();
      // Reads bound startup time; writes wait for the OS dialog so a delayed success
      // cannot change a key after the caller has already reported failure.
      const timer =
        op === 'read'
          ? setTimeout(() => {
              pending.delete(id);
              reject(new Error('System credential store timed out'));
            }, 20000)
          : undefined;
      pending.set(id, { resolve, reject, timer });
      process.stdout.write(
        `seris credential ${JSON.stringify({ id, op, account, key })}\n`,
      );
    });
  return {
    storage: 'keychain',
    read: (id) => request('read', id),
    write: async (id, key) => {
      await request('write', id, key);
    },
    delete: async (id) => {
      await request('delete', id);
    },
  };
}
