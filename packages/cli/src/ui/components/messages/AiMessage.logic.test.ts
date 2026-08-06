/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';

import { getVisibleThinkingBlocks } from './AiMessage.js';

describe('getVisibleThinkingBlocks', () => {
  const visibleBlock: ThinkingBlock = {
    type: 'thinking',
    thought: 'Visible thought',
    sourceField: 'thinking',
  };
  const hiddenBlock: ThinkingBlock = {
    type: 'thinking',
    thought: 'Hidden thought',
    sourceField: 'thinking',
    isHidden: true,
  };

  it('returns undefined when reasoning output is disabled', () => {
    expect(getVisibleThinkingBlocks(false, [visibleBlock])).toBeUndefined();
  });

  it('returns undefined when no thinking blocks are available', () => {
    expect(getVisibleThinkingBlocks(true, undefined)).toBeUndefined();
  });
  it('keeps visible thinking blocks for pending and committed message rendering', () => {
    expect(getVisibleThinkingBlocks(true, [visibleBlock])).toStrictEqual([
      visibleBlock,
    ]);
  });

  it('filters hidden thinking blocks from renderer input', () => {
    expect(
      getVisibleThinkingBlocks(true, [hiddenBlock, visibleBlock]),
    ).toStrictEqual([visibleBlock]);
  });
});
