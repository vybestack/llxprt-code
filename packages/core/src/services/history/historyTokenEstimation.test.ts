/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it } from 'bun:test';
import { serializeWireContentForEstimate } from './historyTokenEstimation.js';
import type { IContent } from './IContent.js';

const baseContent: IContent = {
  speaker: 'ai',
  blocks: [
    { type: 'text', text: 'the quick brown fox' },
    { type: 'tool_call', id: 'call-1', name: 'run', parameters: { a: 1 } },
  ],
};

function withChronology(content: IContent): IContent {
  return {
    ...content,
    metadata: {
      ...content.metadata,
      chronology: { seq: 12, userTurn: 4, step: 3, recordedAt: 1_759_000_000 },
      chronologyReplaced: { fromSeq: 1, toSeq: 11, itemCount: 11 },
    },
  };
}

describe('serializeWireContentForEstimate', () => {
  /** AC23 */
  it('produces an identical string with and without a chronology marker', () => {
    expect(serializeWireContentForEstimate(withChronology(baseContent))).toBe(
      serializeWireContentForEstimate(baseContent),
    );
  });

  it('excludes every metadata field, not just chronology', () => {
    const withMetadata: IContent = {
      ...baseContent,
      metadata: { model: 'gpt-4.1', turnId: 'turn_abc', isSummary: true },
    };

    const serialized = serializeWireContentForEstimate(withMetadata);

    expect(serialized).not.toContain('turn_abc');
  });

  it('retains the speaker so role changes still affect the estimate', () => {
    const asHuman: IContent = { ...baseContent, speaker: 'human' };

    expect(serializeWireContentForEstimate(asHuman)).not.toBe(
      serializeWireContentForEstimate(baseContent),
    );
  });

  it('retains block content so text changes still affect the estimate', () => {
    const longer: IContent = {
      ...baseContent,
      blocks: [{ type: 'text', text: 'a much longer piece of text entirely' }],
    };

    expect(serializeWireContentForEstimate(longer)).not.toBe(
      serializeWireContentForEstimate(baseContent),
    );
  });
});
