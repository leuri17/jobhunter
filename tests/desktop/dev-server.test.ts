/**
 * Exit-code contract of the UI dev-server supervisor
 * (`desktop/ui/scripts/dev-server.mjs`, wired into `@jobhunter/ui`'s `dev`
 * script). A shutdown initiated by a termination signal the supervisor
 * forwarded must exit 0, so pnpm's recursive-run layer does not render the
 * deliberate SIGTERM from `tauri dev` teardown as a failure block; genuine
 * child failures keep their exit code.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const SUPERVISOR = fileURLToPath(
  new URL('../../desktop/ui/scripts/dev-server.mjs', import.meta.url),
);

function supervise(childCode: string): ChildProcess {
  return spawn(process.execPath, [SUPERVISOR, process.execPath, '-e', childCode], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function exitCode(proc: ChildProcess): Promise<number | null> {
  const [code] = (await once(proc, 'exit')) as [number | null, string | null];
  return code;
}

async function waitFor(stdout: Readable, text: string): Promise<void> {
  for await (const chunk of stdout) {
    if (String(chunk).includes(text)) return;
  }
  throw new Error(`expected "${text}" in supervised child output before exit`);
}

describe('dev-server supervisor exit contract', () => {
  it('exits 0 when it forwarded the SIGTERM that stopped the child', async () => {
    const proc = supervise('console.log("SUPERVISED_READY"); setInterval(() => {}, 1_000);');
    await waitFor(proc.stdout!, 'SUPERVISED_READY');
    proc.kill('SIGTERM');
    expect(await exitCode(proc)).toBe(0);
  });

  it('propagates the child exit code when the child fails on its own', async () => {
    const proc = supervise('process.exit(7);');
    expect(await exitCode(proc)).toBe(7);
  });

  it('exits non-zero when the child dies by a signal it did not forward', async () => {
    const proc = supervise('process.kill(process.pid, "SIGKILL");');
    expect(await exitCode(proc)).toBe(1);
  });
});
