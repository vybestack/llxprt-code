/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import type { Profile, StandardProfile } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  OpenAIProvider,
  type NormalizedGenerateChatOptions,
} from '@vybestack/llxprt-code-providers';
import { bindProviderAliasIdentity } from '../composition/aliasProviderFactory.js';
import { buildProviderContributionRegistry } from '../composition/runtimePlugins/index.js';
import type { ProviderContributionRegistry } from '../composition/runtimePlugins/types.js';
import { buildResponsesHeaders } from './openAIResponsesHttpStream.js';
import { buildWebSocketHandshakeHeaders } from './openAIResponsesRequestDump.js';
import { captureResponsesRequest } from './responses-request.js';
import { buildNormalizedOptions } from './responses-request.test-helpers.js';
import type { ResponsesExecutorDeps } from './openAIResponsesExecutor.js';

const PROVIDER_ALIAS = 'compression-header-recorder';
const PROVIDER_ID = `${PROVIDER_ALIAS}-provider`;
const BASE_URL = 'http://compression-header-recorder.invalid/v1';

type HeaderTable = ReadonlyArray<Partial<Record<string, string>>>;

async function sessionHeaders(
  invocation: RuntimeInvocationContext,
): Promise<HeaderTable> {
  const request = captureResponsesRequest(
    buildNormalizedOptions({ invocation }),
    'openai-responses',
    'https://example.com',
    undefined,
    'codex-compression',
  );
  const deps: ResponsesExecutorDeps = {
    providerName: 'openai-responses',
    logger: new DebugLogger('compression-session-headers'),
    isCodexMode: () => true,
    getCodexAccountId: async () => 'account',
    resolveAuthTokenForPrompt: async () => 'token',
    shouldRetryOnError: () => false,
    getUnallowedModelParameters: () => new Set<string>(),
  };
  return [
    await buildResponsesHeaders(
      'token',
      'application/json',
      true,
      request,
      deps,
    ),
    await buildWebSocketHandshakeHeaders(
      { apiKey: 'token', normalizedOptions: request },
      deps,
    ),
  ];
}

function headerTriples(
  headers: HeaderTable,
): Array<[string | undefined, string | undefined, string | undefined]> {
  return headers.map((header) => [
    header.session_id,
    header['session-id'],
    header['thread-id'],
  ]);
}

interface DelegatedCall {
  readonly invocation: RuntimeInvocationContext;
  readonly headers: HeaderTable;
}

/**
 * A provider registered the way a host registers one (a provider
 * contribution). It answers a compression request and records the headers
 * the Responses wire builders produce for the invocation it received.
 */
class HeaderRecordingProvider extends OpenAIProvider {
  constructor(private readonly calls: DelegatedCall[]) {
    super('test-key', BASE_URL);
  }

  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    this.calls.push({
      invocation: options.invocation,
      headers: await sessionHeaders(options.invocation),
    });
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'compressed summary' }],
    };
  }
}

function createHeaderRecorder(calls: DelegatedCall[]): {
  readonly contributions: ProviderContributionRegistry;
} {
  return {
    contributions: buildProviderContributionRegistry([
      {
        specifier: `memory:${PROVIDER_ID}`,
        manifest: {
          apiVersion: 1,
          id: PROVIDER_ID,
          providers: [
            {
              providerId: PROVIDER_ID,
              createProvider: (entry) => {
                const provider = new HeaderRecordingProvider(calls);
                bindProviderAliasIdentity(provider, entry.alias);
                return provider;
              },
              builtinAliases: [
                {
                  alias: PROVIDER_ALIAS,
                  config: {
                    baseProvider: PROVIDER_ID,
                    'base-url': BASE_URL,
                    'requires-auth': false,
                    defaultModel: 'recording-default',
                    staticModels: [
                      { id: 'recording-default', name: 'Recording default' },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ]),
  };
}

function longHistory(): IContent[] {
  const history: IContent[] = [];
  for (let turn = 0; turn < 6; turn++) {
    history.push(
      {
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: `Earlier turn ${turn}: ${'context '.repeat(200)}`,
          },
        ],
      },
      { speaker: 'ai', blocks: [{ type: 'text', text: `Answer ${turn}` }] },
    );
  }
  return history;
}

describe('compression profile conversation identity', () => {
  let configHome: string;
  let workingDir: string;
  let previousConfigHome: string | undefined;
  const agents: Agent[] = [];

  beforeEach(async () => {
    previousConfigHome = process.env.LLXPRT_CONFIG_HOME;
    configHome = await mkdtemp(join(tmpdir(), 'compression-headers-config-'));
    workingDir = await mkdtemp(join(tmpdir(), 'compression-headers-work-'));
    process.env.LLXPRT_CONFIG_HOME = configHome;
  });

  afterEach(async () => {
    for (const agent of agents.splice(0)) await agent.dispose();
    if (previousConfigHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousConfigHome;
    await rm(configHome, { recursive: true, force: true });
    await rm(workingDir, { recursive: true, force: true });
  });

  it.each(['standard', 'roundrobin', 'failover'])(
    'retains the new session in %s compression headers and delegated calls',
    async (mode) => {
      const calls: DelegatedCall[] = [];
      const recorder = createHeaderRecorder(calls);
      const agent = await createAgent({
        provider: PROVIDER_ALIAS,
        model: 'recording-default',
        providerContributions: recorder.contributions,
        workingDir,
        harness: { includeProcessCwd: false },
      });
      agents.push(agent);
      const oldId = agent.session.getSessionId();
      await agent.session.startNewSession();
      const sessionId = agent.session.getSessionId();

      const standard: StandardProfile = {
        version: 1,
        provider: PROVIDER_ALIAS,
        model: 'recording-default',
        modelParams: {},
        ephemeralSettings: {},
      };
      const profile: Profile =
        mode === 'standard'
          ? standard
          : {
              ...standard,
              provider: 'load-balancer',
              type: 'loadbalancer',
              policy: mode === 'failover' ? 'failover' : 'roundrobin',
              profiles: ['compression-member'],
            };
      const profiles = new ProfileManager();
      await profiles.saveProfile('compression-member', standard);
      await profiles.saveProfile('compression-profile', profile);

      await agent.setHistory(longHistory());
      agent.setEphemeralSetting('compression.strategy', 'one-shot');
      agent.setEphemeralSetting('compression.profile', 'compression-profile');
      await agent.compress();

      expect(calls.length).toBeGreaterThan(0);
      const [first] = calls;
      expect(first.invocation.runtimeId).toContain('::compression-profile:');
      expect(headerTriples(first.headers)).toStrictEqual([
        [sessionId, undefined, undefined],
        [undefined, sessionId, sessionId],
      ]);
      const delegatedHeaders = calls.flatMap((call) => [...call.headers]);
      expect(headerTriples(delegatedHeaders)).toStrictEqual(
        calls.flatMap(() => [
          [sessionId, undefined, undefined],
          [undefined, sessionId, sessionId],
        ]),
      );
      const delegatedValues = delegatedHeaders.flatMap((header) =>
        Object.values(header),
      );
      expect(delegatedValues).not.toContain(oldId);
      expect(delegatedValues).not.toContain(first.invocation.runtimeId);
      expect(delegatedValues).not.toContain(agent.getRuntimeId());
    },
  );
});
