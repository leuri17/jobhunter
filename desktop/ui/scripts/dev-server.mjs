/**
 * Signal-forwarding supervisor for the UI dev server (`dev` script).
 *
 * `tauri dev` tears its `beforeDevCommand` down with a termination signal on
 * app close; when pnpm's recursive-run layer parents vite directly, that
 * deliberate kill is rendered as ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL (exit
 * status 143). This supervisor owns the child instead: it forwards the
 * signal (escalating to SIGKILL after 5s, mirroring `stop_sidecar` in
 * desktop/tauri/src/sidecar.rs) and exits 0 when shutdown was initiated by
 * a forwarded signal. Any other child exit is propagated unchanged so
 * genuine dev-server failures still surface.
 */
import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);

const child = spawn(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

let shutdownInitiated = false;

function forward(signal) {
  shutdownInitiated = true;
  child.kill(signal);
  setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
}

process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));

child.on('exit', (code) => {
  process.exit(shutdownInitiated ? 0 : (code ?? 1));
});

child.on('error', (error) => {
  console.error(`dev-server: failed to start '${String(command)}': ${error.message}`);
  process.exit(1);
});
