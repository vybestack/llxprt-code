/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the provider-neutral prompt-envelope estimation
 * contract (issue #2817).
 *
 * These tests prove that core can describe a finalized-prompt estimate and a
 * provider projection seam WITHOUT embedding any tokenizer or provider-payload
 * knowledge. Providers count tokens against their own finalized representation;
 * core never reads raw prompt material.
 *
 * @requirement:REQ-PE-001 (issue #2817 acceptance A1, A2, A9)
 */

import { describe, it, expect } from 'bun:test';
import type {
  PromptEnvelopeProtocol,
  PromptEnvelopeMethod,
  PromptEnvelopeProjection,
  PromptEnvelopeEstimate,
  UnsupportedMediaEntry,
} from './PromptEstimation.js';
import { estimatePromptEnvelope as estimatePromptEnvelopeImpl } from './PromptEstimation.js';
import type {
  RuntimePromptEstimateRequest,
  RuntimeTokenizerFactory,
} from './RuntimeTokenizerFactory.js';

const estimatorFactory: RuntimeTokenizerFactory = {
  getTokenizer: () => undefined,
  async estimatePrompt(request: RuntimePromptEstimateRequest) {
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

function estimatePromptEnvelope(
  projection: PromptEnvelopeProjection,
): Promise<PromptEnvelopeEstimate> {
  return estimatePromptEnvelopeImpl(
    'test-provider',
    projection,
    estimatorFactory,
  );
}

describe('PromptEnvelopeProjection contract (issue #2817)', () => {
  it('describes its protocol, method, model, projection revision, and unsupported media', () => {
    const projection: PromptEnvelopeProjection = {
      model: 'claude-3-5-sonnet',
      protocol: 'anthropic-messages',
      method: 'messages/v1',
      projectionRevision: 1,
      unsupportedMedia: [
        {
          kind: 'unsupported',
          reason: 'audio not supported',
          mediaType: 'audio',
        },
      ],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(0),
    };

    expect(projection.protocol).toBe('anthropic-messages');
    expect(projection.method).toBe('messages/v1');
    expect(projection.projectionRevision).toBe(1);
    expect(projection.model).toBe('claude-3-5-sonnet');
    expect(projection.unsupportedMedia).toHaveLength(1);
    expect(projection.unsupportedMedia[0].kind).toBe('unsupported');
  });

  it('counts tokens against its finalized representation via legacyEstimate', async () => {
    const projection: PromptEnvelopeProjection = {
      model: 'gpt-4o',
      protocol: 'openai-chat',
      method: 'chat/completions/v1',
      projectionRevision: 1,
      unsupportedMedia: [],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(1234),
    };

    const tokens = await projection.legacyEstimate();
    expect(tokens).toBe(1234);
  });

  it('accepts the openai-responses protocol and responses/v1 method', () => {
    const projection: PromptEnvelopeProjection = {
      model: 'gpt-4o',
      protocol: 'openai-responses',
      method: 'responses/v1',
      projectionRevision: 1,
      unsupportedMedia: [],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(0),
    };

    const protocol: PromptEnvelopeProtocol = projection.protocol;
    const method: PromptEnvelopeMethod = projection.method;
    expect(protocol).toBe('openai-responses');
    expect(method).toBe('responses/v1');
  });
});

describe('PromptEnvelopeEstimate result contract (issue #2817)', () => {
  it('carries model identity, protocol, method/version, projection revision, token count, and unsupported media', () => {
    const estimate: PromptEnvelopeEstimate = {
      estimatedPromptTokens: 842,
      transmittedTokens: 842,
      retainedBaselineTokens: 0,
      effectiveTokens: 842,
      statefulParentUsed: false,
      activeProvider: 'anthropic',
      model: 'claude-3-5-sonnet',
      protocol: 'anthropic-messages',
      method: 'messages/v1',
      estimatorMethod: 'calibrated',
      estimatorFamily: 'legacy-unregistered',
      estimatorVersion: 'core-estimate-tokens-v1',
      assetRevision: 'none',
      projectionRevision: 1,
      unsupportedMedia: [
        {
          kind: 'unsupported',
          reason: 'audio not supported',
          mediaType: 'audio',
        },
      ],
    };

    expect(estimate.estimatedPromptTokens).toBe(842);
    expect(estimate.model).toBe('claude-3-5-sonnet');
    expect(estimate.protocol).toBe('anthropic-messages');
    expect(estimate.method).toBe('messages/v1');
    expect(estimate.projectionRevision).toBe(1);
    expect(estimate.unsupportedMedia).toHaveLength(1);
  });

  it('does NOT carry any raw prompt payload (no requestBody, messages, or system text)', async () => {
    // Derive the estimate through the real seam rather than asserting on a
    // hand-built object: an implementation that copied raw prompt fields onto
    // the result must fail this test.
    const estimate = await estimatePromptEnvelope({
      model: 'gpt-4o',
      protocol: 'openai-chat',
      method: 'chat/completions/v1',
      projectionRevision: 1,
      unsupportedMedia: [],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(100),
    });

    expect(estimate.estimatedPromptTokens).toBe(100);

    const keys = Object.keys(estimate) as Array<keyof PromptEnvelopeEstimate>;
    const forbidden = [
      'requestBody',
      'messages',
      'system',
      'systemInstruction',
      'instructions',
      'input',
      'prompt',
      'rawPrompt',
    ];
    for (const key of forbidden) {
      expect(
        keys,
        `result must not expose raw prompt field "${key}"`,
      ).not.toContain(key as keyof PromptEnvelopeEstimate);
    }
  });

  it('can be derived from a projection by estimating', async () => {
    const projection: PromptEnvelopeProjection = {
      model: 'gpt-4o',
      protocol: 'openai-responses',
      method: 'responses/v1',
      projectionRevision: 1,
      unsupportedMedia: [],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(555),
    };

    const estimate = await estimatePromptEnvelope(projection);

    expect(estimate.estimatedPromptTokens).toBe(555);
    expect(estimate.activeProvider).toBe('test-provider');
    expect(estimate.estimatorMethod).toBe('calibrated');
    expect(estimate.estimatorFamily).toBe('legacy-unregistered');
    expect(estimate.estimatorVersion).toBe('core-estimate-tokens-v1');
    expect(estimate.assetRevision).toBe('none');
    expect(estimate.model).toBe('gpt-4o');
    expect(estimate.protocol).toBe('openai-responses');

    expect(estimate.method).toBe('responses/v1');
    expect(estimate.projectionRevision).toBe(1);
    expect(estimate.unsupportedMedia).toStrictEqual([]);
  });

  it('uses effective provider context as the authoritative estimate and exposes its accounting facts', async () => {
    const projection: PromptEnvelopeProjection = {
      model: 'gpt-4o',
      protocol: 'openai-responses',
      method: 'responses/v1',
      projectionRevision: 3,
      unsupportedMedia: [],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(17),
      accounting: {
        statefulParentUsed: true,
        retainedBaselineTokens: 50_000,
        incremental: {
          finalizedProjection: Object.freeze({}),
          legacyEstimate: () => Promise.resolve(5),
        },
      },
    };

    const estimate = await estimatePromptEnvelope(projection);

    expect(estimate.estimatedPromptTokens).toBe(50_005);
    expect(estimate.transmittedTokens).toBe(17);
    expect(estimate.incrementalTokens).toBe(5);
    expect(estimate.retainedBaselineTokens).toBe(50_000);
    expect(estimate.effectiveTokens).toBe(50_005);
    expect(estimate.statefulParentUsed).toBe(true);
  });

  it('uses configured estimator counts instead of legacy accounting values', async () => {
    const incrementalProjection = Object.freeze({ kind: 'incremental' });
    const projection: PromptEnvelopeProjection = {
      model: 'gpt-4o',
      protocol: 'openai-responses',
      method: 'responses/v1',
      projectionRevision: 3,
      unsupportedMedia: [],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({ kind: 'wire' }),
      legacyEstimate: () => Promise.resolve(17),
      accounting: {
        statefulParentUsed: true,
        retainedBaselineTokens: 50_000,
        incremental: {
          finalizedProjection: incrementalProjection,
          legacyEstimate: () => Promise.resolve(7),
        },
      },
    };
    const configuredFactory: RuntimeTokenizerFactory = {
      getTokenizer: () => undefined,
      estimatePrompt: async (request) => ({
        count: request.finalizedProjection === incrementalProjection ? 11 : 29,
        method: 'exact',
        family: 'configured-estimator',
        estimatorVersion: 'authority-v1',
        assetRevision: 'authority-fixture',
        projectionRevision: request.projectionRevision,
      }),
    };

    const estimate = await estimatePromptEnvelopeImpl(
      'test-provider',
      projection,
      configuredFactory,
    );

    expect(estimate.transmittedTokens).toBe(29);
    expect(estimate.incrementalTokens).toBe(11);
    expect(estimate.estimatedPromptTokens).toBe(50_011);
    expect(estimate.effectiveTokens).toBe(50_011);
    expect(estimate.estimatorMethod).toBe('exact');
    expect(estimate.estimatorFamily).toBe('configured-estimator');
  });

  it('rejects full-history accounting smaller than its incremental contribution', async () => {
    const projection: PromptEnvelopeProjection = {
      model: 'gpt-4o',
      protocol: 'openai-responses',
      method: 'responses/v1',
      projectionRevision: 3,
      unsupportedMedia: [],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(7),
      accounting: {
        statefulParentUsed: true,
        incremental: {
          finalizedProjection: Object.freeze({}),
          legacyEstimate: () => Promise.resolve(11),
        },
        fullHistory: {
          finalizedProjection: Object.freeze({}),
          legacyEstimate: () => Promise.resolve(5),
        },
      },
    };

    await expect(estimatePromptEnvelope(projection)).rejects.toThrow(
      /full-history estimate \(5\) is smaller than the incremental estimate \(11\)/i,
    );
  });

  it.each([
    [
      'stateless accounting with a retained baseline',
      { statefulParentUsed: false, retainedBaselineTokens: 1 },
      /stateless accounting cannot carry retained/i,
    ],
    [
      'stateful accounting without an incremental projection',
      { statefulParentUsed: true, retainedBaselineTokens: 50_000 },
      /requires an incremental projection/i,
    ],
    [
      'stateful accounting without observed usage or full history',
      {
        statefulParentUsed: true,
        incremental: {
          finalizedProjection: Object.freeze({}),
          legacyEstimate: () => Promise.resolve(7),
        },
      },
      /requires a full-history projection/i,
    ],
  ])('rejects %s before estimation', async (_name, accounting, expected) => {
    const projection: PromptEnvelopeProjection = {
      model: 'gpt-4o',
      protocol: 'openai-responses',
      method: 'responses/v1',
      projectionRevision: 3,
      unsupportedMedia: [],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(17),
      accounting,
    };

    await expect(estimatePromptEnvelope(projection)).rejects.toThrow(expected);
  });

  it.each([
    [
      'mismatched projection revision',
      { projectionRevision: 2 },
      /projection revision/i,
    ],
    [
      'invalid estimator method',
      { method: 'approximate' },
      /estimator method/i,
    ],
  ])(
    'rejects %s returned by the estimator factory',
    async (_name, invalid, expected) => {
      const projection: PromptEnvelopeProjection = {
        model: 'gpt-4o',
        protocol: 'openai-responses',
        method: 'responses/v1',
        projectionRevision: 1,
        unsupportedMedia: [],
        transportToken: Object.freeze({}),
        finalizedProjection: Object.freeze({}),
        legacyEstimate: () => Promise.resolve(10),
      };
      const invalidFactory: RuntimeTokenizerFactory = {
        getTokenizer: () => undefined,
        estimatePrompt: async (request) =>
          ({
            count: 10,
            method: 'calibrated',
            family: 'legacy-unregistered',
            estimatorVersion: 'core-estimate-tokens-v1',
            assetRevision: 'none',
            projectionRevision: request.projectionRevision,
            ...invalid,
          }) as Awaited<ReturnType<RuntimeTokenizerFactory['estimatePrompt']>>,
      };

      await expect(
        estimatePromptEnvelopeImpl('test-provider', projection, invalidFactory),
      ).rejects.toThrow(expected);
    },
  );

  it('preserves unsupported media entries from the projection into the estimate', async () => {
    const unsupported: UnsupportedMediaEntry = {
      kind: 'unsupported',
      reason: 'audio not supported',
      mediaType: 'audio',
    };
    const projection: PromptEnvelopeProjection = {
      model: 'claude-3-5-sonnet',
      protocol: 'anthropic-messages',
      method: 'messages/v1',
      projectionRevision: 2,
      unsupportedMedia: [unsupported],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(300),
    };

    const estimate = await estimatePromptEnvelope(projection);

    expect(estimate.unsupportedMedia).toStrictEqual([unsupported]);
    expect(estimate.projectionRevision).toBe(2);
  });

  it('deep-freezes the estimate, unsupported-media array, and every entry', async () => {
    const projection: PromptEnvelopeProjection = {
      model: 'gpt-4o',
      protocol: 'openai-chat',
      method: 'chat/completions/v1',
      projectionRevision: 1,
      unsupportedMedia: [
        {
          kind: 'unsupported',
          reason: 'audio is not supported',
          mediaType: 'audio',
        },
      ],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(10),
    };

    const estimate = await estimatePromptEnvelope(projection);

    expect(Object.isFrozen(estimate)).toBe(true);
    expect(Object.isFrozen(estimate.unsupportedMedia)).toBe(true);
    expect(Object.isFrozen(estimate.unsupportedMedia[0])).toBe(true);
  });

  it('fail-fast: rejects a projection with an empty model', async () => {
    const projection = {
      model: '',
      protocol: 'anthropic-messages',
      method: 'messages/v1',
      projectionRevision: 1,
      unsupportedMedia: [],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(10),
    } as unknown as PromptEnvelopeProjection;

    await expect(estimatePromptEnvelope(projection)).rejects.toThrow(/model/i);
  });

  it('fail-fast: rejects a projection with a negative token count', async () => {
    const projection = {
      model: 'gpt-4o',
      protocol: 'openai-chat',
      method: 'chat/completions/v1',
      projectionRevision: 1,
      unsupportedMedia: [],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(-5),
    } as unknown as PromptEnvelopeProjection;

    await expect(estimatePromptEnvelope(projection)).rejects.toThrow(/token/i);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1.5,
  ])('fail-fast: rejects invalid token count %s', async (tokenCount) => {
    const projection = {
      model: 'gpt-4o',
      protocol: 'openai-chat',
      method: 'chat/completions/v1',
      projectionRevision: 1,
      unsupportedMedia: [],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(tokenCount),
    } as unknown as PromptEnvelopeProjection;

    await expect(estimatePromptEnvelope(projection)).rejects.toThrow(/token/i);
  });

  it('fail-fast: rejects malformed unsupportedMedia with a clear contract error', async () => {
    const projection = {
      model: 'gpt-4o',
      protocol: 'openai-chat',
      method: 'chat/completions/v1',
      projectionRevision: 1,
      unsupportedMedia: null,
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(10),
    } as unknown as PromptEnvelopeProjection;

    await expect(estimatePromptEnvelope(projection)).rejects.toThrow(
      /unsupportedMedia must be an array/i,
    );
  });

  it('fail-fast: rejects malformed unsupported-media entries', async () => {
    const projection = {
      model: 'gpt-4o',
      protocol: 'openai-chat',
      method: 'chat/completions/v1',
      projectionRevision: 1,
      unsupportedMedia: [{ kind: 'other', reason: '' }],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(10),
    } as unknown as PromptEnvelopeProjection;

    await expect(estimatePromptEnvelope(projection)).rejects.toThrow(
      /unsupportedMedia\[0\]/i,
    );
  });

  it('fail-fast: validates synchronous projection identity (including unsupportedMedia) before awaiting legacyEstimate', async () => {
    // A projection with invalid unsupportedMedia must reject WITHOUT ever
    // paying for the async token count — proving synchronous fields are
    // validated up front (fail-fast before async work).
    let tokenCountCalls = 0;
    const projection = {
      model: 'gpt-4o',
      protocol: 'openai-chat',
      method: 'chat/completions/v1',
      projectionRevision: 1,
      unsupportedMedia: 'not-an-array',
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => {
        tokenCountCalls += 1;
        return Promise.resolve(10);
      },
    } as unknown as PromptEnvelopeProjection;

    await expect(estimatePromptEnvelope(projection)).rejects.toThrow(
      /unsupportedMedia must be an array/i,
    );
    expect(tokenCountCalls).toBe(0);
  });

  it('fail-fast: rejects a projection with a negative projection revision', async () => {
    const projection = {
      model: 'gpt-4o',
      protocol: 'openai-chat',
      method: 'chat/completions/v1',
      projectionRevision: -1,
      unsupportedMedia: [],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(10),
    } as unknown as PromptEnvelopeProjection;

    await expect(estimatePromptEnvelope(projection)).rejects.toThrow(
      /revision/i,
    );
  });

  it('does not mutate the input projection unsupportedMedia array or entries', async () => {
    const originalEntry = {
      kind: 'unsupported' as const,
      reason: 'audio not supported',
      mediaType: 'audio',
    };
    const inputUnsupportedMedia = [originalEntry];
    const projection: PromptEnvelopeProjection = {
      model: 'gpt-4o',
      protocol: 'openai-chat',
      method: 'chat/completions/v1',
      projectionRevision: 1,
      unsupportedMedia: inputUnsupportedMedia,
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(10),
    };

    const estimate = await estimatePromptEnvelope(projection);

    // The estimate's frozen copy is correct.
    expect(estimate.unsupportedMedia).toHaveLength(1);
    expect(estimate.unsupportedMedia[0]).toStrictEqual(originalEntry);

    // The INPUT array itself must be unmutated.
    expect(inputUnsupportedMedia).toHaveLength(1);
    expect(inputUnsupportedMedia[0]).toStrictEqual({
      kind: 'unsupported',
      reason: 'audio not supported',
      mediaType: 'audio',
    });
    expect(Object.isFrozen(inputUnsupportedMedia)).toBe(false);
    expect(Object.isFrozen(originalEntry)).toBe(false);
  });

  it('propagates rejection from legacyEstimate without masking', async () => {
    const projectionError = new Error('provider tokenizer unavailable');
    const projection: PromptEnvelopeProjection = {
      model: 'gpt-4o',
      protocol: 'openai-chat',
      method: 'chat/completions/v1',
      projectionRevision: 1,
      unsupportedMedia: [],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.reject(projectionError),
    };

    await expect(estimatePromptEnvelope(projection)).rejects.toBe(
      projectionError,
    );
  });
});

describe('protocol/method pair validation (issue #2817)', () => {
  it.each([
    ['anthropic-messages', 'messages/v1'],
    ['openai-chat', 'chat/completions/v1'],
    ['openai-responses', 'responses/v1'],
  ] as const)(
    'accepts the supported pair %s + %s',
    async (protocol, method) => {
      const projection: PromptEnvelopeProjection = {
        model: 'test-model',
        protocol,
        method,
        projectionRevision: 1,
        unsupportedMedia: [],
        transportToken: Object.freeze({}),
        finalizedProjection: Object.freeze({}),
        legacyEstimate: () => Promise.resolve(11),
      };

      const estimate = await estimatePromptEnvelope(projection);

      expect(estimate.protocol).toBe(protocol);
      expect(estimate.method).toBe(method);
      expect(estimate.estimatedPromptTokens).toBe(11);
    },
  );

  it.each([
    ['openai-chat', 'responses/v1'],
    ['openai-chat', 'messages/v1'],
    ['openai-responses', 'chat/completions/v1'],
    ['anthropic-messages', 'chat/completions/v1'],
  ])(
    'fail-fast: rejects the incompatible pair %s + %s before counting tokens',
    async (protocol, method) => {
      let tokenCountCalls = 0;
      const projection = {
        model: 'test-model',
        protocol,
        method,
        projectionRevision: 1,
        unsupportedMedia: [],
        transportToken: Object.freeze({}),
        finalizedProjection: Object.freeze({}),
        legacyEstimate: () => {
          tokenCountCalls += 1;
          return Promise.resolve(11);
        },
      } as unknown as PromptEnvelopeProjection;

      await expect(estimatePromptEnvelope(projection)).rejects.toThrow(
        /protocol .* does not support method/i,
      );
      expect(tokenCountCalls).toBe(0);
    },
  );

  it('fail-fast: rejects an unknown protocol before counting tokens', async () => {
    let tokenCountCalls = 0;
    const projection = {
      model: 'test-model',
      protocol: 'gemini-generate',
      method: 'messages/v1',
      projectionRevision: 1,
      unsupportedMedia: [],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => {
        tokenCountCalls += 1;
        return Promise.resolve(11);
      },
    } as unknown as PromptEnvelopeProjection;

    await expect(estimatePromptEnvelope(projection)).rejects.toThrow(
      /protocol must be one of/i,
    );
    expect(tokenCountCalls).toBe(0);
  });
});

describe('UnsupportedMediaEntry contract (issue #2817)', () => {
  it('marks unsupported media explicitly rather than silently caption-only', () => {
    const entry: UnsupportedMediaEntry = {
      kind: 'unsupported',
      reason: 'video not supported by provider',
      mediaType: 'video',
    };

    expect(entry.kind).toBe('unsupported');
    expect(entry.reason).toBeTypeOf('string');
    expect(entry.reason.length).toBeGreaterThan(0);
  });

  it('may omit mediaType when the category is unknown', () => {
    const entry: UnsupportedMediaEntry = {
      kind: 'unsupported',
      reason: 'unknown media block',
    };
    expect(entry.mediaType).toBeUndefined();
  });
});
