import { makeLoadBalancerInvocation } from './loadBalancerTestHelpers.js';
import { installBorrowedConfigSettings } from './helpers/session-settings-owner-fixture.js';
const fixtureSettings = installBorrowedConfigSettings();
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * A load-balancer member must receive the same system instruction a direct
 * request would (issues #3136 and #854). On the source route the agent peeks
 * the balancer (which mints the balancer's own estimate-only token), then
 * sends with that token over `requestRows`. A member provider that receives
 * the balancer's token alongside its own request treats the call as already
 * prepared and blanks its prompt inputs, so the balancer must spend its peek
 * token before it hands the request to any member.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import {
  materializeCallOptions,
  readsRequestRowsAtTransport,
} from '../BaseProviderNormalization.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import {
  LoadBalancingProvider,
  type ResolvedSubProfile,
} from '../LoadBalancingProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import { isAsyncIterableContents } from '../utils/collectContents.js';
import { textRow, trackedRequestRows } from './requestRowsTestSupport.js';

const SYSTEM_INSTRUCTION = 'agent assembled system prompt';

function member(name: string, providerName: string): ResolvedSubProfile {
  return {
    name,
    providerName,
    model: `${providerName}-model`,
    baseURL: 'http://localhost',
    authToken: 'test-token',
    ephemeralSettings: {},
    modelParams: {},
  };
}

const tokenizerFactory: RuntimeTokenizerFactory = {
  getTokenizer: () => undefined,
  async estimatePrompt(request) {
    return {
      count: await request.legacyEstimate(),
      method: 'calibrated',
      family: 'legacy-unregistered',
      estimatorVersion: 'core-estimate-tokens-v1',
      assetRevision: 'none',
      projectionRevision: request.projectionRevision,
    };
  },
};

interface SourceRouteMember {
  readonly provider: IProvider;
  /** System instruction each send ended up transporting. */
  readonly sent: Array<string | undefined>;
}

/**
 * A member that follows the real source-route contract: projection captures
 * the prompt inputs of the normalized call, and a send carrying that token
 * gets them back (the same shape as OpenAIProvider's prepared envelope).
 */
function sourceRouteMember(name: string): SourceRouteMember {
  const sent: Array<string | undefined> = [];
  const preparedInputs = new WeakMap<
    object,
    { systemInstruction: string | undefined }
  >();
  const normalize = (options: GenerateChatOptions) =>
    materializeCallOptions(
      options,
      options.tools,
      false,
      readsRequestRowsAtTransport(options),
    );
  const provider: IProvider = {
    name,
    async projectPromptEnvelope(options: GenerateChatOptions) {
      const normalized = await normalize(options);
      const transportToken = Object.freeze({});
      preparedInputs.set(transportToken, {
        systemInstruction: normalized.systemInstruction,
      });
      return {
        model: `${name}-model`,
        protocol: 'openai-responses',
        method: 'responses/v1',
        projectionRevision: 1,
        unsupportedMedia: [],
        transportToken,
        finalizedProjection: Object.freeze({
          kind: 'test',
          protocol: 'test',
          promptText: 'projection',
        }),
        legacyEstimate: () => Promise.resolve(1),
      };
    },
    async *generateChatCompletion(
      input: GenerateChatOptions | AsyncIterable<IContent>,
    ): AsyncGenerator<IContent> {
      if (isAsyncIterableContents(input)) {
        throw new Error('expected options, received a bare stream');
      }
      const normalized = await normalize(input);
      const prepared =
        normalized.promptEnvelopeTransportToken === undefined
          ? undefined
          : preparedInputs.get(normalized.promptEnvelopeTransportToken);
      sent.push(prepared?.systemInstruction ?? normalized.systemInstruction);
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
    },
    getModels: async () => [],
    getDefaultModel: () => `${name}-model`,
  };
  return { provider, sent };
}

describe('LoadBalancingProvider member system instruction on the source route', () => {
  let providerManager: ProviderManager;

  beforeEach(() => {
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      settingsService,
      config,
      undefined,
      undefined,
      fixtureSettings(config, settingsService),
    );
    providerManager.setTokenizerFactory(tokenizerFactory);
  });

  for (const strategy of ['round-robin', 'failover'] as const) {
    it(`${strategy}: a peeked requestRows send gives the member the agent system instruction`, async () => {
      const first = sourceRouteMember('prov-a');
      const second = sourceRouteMember('prov-b');
      providerManager.registerProvider(first.provider);
      providerManager.registerProvider(second.provider);
      const lb = new LoadBalancingProvider(
        {
          profileName: 'source-system-instruction',
          strategy,
          subProfiles: [member('a', 'prov-a'), member('b', 'prov-b')],
        },
        providerManager,
      );
      const rows = trackedRequestRows([textRow('hello')]);
      const request: GenerateChatOptions = {
        invocation: makeLoadBalancerInvocation(),
        contents: { [Symbol.asyncIterator]: () => rows.openReader() },
        requestRows: rows,
        contentCount: rows.count,
        systemInstruction: SYSTEM_INSTRUCTION,
      };

      const peek = await lb.projectPromptEnvelope(request);
      if (peek === undefined) throw new Error('expected a peek projection');
      for await (const _chunk of lb.generateChatCompletion({
        ...request,
        promptEnvelopeTransportToken: peek.transportToken,
      })) {
        // drain
      }

      expect([...first.sent, ...second.sent]).toStrictEqual([
        SYSTEM_INSTRUCTION,
      ]);
      expect(rows.openReaders()).toBe(0);
    });
  }

  it('an unpeeked requestRows send also gives the member the agent system instruction', async () => {
    const only = sourceRouteMember('prov-a');
    providerManager.registerProvider(only.provider);
    const lb = new LoadBalancingProvider(
      {
        profileName: 'source-system-instruction-direct',
        strategy: 'round-robin',
        subProfiles: [member('a', 'prov-a')],
      },
      providerManager,
    );
    const rows = trackedRequestRows([textRow('hello')]);

    for await (const _chunk of lb.generateChatCompletion({
      invocation: makeLoadBalancerInvocation(),
      contents: { [Symbol.asyncIterator]: () => rows.openReader() },
      requestRows: rows,
      contentCount: rows.count,
      systemInstruction: SYSTEM_INSTRUCTION,
    })) {
      // drain
    }

    expect(only.sent).toStrictEqual([SYSTEM_INSTRUCTION]);
  });
});
