/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036 review round 1 (M5): an identical retry of a refused request
 * resends the provider-ready request that was refused. It does not rebuild it
 * from the live history and it does not run the BeforeModel hooks again, so
 * neither a stateful hook nor a write that lands during the backoff can turn
 * the "identical" resend into a different request.
 */

import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toConfigParameters, type Agent } from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { fromConfig } from '../fromConfig.js';
import { drain } from './helpers/agentHarness.js';
import { nativeHookCommand } from './helpers/native-hook-command.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  emptyRefusalReply,
  isBackoffNotice,
  runScriptedPrompt,
  startScriptedEndpoint,
  stopReply,
} from './helpers/refusal-endpoint.js';

// Each case runs a whole agent against a local endpoint.
setDefaultTimeout(90_000);

const PROMPT = 'please summarise the work';
const APPENDED = 'appended during the backoff';

describe('an identical retry of a refused request (issue #4036)', () => {
  it('is not changed by history written during the backoff', async () => {
    const run = await runScriptedPrompt(
      [emptyRefusalReply(), stopReply('recovered')],
      [PROMPT],
      {
        settings: {
          'refusal.retries': 1,
          'refusal.backoff-ms': 1,
          'refusal.rewrite': false,
        },
        onEvent: async (event, agent) => {
          if (!isBackoffNotice(event)) return;
          await agent.addHistory({
            speaker: 'human',
            blocks: [{ type: 'text', text: APPENDED }],
          });
        },
      },
    );

    expect({
      identical: run.requests[1]?.messages,
      kept: JSON.stringify(run.historyAfter).includes(APPENDED),
    }).toStrictEqual({ identical: run.requests[0]?.messages, kept: true });
  });

  describe('with a BeforeModel hook that answers differently on every call', () => {
    const credentials = useOwnedCredentials();

    it('resends the hooked request without running the hook again', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'refusal-retained-'));
      const counter = join(directory, 'counter.txt');
      const script = join(directory, 'before-model.ts');
      await writeFile(
        script,
        `import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const input = JSON.parse(await Bun.stdin.text());
const counter = process.argv[2];
if (counter === undefined) throw new Error('Missing counter path');
const call = (existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0) + 1;
writeFileSync(counter, String(call));
console.log(JSON.stringify({ hookSpecificOutput: { llm_request: { contents: [...input.llm_request.contents, { speaker: 'human', blocks: [{ type: 'text', text: 'hook call ' + call }] }] } } }));
`,
      );
      const endpoint = await startScriptedEndpoint([
        emptyRefusalReply(),
        stopReply('recovered'),
      ]);
      let config: Config | undefined;
      let agent: Agent | undefined;
      try {
        config = new Config({
          ...toConfigParameters({
            provider: 'openai',
            model: 'scripted-model',
            workingDir: directory,
            folderTrust: true,
            interactive: true,
            recording: { enabled: false },
            telemetry: { enabled: false },
          }),
          sessionId: 'refusal-retained',
          enableHooks: true,
          hooks: {
            [HookEventName.BeforeModel]: [
              {
                hooks: [
                  {
                    type: HookType.Command,
                    command: nativeHookCommand(script, [counter]),
                  },
                ],
              },
            ],
          },
        });
        const settings = new SettingsService();
        for (const [key, value] of Object.entries(config.getInitialSettings()))
          settings.set(key, value);
        agent = await fromConfig(
          config,
          settings,
          {
            activation: {
              provider: 'openai',
              model: 'scripted-model',
              cliOverrides: { key: 'local-test-key', baseUrl: endpoint.url },
            },
          },
          credentials().authority,
        );
        agent.setEphemeralSetting('refusal.retries', 1);
        agent.setEphemeralSetting('refusal.backoff-ms', 0);
        agent.setEphemeralSetting('refusal.rewrite', false);

        await drain(agent.stream(PROMPT));

        const sent = endpoint.requests();
        expect({
          requests: sent.length,
          identical: sent.find((_, position) => position === 1)?.messages,
          hookRuns: await readFile(counter, 'utf8'),
        }).toStrictEqual({
          requests: 2,
          identical: sent.find((_, position) => position === 0)?.messages,
          hookRuns: '1',
        });
      } finally {
        await agent?.dispose();
        await config?.dispose();
        await endpoint.stop();
        await rm(directory, { recursive: true, force: true });
      }
    });
  });
});
