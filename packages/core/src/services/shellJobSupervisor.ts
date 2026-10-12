/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SupervisorCommand {
  executable: string;
  args: string[];
  cwd: string;
  graceMs: number;
}

// This function is the subprocess entry: keep runtime dependencies inside it.
// Its compiled body travels through the ordinary core module/bundle graph.
export async function runShellSupervisor(
  input: SupervisorCommand,
): Promise<void> {
  const { spawn } = await import('node:child_process');
  const { writeSync } = await import('node:fs');
  const { createInterface } = await import('node:readline');
  const report = (message: object): void => {
    try {
      writeSync(1, `${JSON.stringify(message)}\n`);
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'EPIPE')
      )
        throw error;
    }
  };
  let stopping = false;
  process.on('SIGTERM', () => {});
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    report({ event: 'stopping' });
    process.kill(-process.pid, 'SIGTERM');
    setTimeout(() => process.kill(-process.pid, 'SIGKILL'), input.graceMs);
  };
  const control = createInterface({ input: process.stdin });
  control.on('line', stop);
  control.on('close', stop);
  const command = spawn(input.executable, input.args, {
    cwd: input.cwd,
    detached: false,
    stdio: ['ignore', 2, 2],
  });
  command.once('exit', (exitCode, signal) => {
    report({ event: 'result', exitCode, signal });
    stop();
  });
  command.once('error', (error) => {
    report({ event: 'error', message: error.message });
    stop();
  });
}

export function shellSupervisorSource(input: SupervisorCommand): string {
  return `(${runShellSupervisor.toString()})(${JSON.stringify(input)}).catch(error => { console.error(error); process.exit(1); });`;
}
