import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '../config/config.js';
import {
  readHookDefinitions,
  hookSessionRuntime,
} from './hook-configuration.js';
import { HookSystem } from './hookSystem.js';
import { HookEventName, HookType } from './types.js';
import { escapeShellArg } from '../utils/shell-utils.js';

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Hook did not create ${path}`);
    await sleep(10);
  }
}

describe('physical hook ownership', () => {
  function useProject(): () => string {
    let directory = '';
    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'llxprt-hook-owner-'));
    });
    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });
    return () => directory;
  }

  describe.skipIf(process.platform === 'win32')('hook session shutdown', () => {
    const project = useProject();

    it('joins an admitted hook and denies subsequent execution before its resources retire', async () => {
      const directory = project();
      const script = join(directory, 'hook.ts');
      await writeFile(
        script,
        `import { writeFileSync } from 'node:fs';
writeFileSync('admitted', 'yes');
setTimeout(() => { writeFileSync('late-privileged', 'ran'); process.exit(0); }, 1000);
`,
      );
      const config = new Config({
        sessionId: 'same-label',
        targetDir: directory,
        cwd: directory,
        debugMode: false,
        model: 'physical-hook',
        trustedFolder: true,
        enableHooks: true,
        hooks: {
          [HookEventName.BeforeTool]: [
            {
              hooks: [
                {
                  type: HookType.Command,
                  command: `exec node ${escapeShellArg(script, 'bash')}`,
                },
              ],
            },
          ],
        },
      });
      const system = new HookSystem(
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
      );
      await system.initialize();
      const pending = system.fireBeforeToolEvent('write_file', {
        file_path: 'owned.txt',
      });
      await waitForFile(join(directory, 'admitted'));
      await system.dispose();
      await pending;
      await sleep(1100);
      expect(existsSync(join(directory, 'late-privileged'))).toBe(false);
      await expect(
        system.fireBeforeToolEvent('write_file', {}),
      ).rejects.toThrow('disposed');
    });
    it('preserves an undefined loader rejection during an active trust transition', async () => {
      const directory = project();
      const config = new Config({
        sessionId: 'transition',
        targetDir: directory,
        cwd: directory,
        model: 'model',
        debugMode: false,
      });
      let transition: ((trusted: boolean) => Promise<void>) | undefined;
      const runtime = {
        ...hookSessionRuntime(
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
        onTrustTransition: (
          listener: (trusted: boolean) => Promise<void>,
        ): (() => void) => {
          transition = listener;
          return () => {
            transition = undefined;
          };
        },
      };
      const system = new HookSystem(() => {
        throw undefined;
      }, runtime);
      try {
        if (transition === undefined)
          throw new Error('Missing actual hook transition subscription');
        await expect(transition(true)).rejects.toBeUndefined();
      } finally {
        await system.dispose();
        await config.dispose();
      }
    });
  });
});
