import { fixtureAgentResources } from '../../../agents/src/api/__tests__/helpers/agent-resource-capture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import type { Profile, StandardProfile } from '@vybestack/llxprt-code-settings';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { RuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  buildAgent,
  internalConfig,
} from '../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { resolveCompressionProvider } from '../../../agents/src/core/CompressionProfileResolver.js';
import { buildResponsesHeaders } from './openAIResponsesHttpStream.js';
import { buildWebSocketHandshakeHeaders } from './openAIResponsesRequestDump.js';
import { captureResponsesRequest } from './responses-request.js';
import { buildNormalizedOptions } from './responses-request.test-helpers.js';
import type { ResponsesExecutorDeps } from './openAIResponsesExecutor.js';

async function sessionHeaders(
  invocation: RuntimeInvocationContext,
): Promise<ReadonlyArray<Partial<Record<string, string>>>> {
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

describe('compression profile conversation identity', () => {
  it.each(['standard', 'roundrobin', 'failover'])(
    'retains the new session in %s compression headers and delegated calls',
    async (mode) => {
      const { agent, cleanup } = await buildAgent('plain-text.jsonl');
      const original = FakeProvider.prototype.generateChatCompletion;
      const capture = spyOn(FakeProvider.prototype, 'generateChatCompletion');
      try {
        const oldId = agent.session.getSessionId();
        await agent.session.startNewSession();
        const sessionId = agent.session.getSessionId();
        const resources = fixtureAgentResources(agent);
        const provider = resources.manager.getActiveProvider();
        if (provider === undefined) throw new Error('Expected provider');
        const config = internalConfig(agent);
        const standard: StandardProfile = {
          version: 1,
          provider: 'openai-responses',
          model: 'codex-compression',
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
        const resolved = await resolveCompressionProvider(
          {
            providerRuntime: {
              runtimeId: agent.getRuntimeId(),
              metadata: {},
            },
            runtimeState: createAgentRuntimeState({
              runtimeId: agent.getRuntimeId(),
              sessionId,
              provider: 'fake',
              model: 'fake-model',
            }),
            prepareProviderInvocation: (name, parameters, signal) =>
              resources.prepareInvocation(agent, name, parameters, signal),
            profileDefinitions: {
              loadProfile: async (name): Promise<Profile> =>
                name === 'compression-member' ? standard : profile,
            },
            resolveExplicitCompressionProvider: () => provider,
            roundRobinIndexes: new Map(),
          },
          'compression-profile',
          () => provider,
          undefined,
          undefined,
          undefined,
          undefined,
          config,
        );
        if (!resolved.invocation) throw new Error('Expected invocation');
        const outer = await sessionHeaders(resolved.invocation);
        expect(
          outer.map((header) => [
            header.session_id,
            header['session-id'],
            header['thread-id'],
          ]),
        ).toStrictEqual([
          [sessionId, undefined, undefined],
          [undefined, sessionId, sessionId],
        ]);
        const delegatedHeaders: Array<Partial<Record<string, string>>> = [];
        capture.mockImplementation(async function* (
          this: FakeProvider,
          options,
        ) {
          if (Array.isArray(options) || !options.invocation)
            throw new Error('Expected delegated invocation');
          delegatedHeaders.push(...(await sessionHeaders(options.invocation)));
          yield* original.call(this, options);
        });
        for await (const content of resolved.provider.generateChatCompletion({
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'compress this conversation' }],
            },
          ],
          invocation: resolved.invocation,
          resolved: resolved.resolved,
        })) {
          expect(content.speaker).toBe('ai');
        }
        expect(
          delegatedHeaders.map((header) => [
            header.session_id,
            header['session-id'],
            header['thread-id'],
          ]),
        ).toStrictEqual([
          [sessionId, undefined, undefined],
          [undefined, sessionId, sessionId],
        ]);
        expect(
          delegatedHeaders.flatMap((header) => Object.values(header)),
        ).not.toContain(oldId);
        expect(
          delegatedHeaders.flatMap((header) => Object.values(header)),
        ).not.toContain(resolved.invocation.runtimeId);
      } finally {
        capture.mockRestore();
        await cleanup();
      }
    },
  );
});
