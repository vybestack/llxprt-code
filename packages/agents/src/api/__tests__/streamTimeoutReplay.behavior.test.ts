/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4093: the request resent after a watchdog timeout is the provider-ready
 * request of the attempt that timed out, not a request rebuilt from whatever
 * the hooks and settings say now. Only the per-attempt plumbing (cancellation
 * signal, observers, attempt index) is new.
 */

import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toConfigParameters, type Agent } from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { SettingsService, Storage } from '@vybestack/llxprt-code-settings';
import { fromConfig } from '../fromConfig.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { nativeHookCommand } from './helpers/native-hook-command.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useRecordingPrompts } from './helpers/recording-prompts.js';
import {
  readJsonl,
  startScriptedEndpoint,
  stallReply,
  stopReply,
  turnRecords,
  type ScriptedEndpoint,
} from './helpers/refusal-endpoint.js';
import {
  collectStream,
  withStallingAgent,
  within,
} from './helpers/stalling-agent.js';
import { createStallingProvider } from './helpers/stalling-provider.js';

setDefaultTimeout(90_000);

const DEADLINE_MS = 30_000;
const SESSION_ID = 'timeout-replay-session';

/**
 * A BeforeModel and BeforeToolSelection hook that answers differently every
 * time it runs: it counts its own runs in files next to the script.
 */
const CHANGING_HOOK = `import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const input = JSON.parse(await Bun.stdin.text());
const directory = process.argv[2];
if (directory === undefined) throw new Error('Missing hook state directory');
const event = input.hook_event_name;
const counter = directory + '/' + event + '.count';
const run = (existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0) + 1;
writeFileSync(counter, String(run));
if (event === 'BeforeModel') {
  console.log(JSON.stringify({ hookSpecificOutput: { llm_request: { contents: [...input.llm_request.contents, { speaker: 'human', blocks: [{ type: 'text', text: 'hook pass ' + run }] }] } } }));
} else {
  const allowedToolNames = run === 1 ? ['read_file', 'list_directory'] : ['read_file'];
  console.log(JSON.stringify({ hookSpecificOutput: { toolChoice: { mode: 'auto', allowedToolNames } } }));
}
`;

async function hookCounts(
  directory: string,
): Promise<{ beforeModel: number; beforeToolSelection: number }> {
  return {
    beforeModel: await hookRuns(directory, 'BeforeModel'),
    beforeToolSelection: await hookRuns(directory, 'BeforeToolSelection'),
  };
}

async function hookRuns(directory: string, event: string): Promise<number> {
  try {
    return Number(await readFile(join(directory, `${event}.count`), 'utf8'));
  } catch {
    return 0;
  }
}

describe('timeout replay (issue #4093)', () => {
  useRecordingPrompts();

  describe('resend after a stream timeout with hooks that answer differently each run (issue #4093)', () => {
    const credentials = useOwnedCredentials();

    async function withHookedAgent(
      endpoint: ScriptedEndpoint,
      run: (agent: Agent, directory: string) => Promise<void>,
    ): Promise<void> {
      const directory = await realpath(
        await mkdtemp(join(tmpdir(), 'timeout-replay-')),
      );
      const script = join(directory, 'changing-hook.ts');
      await writeFile(script, CHANGING_HOOK);
      const command = nativeHookCommand(script, [directory]);
      const definitions = [{ hooks: [{ type: HookType.Command, command }] }];
      let config: Config | undefined;
      let agent: Agent | undefined;
      try {
        config = new Config({
          ...toConfigParameters({
            provider: 'openai',
            model: 'wire-model',
            workingDir: directory,
            folderTrust: true,
            interactive: true,
            recording: { enabled: false },
            telemetry: { enabled: false },
          }),
          sessionId: SESSION_ID,
          enableHooks: true,
          hooks: {
            [HookEventName.BeforeModel]: definitions,
            [HookEventName.BeforeToolSelection]: definitions,
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
              model: 'wire-model',
              cliOverrides: { key: 'local-test-key', baseUrl: endpoint.url },
            },
          },
          credentials().authority,
        );
        agent.setEphemeralSetting('stream-first-response-timeout-ms', 1000);
        agent.setEphemeralSetting('refusal.backoff-ms', 1);
        agent.setEphemeralSetting('refusal.retries', 0);
        agent.setEphemeralSetting('refusal.rewrite', false);
        await run(agent, directory);
      } finally {
        await runCleanupSteps([
          () => agent?.dispose(),
          () => config?.dispose(),
          () => rm(directory, { recursive: true, force: true }),
        ]);
      }
    }

    it('resends exactly the request that timed out and runs the hooks once for it', async () => {
      let directoryOfAgent = '';
      let hooksWhenOriginalArrived: unknown;
      const endpoint = await startScriptedEndpoint(async (_request, index) => {
        if (index === 0) {
          hooksWhenOriginalArrived = await hookCounts(directoryOfAgent);
          return stallReply();
        }
        return stopReply(index === 1 ? 'recovered' : 'later');
      });
      try {
        await withHookedAgent(endpoint, async (agent, directory) => {
          directoryOfAgent = directory;
          const first = await within(
            DEADLINE_MS,
            'resend of the timed-out request',
            collectStream(agent, 'initial caller input', {
              // The settings move while the resend waits out its backoff.
              onEvent: (event) => {
                if (
                  event.type === 'notice' &&
                  event.message.includes('retrying in')
                )
                  agent.setModelParam('temperature', 0.9);
              },
            }),
          );
          const requestsAfterFirst = endpoint.requests().length;
          const hooksAfterFirst = await hookCounts(directory);
          await within(
            DEADLINE_MS,
            'later independent prompt',
            collectStream(agent, 'a later prompt'),
          );
          const [original, resent, later] = endpoint.requests();

          expect({
            done: first.flatMap((event) =>
              event.type === 'done' ? [event.reason] : [],
            ),
            requestsAfterFirst,
            hooksAfterFirst,
            resent: JSON.stringify(resent),
            laterSeesCurrentSettings: later.temperature,
          }).toStrictEqual({
            done: ['stop'],
            requestsAfterFirst: 2,
            hooksAfterFirst: hooksWhenOriginalArrived,
            resent: JSON.stringify(original),
            laterSeesCurrentSettings: 0.9,
          });
          expect(JSON.stringify(original.messages)).toContain('hook pass');
          // The later prompt is its own logical request: it runs the hooks again.
          expect(JSON.stringify(later.messages)).not.toBe(
            JSON.stringify(original.messages),
          );
        });
      } finally {
        await endpoint.stop();
      }
    });

    it('logs the timed-out attempt and the resend under unique attempt indexes', async () => {
      const endpoint = await startScriptedEndpoint([
        stallReply(),
        stopReply('recovered'),
      ]);
      try {
        await withHookedAgent(endpoint, async (agent, directory) => {
          await within(
            DEADLINE_MS,
            'resend of the timed-out request',
            collectStream(agent, 'initial caller input'),
          );
          const records = turnRecords(
            readJsonl(
              join(
                new Storage(directory).getProjectTempDir(),
                'token-usage',
                `${SESSION_ID}.jsonl`,
              ),
            ),
          );
          expect(
            records.map((r) => [r['attempt_index'], r['attempt_outcome']]),
          ).toStrictEqual([
            [0, 'error'],
            [1, 'success'],
          ]);
        });
      } finally {
        await endpoint.stop();
      }
    });
  });

  describe('request the provider receives on a resend after a stream timeout (issue #4093)', () => {
    const credentials = useOwnedCredentials();

    it('carries the original request data with fresh cancellation signals', async () => {
      const provider = createStallingProvider('stall-replay');
      provider.onAttempt = (attempt) => {
        if (attempt.index === 1) {
          attempt.emit('recovered');
          attempt.finish();
        }
      };
      const cleanup = await withStallingAgent(
        credentials().authority,
        provider,
        { settings: { 'stream-first-response-timeout-ms': 1000 } },
        async (agent) => {
          await within(
            DEADLINE_MS,
            'resend of the timed-out request',
            collectStream(agent, 'initial caller input', {
              onEvent: (event) => {
                if (
                  event.type === 'notice' &&
                  event.message.includes('retrying in')
                )
                  agent.setModelParam('temperature', 0.9);
              },
            }),
          );
          const [original, resent] = provider.attempts;

          expect({
            requests: provider.attempts.length,
            data: JSON.stringify(resent.data),
            freshSignals: resent.signals.every(
              (signal) => !original.signals.includes(signal),
            ),
            resentSignalsLive: resent.abortedOnArrival,
            originalTimedOut: original.signals.map((signal) => signal.aborted),
          }).toStrictEqual({
            requests: 2,
            data: JSON.stringify(original.data),
            freshSignals: true,
            resentSignalsLive: resent.signals.map(() => false),
            originalTimedOut: original.signals.map(() => true),
          });
        },
      );
      expect(cleanup).toStrictEqual([]);
    });
  });
});
