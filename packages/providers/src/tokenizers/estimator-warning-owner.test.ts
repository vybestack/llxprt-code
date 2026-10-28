/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { RuntimePromptEstimateRequest } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import {
  ModelPromptEstimatorRegistry,
  type ModelPromptEstimatorRegistration,
} from './ModelPromptEstimatorRegistry.js';

const registration: ModelPromptEstimatorRegistration = {
  family: 'owner-test',
  claim: /^owner-test/,
  matches: () => false,
  protocols: new Set(['openai-chat']),
  estimate: async () => {
    throw new Error('Unrecognized model must use the legacy estimate');
  },
};
const request: RuntimePromptEstimateRequest = {
  activeProvider: 'same-provider',
  canonicalModel: 'owner-test-unknown',
  protocol: 'openai-chat',
  wireMethod: 'chat/completions/v1',
  finalizedProjection: undefined,
  projectionRevision: 1,
  legacyEstimate: async () => 7,
};

describe('estimator degradation warning ownership', () => {
  it('warns each owner once for the same model without suppressing its sibling', async () => {
    const firstWarnings: string[] = [];
    const secondWarnings: string[] = [];
    const first = new ModelPromptEstimatorRegistry(
      [registration],
      (message) => {
        firstWarnings.push(message);
      },
    );
    const second = new ModelPromptEstimatorRegistry(
      [registration],
      (message) => {
        secondWarnings.push(message);
      },
    );
    const results = await Promise.all([
      first.estimatePrompt(request),
      first.estimatePrompt(request),
      second.estimatePrompt(request),
      second.estimatePrompt(request),
    ]);
    expect(results.map((result) => result.family)).toStrictEqual(
      Array(4).fill('legacy-unresolved-identity'),
    );
    expect([firstWarnings.length, secondWarnings.length]).toStrictEqual([1, 1]);
    expect(firstWarnings[0]).toContain(request.canonicalModel);
    expect(secondWarnings[0]).toContain(request.activeProvider);
  });
});
