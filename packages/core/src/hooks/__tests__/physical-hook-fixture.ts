import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { afterEach } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { Config } from '../../config/config.js';
import { MessageBus } from '../../confirmation-bus/message-bus.js';
import { SessionHookOwner } from '../session-hook-owner.js';
import {
  hookSessionRuntime,
  readHookDefinitions,
} from '../hook-configuration.js';
import { HookType, type HookEventName, type HookOutput } from '../types.js';
import { escapeShellArg } from '../../utils/shell-utils.js';

export function usePhysicalHook(): (
  event: HookEventName,
  output?: HookOutput,
  enabled?: boolean,
  exitCode?: number,
) => Promise<{
  root: SessionHookOwner;
  execution: ReturnType<SessionHookOwner['execution']>;
  input: () => Promise<z.infer<typeof recordedInput>>;
  ran: () => boolean;
}> {
  const resources: Array<{ root: SessionHookOwner; directory: string }> = [];
  retirePhysicalHooks(resources);
  return async (event, output = {}, enabled = true, exitCode = 0) => {
    const directory = await mkdtemp(join(tmpdir(), 'llxprt-physical-hook-'));
    const script = join(directory, 'hook.ts');
    await writeFile(
      script,
      `import { writeFileSync } from 'node:fs';
const input = JSON.parse(await Bun.stdin.text());
writeFileSync('input.json', JSON.stringify(input));
console.log(${JSON.stringify(JSON.stringify(output))});
process.exit(${exitCode});
`,
    );
    const config = new Config({
      sessionId: 'hook-fixture',
      targetDir: directory,
      cwd: directory,
      model: 'hook-model',
      debugMode: false,
      enableHooks: enabled,
      trustedFolder: true,
      hooks: {
        [event]: [
          {
            hooks: [
              {
                type: HookType.Command,
                command: `exec ${escapeShellArg(process.execPath, 'bash')} ${escapeShellArg(script, 'bash')}`,
              },
            ],
          },
        ],
      },
    });
    const root = new SessionHookOwner(
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
      enabled,
      new MessageBus(),
    );
    resources.push({ root, directory });
    return {
      root,
      execution: root.execution({
        sessionId: () => 'explicit-session',
        transcriptPath: () => join(directory, 'transcript.jsonl'),
      }),
      input: async () =>
        recordedInput.parse(
          JSON.parse(await readFile(join(directory, 'input.json'), 'utf8')),
        ),
      ran: () => existsSync(join(directory, 'input.json')),
    };
  };
}

const recordedInput = z.object({
  session_id: z.string(),
  transcript_path: z.string(),
  cwd: z.string(),
  hook_event_name: z.string(),
  timestamp: z.string(),
  source: z.string().optional(),
  reason: z.string().optional(),
  prompt: z.string().optional(),
  prompt_response: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
  trigger: z.string().optional(),
});

function retirePhysicalHooks(
  resources: Array<{ root: SessionHookOwner; directory: string }>,
): void {
  afterEach(async () => {
    const retired = await Promise.allSettled(
      resources.map(({ root }) => root.dispose()),
    );
    await Promise.all(
      resources.map(({ directory }) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
    resources.length = 0;
    const failures = retired.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Physical hook fixture retirement failed',
      );
  });
}
