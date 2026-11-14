/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { closeSync, openSync, appendFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { eventSchema, type DriverEvent } from './service-tool-recorders.js';

export const serviceCrashRoot = resolve(
  import.meta.dir,
  '../../../../../../tmp/854-notes/p4/w21/service-crash',
);
export async function serviceToolChild(
  role: 'primary' | 'none',
  mode: 'crash' | 'clean',
) {
  await mkdir(join(serviceCrashRoot, 'fixtures'), { recursive: true });
  const directory = await mkdtemp(
    join(serviceCrashRoot, 'fixtures', `${role}-${mode}-`),
  );
  const stdout = openSync(join(directory, 'stdout.log'), 'wx');
  const stderr = openSync(join(directory, 'stderr.log'), 'wx');
  const events: DriverEvent[] = [];
  const command = [
    process.execPath,
    join(import.meta.dir, 'service-tool-crash-driver.ts'),
    directory,
    role,
    mode,
  ];
  const child = Bun.spawn(command, {
    cwd: resolve(import.meta.dir, '../../../..'),
    stdout,
    stderr,
    ipc(input: unknown): void {
      const event = eventSchema.parse(input);
      if (event.pid !== child.pid) throw new Error('Driver PID mismatch');
      events.push(event);
      appendFileSync(
        join(directory, 'events.jsonl'),
        JSON.stringify(event) + '\n',
      );
    },
  });
  await writeFile(
    join(directory, 'process.json'),
    JSON.stringify({
      pid: child.pid,
      parent: process.pid,
      role,
      mode,
      command,
    }),
  );
  let exited = false;
  void child.exited.then(() => {
    exited = true;
  });
  return {
    directory,
    child,
    send(command: 'next' | 'probe' | 'release' | 'respond'): void {
      child.send(command);
    },
    async wait(type: string): Promise<DriverEvent> {
      const deadline = Date.now() + 30000;
      for (;;) {
        const found = events.find((event) => event.type === type);
        if (found !== undefined) return found;
        const failure = events.find((event) => event.type === 'send-error');
        if (failure !== undefined || exited || Date.now() > deadline)
          throw new Error(
            `Driver ${child.pid} missing ${type}: ${JSON.stringify(events)}; logs ${directory}`,
          );
        await Bun.sleep(5);
      }
    },
    async close(): Promise<void> {
      if (!exited) {
        child.kill('SIGKILL');
        await child.exited;
      }
      closeSync(stdout);
      closeSync(stderr);
    },
  };
}
