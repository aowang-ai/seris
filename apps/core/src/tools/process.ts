import { spawn } from 'node:child_process';

/** Bounded output, cancellation and process-tree cleanup for local execution. */
export function runProcess(file: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal }): Promise<{ stdout: string; stderr: string; code: number; timedOut: boolean }> {
  opts.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: opts.cwd, env: opts.env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', bytes = 0, timedOut = false, limitHit = false;
    const kill = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill());
      } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, opts.timeoutMs);
    const cancel = () => kill();
    opts.signal?.addEventListener('abort', cancel, { once: true });
    if (opts.signal?.aborted) cancel();
    const capture = (target: 'stdout' | 'stderr', data: Buffer) => {
      bytes += data.length;
      if (bytes > 512 * 1024) { limitHit = true; kill(); return; }
      if (target === 'stdout') stdout += data.toString('utf8'); else stderr += data.toString('utf8');
    };
    child.stdout.on('data', d => capture('stdout', d)); child.stderr.on('data', d => capture('stderr', d));
    const cleanup = () => { clearTimeout(timer); opts.signal?.removeEventListener('abort', cancel); };
    child.on('error', e => { cleanup(); reject(e); });
    child.once('exit', () => kill()); // pipe handles may be held open by background children
    child.on('close', code => {
      cleanup(); kill(); // also reap detached grandchildren after the parent exits
      if (opts.signal?.aborted) reject(opts.signal.reason);
      else resolve({ stdout, stderr: stderr + (limitHit ? '\nOutput limit exceeded' : ''), code: code ?? 1, timedOut });
    });
  });
}
export function executionEnv(tempHome?: string): NodeJS.ProcessEnv {
  const keys = ['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'COMSPEC'];
  return { ...Object.fromEntries(keys.filter(k => process.env[k]).map(k => [k, process.env[k]])),
    HOME: tempHome, NODE_ENV: 'production' };
}
