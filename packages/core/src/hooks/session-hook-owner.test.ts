import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Config } from '../config/config.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { SessionHookOwner } from './session-hook-owner.js';
import {
  hookSessionRuntime,
  readHookDefinitions,
} from './hook-configuration.js';
import {
  HookEventName,
  HookType,
  SessionStartSource,
  SessionEndReason,
} from './types.js';
import { escapeShellArg } from '../utils/shell-utils.js';

const directories: string[] = [];
const roots: SessionHookOwner[] = [];

async function setup(): Promise<{
  directory: string;
  config: Config;
  root: SessionHookOwner;
  trust: WorkspaceTrustLifecycle;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'llxprt-session-hook-'));
  directories.push(directory);
  const script = join(directory, 'hook.ts');
  await writeFile(
    script,
    `import { appendFileSync, writeFileSync } from 'node:fs';
const input = JSON.parse(await Bun.stdin.text());
appendFileSync('events.jsonl', JSON.stringify(input) + '\\n');
writeFileSync(input.hook_event_name + '.admitted', input.session_id);
if (input.hook_event_name === 'BeforeTool') await Bun.sleep(1100);
writeFileSync(input.hook_event_name + '.finished', input.cwd);
console.log(JSON.stringify({systemMessage: input.session_id}));
`,
  );
  const hook = {
    type: HookType.Command,
    command: `exec ${escapeShellArg(process.execPath, 'bash')} ${escapeShellArg(script, 'bash')}`,
  };
  const config = new Config({
    sessionId: 'same-label',
    targetDir: directory,
    cwd: directory,
    model: 'hook',
    debugMode: false,
    enableHooks: true,
    trustedFolder: true,
    hooks: {
      [HookEventName.BeforeTool]: [{ hooks: [hook] }],
      [HookEventName.SessionStart]: [{ hooks: [hook] }],
      [HookEventName.SessionEnd]: [{ hooks: [hook] }],
    },
  });
  const trust = new WorkspaceTrustLifecycle({
    localTrust: config.initialWorkspaceTrust,
  });
  const root = new SessionHookOwner(
    readHookDefinitions(config),
    hookSessionRuntime(
      config,
      trust,
      RootTelemetry.prepare({
        enabled: false,
        sessionId: 'isolated-caller-fixture',
        maxBytes: 1024,
        maxFiles: 1,
      }),
    ),
    true,
    new MessageBus(),
  );
  roots.push(root);
  return { directory, config, root, trust };
}

async function awaitMarker(path: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Missing hook marker ${path}`);
    await sleep(10);
  }
}

describe('physical hook ownership', () => {
  afterEach(async () => {
    const results = await Promise.allSettled(
      roots.map((root) => root.dispose()),
    );
    roots.length = 0;
    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
    directories.length = 0;
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'Hook fixture cleanup failed');
  });

  describe.skipIf(process.platform === 'win32')(
    'explicit hook session owner',
    () => {
      it('denies creation of a new child scope after the shared parent closes', async () => {
        const { root } = await setup();
        const child = root.fork();
        roots.push(child);
        await root.dispose();
        expect(() => child.fork()).toThrow('disposed');
      });

      it('denies disabled child event admission after its parent retires', async () => {
        const { config } = await setup();
        const disabled = new SessionHookOwner(
          readHookDefinitions(config),
          hookSessionRuntime(
            config,
            new WorkspaceTrustLifecycle({
              localTrust: config.initialWorkspaceTrust,
            }),
            RootTelemetry.prepare({
              enabled: false,
              sessionId: 'isolated-caller-fixture',
              maxBytes: 1024,
              maxFiles: 1,
            }),
          ),
          false,
          new MessageBus(),
        );
        const child = disabled.fork();
        roots.push(disabled, child);
        const execution = child.execution({
          sessionId: () => 'disabled-child',
          transcriptPath: () => undefined,
        });
        await disabled.dispose();
        await expect(
          execution.sessionStart?.(SessionStartSource.Startup),
        ).rejects.toThrow('disposed');
        await expect(
          child.finishSession(SessionEndReason.Exit, {
            sessionId: () => 'disabled-child',
            transcriptPath: () => undefined,
          }),
        ).rejects.toThrow('disposed');
      });
      it.each(['dispose', 'cancel', 'trust'])(
        'joins a TERM-immune descendant on %s without retiring a peer',
        async (mode) => {
          const { directory, trust, root } = await setup();
          const first = root.fork();
          const peer = root.fork();
          roots.push(first, peer);
          const descendant = join(directory, 'descendant.ts');
          await writeFile(
            descendant,
            `import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
writeFileSync('descendant.admitted', String(process.pid));
await Bun.sleep(1600);
writeFileSync('descendant.finished', 'privileged');
`,
          );
          await writeFile(
            join(directory, 'hook.ts'),
            `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const input = JSON.parse(await Bun.stdin.text());
if (input.session_id === 'held-child') {
  spawn(process.execPath, [${JSON.stringify(descendant)}], { stdio: 'inherit' });
  await Bun.sleep(3000);
} else {
  writeFileSync('peer.finished', input.session_id);
  console.log(JSON.stringify({systemMessage: input.session_id}));
}
`,
          );
          const cancellation = new AbortController();
          const execution = first.execution({
            sessionId: () => 'held-child',
            transcriptPath: () => undefined,
            signal: cancellation.signal,
          });
          const pending = execution.sessionStart?.(SessionStartSource.Startup);
          try {
            await awaitMarker(join(directory, 'descendant.admitted'));
            if (mode === 'dispose') await first.dispose();
            else if (mode === 'cancel')
              cancellation.abort(new Error('original hook turn cancellation'));
            else await trust.setTrustedFolderLive(false);
            await pending;
            const pid = Number(
              await readFile(join(directory, 'descendant.admitted'), 'utf8'),
            );
            expect(pid).toBeGreaterThan(1);
            expect(() => process.kill(pid, 0)).toThrow(/ESRCH|No such process/);
            await sleep(1700);
            expect(existsSync(join(directory, 'descendant.finished'))).toBe(
              false,
            );
            if (mode === 'trust') await trust.setTrustedFolderLive(true);
            const response = await peer
              .execution({
                sessionId: () => 'peer-child',
                transcriptPath: () => undefined,
              })
              .sessionStart?.(SessionStartSource.Startup);
            expect(response?.success).toBe(true);
            expect(
              await readFile(join(directory, 'peer.finished'), 'utf8'),
            ).toBe('peer-child');
          } finally {
            cancellation.abort(new Error('fixture cleanup'));
            await first.dispose();
            await pending;
          }
        },
      );

      it('emits one final physical event and rejects final-event or admin admission after disposal', async () => {
        const { directory, root } = await setup();
        const identity = {
          sessionId: () => 'finish-once',
          transcriptPath: () => undefined,
        };
        root.closeAdmission();
        const first = root.finishSession(SessionEndReason.Exit, identity);
        const second = root.finishSession(SessionEndReason.Exit, identity);
        await Promise.all([first, second]);
        await root.dispose();
        const events = (await readFile(join(directory, 'events.jsonl'), 'utf8'))
          .trim()
          .split('\n');
        expect(events).toHaveLength(1);
        await expect(
          root.finishSession(SessionEndReason.Exit, identity),
        ).rejects.toThrow('disposed');
        expect(() => root.setDisabledHooks([])).toThrow('disposed');
      });

      it('closes admission synchronously, joins accepted commands and emits the final session event before graph retirement', async () => {
        const { directory, root } = await setup();
        const identity = {
          sessionId: () => 'shutdown-session',
          transcriptPath: () => undefined,
        };
        const execution = root.execution(identity);
        const pending = execution.beforeTool?.('read_file', {}, undefined);
        await awaitMarker(join(directory, 'BeforeTool.admitted'));
        root.closeAdmission();
        await expect(
          execution.sessionStart?.(SessionStartSource.Startup),
        ).rejects.toThrow('disposed');
        const final = await root.finishSession(SessionEndReason.Exit, identity);
        await pending;
        await root.dispose();
        expect({
          final: final?.success,
          late: existsSync(join(directory, 'BeforeTool.finished')),
          end: existsSync(join(directory, 'SessionEnd.finished')),
        }).toStrictEqual({ final: true, late: false, end: true });
      });
      it('closes a borrowed facade scope without closing its parent or peer', async () => {
        const { directory, root } = await setup();
        const first = root.fork();
        const second = root.fork();
        const identity = {
          sessionId: () => 'same-label',
          transcriptPath: () => undefined,
        };
        const firstExecution = first.execution(identity);
        const pending = firstExecution.beforeTool?.('read_file', {}, undefined);
        await awaitMarker(join(directory, 'BeforeTool.admitted'));
        await first.dispose();
        await pending;
        await expect(
          firstExecution.sessionStart?.(SessionStartSource.Startup),
        ).rejects.toThrow('disposed');
        const response = await second
          .execution(identity)
          .sessionStart?.(SessionStartSource.Startup);
        expect({
          late: existsSync(join(directory, 'BeforeTool.finished')),
          peer: response?.success,
          marker: existsSync(join(directory, 'SessionStart.finished')),
        }).toStrictEqual({ late: false, peer: true, marker: true });
        await second.dispose();
      });

      it('joins live trust withdrawal before returning while leaving nonprivileged admission usable', async () => {
        const { directory, trust, root } = await setup();
        const execution = root.execution({
          sessionId: () => 'same-label',
          transcriptPath: () => undefined,
        });
        let settled = false;
        const pending = execution
          .beforeTool?.('read_file', {}, undefined)
          .then((result) => {
            settled = true;
            return result;
          });
        await awaitMarker(join(directory, 'BeforeTool.admitted'));
        await trust.setTrustedFolderLive(false);
        expect(settled).toBe(true);
        await pending;
        await sleep(1150);
        expect(existsSync(join(directory, 'BeforeTool.finished'))).toBe(false);
        await execution.sessionStart?.(SessionStartSource.Startup);
        expect(existsSync(join(directory, 'SessionStart.finished'))).toBe(
          false,
        );
        await trust.setTrustedFolderLive(true);
        await execution.sessionStart?.(SessionStartSource.Startup);
        expect(existsSync(join(directory, 'SessionStart.finished'))).toBe(true);
      });
    },
  );
});
