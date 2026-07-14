/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ProviderContentEnforcer token-model mismatch fix
 * (issue #2304). The enforcer must use provider.getDefaultModel() for
 * token estimation when available, falling back to
 * runtimeContext.state.model only when the provider has no default model.
 *
 * These tests follow dev-docs/RULES.md: they assert observable behavior
 * (whether compression is triggered or not) and NEVER assert that mock
 * functions were called.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  makeUserMessage,
  buildRuntimeContext,
} from '../../core/__tests__/chatSession-density-helpers.js';
import {
  ProviderContentEnforcer,
  type ProviderContentEnforcementDeps,
} from '../providerContentEnforcement.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';

function makeLogger(): DebugLogger {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as DebugLogger;
}

interface EnforcerHarness {
  enforcer: ProviderContentEnforcer;
  deps: ProviderContentEnforcementDeps;
  historyService: HistoryService;
}

function buildEnforcerHarness(
  historyService: HistoryService,
  runtimeContext: AgentRuntimeContext,
  overrides: Partial<ProviderContentEnforcementDeps> = {},
): EnforcerHarness {
  const performCompression = vi.fn();
  const performFallbackCompression = vi.fn().mockResolvedValue(false);
  const ensureDensityOptimized = vi.fn().mockResolvedValue(undefined);
  const deps: ProviderContentEnforcementDeps = {
    historyService,
    runtimeContext,
    generationConfig: {},
    providerRuntimeNullable: undefined,
    logger: makeLogger(),
    ensureDensityOptimized,
    performCompression,
    performFallbackCompression,
    ...overrides,
  };
  return { enforcer: new ProviderContentEnforcer(deps), deps, historyService };
}

describe('ProviderContentEnforcer token-model mismatch (issue #2304)', () => {
  let historyService: HistoryService;
  let runtimeContext: AgentRuntimeContext;

  beforeEach(() => {
    vi.clearAllMocks();
    historyService = new HistoryService();
    // Default contextLimit=131134, compressionThreshold=0.8.
    // completionBudget=65_536, effectiveLimit=131134-65536=65598.
    // compressionThreshold = min(130134, 0.8*65598+65536) = min(130134, 118014) = 118014.
    runtimeContext = buildRuntimeContext(historyService, {
      compressionThreshold: 0.8,
    });
  });

  it('uses provider model for token estimation, triggering compression that would not occur with the runtime model', async () => {
    // The provider advertises 'gpt-4o'. The runtime model is 'test-model'.
    // Different models produce different token estimates for the same contents.
    // With the runtime model (test-model): 50_000 tokens → projected 115_536,
    // which is UNDER the 118_014 compression threshold (no compression).
    // With the provider model (gpt-4o): 120_000 tokens → projected 185_536,
    // which is OVER the threshold (compression triggered).
    //
    // If the enforcer wrongly used runtimeContext.state.model for estimation,
    // it would estimate 50_000 and skip compression. The fact that compression
    // IS triggered proves the provider model is used.
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('pending request');
    const contents = historyService.getCuratedForProvider([pending]);

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    const estimateSpy = vi
      .spyOn(historyService, 'estimateTokensForContents')
      .mockImplementation(async (_contents: IContent[], model: string) => {
        if (model === 'gpt-4o') {
          return 120_000;
        }
        return 50_000;
      });

    harness.deps.performCompression.mockImplementation(async () => {
      historyService.clear();
      historyService.add(makeUserMessage('compressed summary'));
      estimateSpy.mockResolvedValue(1_000);
      return PerformCompressionResult.COMPRESSED;
    });

    const providerWithDefaultModel = {
      name: 'test-provider',
      generateChatCompletion: vi.fn(),
      getDefaultModel: () => 'gpt-4o',
    } as unknown as IProvider;

    const result = await harness.enforcer.enforce(
      { contents, pendingContents: [pending] },
      'test-prompt',
      providerWithDefaultModel,
    );

    // Compression was triggered (provider model used for estimation → 120_000
    // estimate → over threshold). The result reflects compressed history.
    expect(result).not.toStrictEqual(contents);
    expect(result).toContainEqual(pending);
  });

  it('uses runtime model for estimation when provider has no getDefaultModel, keeping payload under threshold', async () => {
    // No provider default model — the enforcer uses 'test-model'.
    // With test-model: 50_000 tokens → projected 115_536 < 118_014 threshold.
    // No compression triggered, contents returned as-is.
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('pending request');
    const contents = historyService.getCuratedForProvider([pending]);

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    vi.spyOn(historyService, 'estimateTokensForContents').mockImplementation(
      async (_contents: IContent[], model: string) => {
        if (model === 'gpt-4o') {
          return 120_000;
        }
        return 50_000;
      },
    );

    const providerWithoutDefaultModel = {
      name: 'test-provider',
      generateChatCompletion: vi.fn(),
    } as unknown as IProvider;

    const result = await harness.enforcer.enforce(
      { contents, pendingContents: [pending] },
      'test-prompt',
      providerWithoutDefaultModel,
    );

    // No compression triggered (runtime model used → 50_000 estimate → under
    // threshold). Contents returned unchanged.
    expect(result).toStrictEqual(contents);
  });

  it('falls back to runtimeContext.state.model for estimation when provider has no getDefaultModel and payload exceeds threshold', async () => {
    // No provider default model — the enforcer uses 'test-model'.
    // A token estimate of 900_000 exceeds the threshold, triggering
    // compression. This verifies the fallback path works correctly.
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('pending request');
    const contents = historyService.getCuratedForProvider([pending]);

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    const estimateSpy = vi
      .spyOn(historyService, 'estimateTokensForContents')
      .mockImplementation(async (_contents: IContent[], model: string) => {
        if (model !== 'test-model') {
          return 50_000; // Under threshold — wrong model would NOT trigger compression
        }
        return 900_000; // test-model — over threshold, triggers compression
      });

    harness.deps.performCompression.mockImplementation(async () => {
      historyService.clear();
      historyService.add(makeUserMessage('compressed summary'));
      estimateSpy.mockResolvedValue(1_000);
      return PerformCompressionResult.COMPRESSED;
    });

    const providerWithoutDefaultModel = {
      name: 'test-provider',
      generateChatCompletion: vi.fn(),
    } as unknown as IProvider;

    const result = await harness.enforcer.enforce(
      { contents, pendingContents: [pending] },
      'test-prompt',
      providerWithoutDefaultModel,
    );

    // Compression was triggered and the result reflects the compressed history.
    expect(result).not.toStrictEqual(contents);
    expect(result).toContainEqual(pending);
  });
});
