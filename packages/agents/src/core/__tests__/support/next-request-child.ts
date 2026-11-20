/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { openSync, closeSync, appendFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { eventSchema, type DriverEvent } from './service-tool-recorders.js';
import type { Variant, Ending } from './next-request-runtime.js';

export const variantsRoot = resolve(
  import.meta.dir,
  '../../../../../../tmp/854-notes/p4/w21/next-request-variants',
);
async function waitEvent(
  events: readonly DriverEvent[],
  type: string,
  exited: () => boolean,
  directory: string,
): Promise<DriverEvent> {
  const deadline = Date.now() + 30000;
  for (;;) {
    const found = events.find((event) => event.type === type);
    if (found !== undefined) return found;
    if (
      exited() ||
      events.some((event) => event.type === 'send-error') ||
      Date.now() > deadline
    )
      throw new Error(
        `Missing ${type}: ${JSON.stringify(events)}; logs ${directory}`,
      );
    await Bun.sleep(5);
  }
}
export async function nextRequestChild(
  variant: Variant,
  role: 'primary',
  group: number,
  ending: Ending,
) {
  await mkdir(join(variantsRoot, 'fixtures'), { recursive: true });
  const directory = await mkdtemp(
    join(variantsRoot, 'fixtures', `${variant}-${role}-${group}-${ending}-`),
  );
  const stdout = openSync(join(directory, 'stdout.log'), 'wx');
  const stderr = openSync(join(directory, 'stderr.log'), 'wx');
  const events: DriverEvent[] = [];
  const command = [
    process.execPath,
    join(import.meta.dir, 'next-request-driver.ts'),
    directory,
    variant,
    role,
    String(group),
    ending,
  ];
  const child = Bun.spawn(command, {
    cwd: resolve(import.meta.dir, '../../../..'),
    stdout,
    stderr,
    env: {
      ...process.env,
      LLXPRT_DATA_HOME: join(directory, 'data'),
      LLXPRT_CONFIG_HOME: join(directory, 'config'),
      LLXPRT_CACHE_HOME: join(directory, 'cache'),
      LLXPRT_LOG_HOME: join(directory, 'logs'),
      LLXPRT_AGENTS_HOME: join(directory, 'agents'),
    },
    ipc(input: unknown): void {
      const event = eventSchema.parse(input);
      if (event.pid !== child.pid) throw new Error('Child PID mismatch');
      events.push(event);
      appendFileSync(
        join(directory, 'events.jsonl'),
        JSON.stringify(event) + '\n',
      );
    },
  });
  await writeFile(
    join(directory, 'process.json'),
    JSON.stringify({ pid: child.pid, parent: process.pid, command }),
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
    wait: (type: string): Promise<DriverEvent> =>
      waitEvent(events, type, () => exited, directory),
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
