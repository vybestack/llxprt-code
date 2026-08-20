/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3257: the wrapper's per-call prompt id must be the caller-visible
 * logical request id threaded through options metadata, so provider-attempt
 * perf notifications join caller-side operation registries instead of a
 * parallel minted-id namespace that never matches.
 *
 * Real LoggingProviderWrapper (+ RetryOrchestrator stack for the claudecode
 * shape), real AttemptRecorder, real perf-observer seam. Only the transport
 * and the observer are test doubles.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as sdk from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import {
  setPerfPhaseObserver,
  type PerfPhaseObserver,
  type PerfProviderAttemptStartInfo,
  type PerfProviderAttemptEndInfo,
} from '@vybestack/llxprt-code-core/perf/perfPhaseObserver.js';
import { LOGICAL_REQUEST_ID_KEY } from '../index.js';
import {
  createConfig,
  makeContent,
  makeOptions,
  consumeStream,
  buildStack,
  SuccessProvider,
  USAGE_BASIC,
} from './attemptLifecycle.helpers.test.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

function capturingObserver(): {
  observer: PerfPhaseObserver;
  starts: PerfProviderAttemptStartInfo[];
  ends: PerfProviderAttemptEndInfo[];
} {
  const starts: PerfProviderAttemptStartInfo[] = [];
  const ends: PerfProviderAttemptEndInfo[] = [];
  const observer: PerfPhaseObserver = {
    onProviderAttemptStart: (info) => starts.push(info),
    onProviderAttemptEnd: (info) => ends.push(info),
    onToolCallCompleted: () => undefined,
  };
  return { observer, starts, ends };
}

const TEXT_AND_USAGE_CHUNKS: IContent[] = [
  { speaker: 'ai', blocks: [{ type: 'text', text: 'Hello' }] },
  { speaker: 'ai', blocks: [{ type: 'text', text: ' world' }] },
  { speaker: 'ai', blocks: [], metadata: { usage: USAGE_BASIC } },
] as IContent[];

describe('LoggingProviderWrapper logical request id threading (#3257)', () => {
  beforeEach(() => {
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(false);
    setPerfPhaseObserver(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setPerfPhaseObserver(null);
  });

  it('uses the metadata-threaded logical request id for perf attempt boundaries', async () => {
    const { observer, starts, ends } = capturingObserver();
    setPerfPhaseObserver(observer);

    const config = createConfig(false);
    const wrapper = buildStack(
      new SuccessProvider(TEXT_AND_USAGE_CHUNKS),
      config,
    );
    const options = makeOptions(config, makeContent('Hello'));
    options.metadata = {
      ...(options.metadata ?? {}),
      [LOGICAL_REQUEST_ID_KEY]: 'op-prompt-1',
    };

    await consumeStream(wrapper.generateChatCompletion(options));

    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(starts[0].promptId).toBe('op-prompt-1');
    expect(ends[0].promptId).toBe('op-prompt-1');
    expect(ends[0].status).toBe('success');
  });

  it('mints a fresh prompt_ id per call when no logical request id is threaded', async () => {
    const { observer, starts } = capturingObserver();
    setPerfPhaseObserver(observer);

    const config = createConfig(false);
    const wrapper = buildStack(
      new SuccessProvider(TEXT_AND_USAGE_CHUNKS),
      config,
    );

    await consumeStream(
      wrapper.generateChatCompletion(makeOptions(config, makeContent('one'))),
    );
    await consumeStream(
      wrapper.generateChatCompletion(makeOptions(config, makeContent('two'))),
    );

    expect(starts).toHaveLength(2);
    expect(starts[0].promptId.startsWith('prompt_')).toBe(true);
    expect(starts[1].promptId.startsWith('prompt_')).toBe(true);
    expect(starts[0].promptId).not.toBe(starts[1].promptId);
  });

  // claudecode == AnthropicOAuthProvider routes through the central
  // RetryOrchestrator, whose attempt-end notifications carry no token
  // metrics. The perf end info must still carry the threaded logical id and
  // the token counts resolved from the usage metadata the wrapper recorded.
  it('RetryOrchestrator-owned attempts: threaded id + resolved tokens reach the perf observer', async () => {
    const { observer, starts, ends } = capturingObserver();
    setPerfPhaseObserver(observer);

    const config = createConfig(false);
    const wrapper = buildStack(
      new SuccessProvider(TEXT_AND_USAGE_CHUNKS),
      config,
    );
    const options = makeOptions(config, makeContent('Hello'));
    options.metadata = {
      ...(options.metadata ?? {}),
      [LOGICAL_REQUEST_ID_KEY]: 'op-claude-1',
    };

    await consumeStream(wrapper.generateChatCompletion(options));

    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(starts[0].promptId).toBe('op-claude-1');
    expect(ends[0].promptId).toBe('op-claude-1');
    expect(ends[0].status).toBe('success');
    expect(ends[0].inputTokens).toBe(USAGE_BASIC.promptTokens);
    expect(ends[0].outputTokens).toBe(USAGE_BASIC.completionTokens);
  });
});
