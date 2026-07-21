/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from 'vitest';
import {
  evalTest,
  saveMemoryFactEquals,
  assertFavoriteColorBlueOutput,
} from './test-helper.js';

describe('save_memory', () => {
  evalTest('ALWAYS_PASSES', {
    name: 'should be able to save to memory',
    params: {
      settings: { tools: { core: ['save_memory'] } },
    },
    prompt: [
      'Follow these instructions exactly.',
      '',
      '1. Call the save_memory tool with the fact argument set exactly to:',
      '   "My favorite color is blue"',
      '   Do not add, rephrase, qualify, or correct the fact in any way.',
      '',
      '2. Then answer with exactly this text and nothing else:',
      '   $blue$',
      '   Do not add any other words, punctuation, or explanation.',
    ].join('\n'),
    assert: async (rig, result) => {
      // The tool call must have succeeded AND persisted exactly the canonical
      // fact — a call that errored, saved the wrong content, or saved a
      // paraphrase/negation is a failure.
      await rig.expectToolCallSuccess(
        ['save_memory'],
        undefined,
        saveMemoryFactEquals('blue'),
      );

      // The model must answer exactly "$blue$" (case/outer-whitespace
      // tolerant). Surrounding prose, the wrong color, or missing dollar
      // delimiters is a hard failure.
      assertFavoriteColorBlueOutput(result);
    },
  });
});
