/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ProviderContentEnvelope construction (issue #2304).
 * The envelope bundles provider-ready contents together with the raw pending
 * (new, unsent) IContent items so downstream enforcement does not have to
 * reverse-engineer the pending boundary from the contents array.
 */

import { describe, it, expect } from 'vitest';
import {
  buildProviderContent,
  buildProviderContentEnvelope,
} from './historyProviderPipeline.js';
import type { IContent } from './IContent.js';
import type { DebugLogger } from '../../debug/index.js';

function makeLogger(): DebugLogger {
  return {
    debug: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
    child: () => makeLogger(),
  } as unknown as DebugLogger;
}

function makeUserMessage(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { timestamp: 1 },
  };
}

function makeAiMessage(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { timestamp: 2 },
  };
}

describe('buildProviderContentEnvelope (issue #2304)', () => {
  const logger = makeLogger();

  it('returns contents from buildProviderContent and passes through pendingContents', () => {
    const curated: IContent[] = [
      makeUserMessage('curated user'),
      makeAiMessage('curated ai'),
    ];
    const pending: IContent[] = [makeUserMessage('pending user')];

    const envelope = buildProviderContentEnvelope(curated, pending, logger);

    expect(envelope.contents).toStrictEqual(
      buildProviderContent(curated, pending, logger),
    );
    expect(envelope.pendingContents).toBe(pending);
  });

  it('passes empty pending contents through when no pending is supplied', () => {
    const curated: IContent[] = [makeUserMessage('curated user')];

    const envelope = buildProviderContentEnvelope(curated, [], logger);

    expect(envelope.contents).toStrictEqual(
      buildProviderContent(curated, [], logger),
    );
    expect(envelope.pendingContents).toStrictEqual([]);
  });
});
