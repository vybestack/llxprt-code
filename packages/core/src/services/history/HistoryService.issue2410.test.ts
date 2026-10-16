import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
/**
 * Copyright 2025 Vybestack LLC
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

/**
 * Regression tests for issue #2410:
 * HistoryService.addInternal must refuse to store an IContent with zero
 * blocks — the systemic safety net against empty turns in provider-facing
 * history (z.ai rejects these with HTTP 400 error 1213).
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

let service: HistoryService;
async function assertRejectedEmpty0(): Promise<void> {
  const emptyHuman: IContent = {
    speaker: 'human',
    blocks: [],
  };
  service.add(emptyHuman);
  expect(service.length()).toBe(0);

  await collectRowsForAssertions(service.streamRawHistory(), (rows) => {
    expect(rows).toHaveLength(0);
  });
}

async function assertRejectedEmpty1(): Promise<void> {
  const emptyAI: IContent = {
    speaker: 'ai',
    blocks: [],
  };
  service.add(emptyAI);
  expect(service.length()).toBe(0);

  await collectRowsForAssertions(service.streamRawHistory(), (rows) => {
    expect(rows).toHaveLength(0);
  });
}

async function assertRejectedEmpty2(): Promise<void> {
  const emptyTool: IContent = {
    speaker: 'tool',
    blocks: [],
  };
  service.add(emptyTool);
  expect(service.length()).toBe(0);

  await collectRowsForAssertions(service.streamRawHistory(), (rows) => {
    expect(rows).toHaveLength(0);
  });
}

describe('issue #2410 – HistoryService rejects zero-block turns', () => {
  beforeEach(() => {
    service = new HistoryService();
  });
  it('refuses to store a zero-block human turn', async () => {
    expect(service.length()).toBe(0);
    await assertRejectedEmpty0();
  });

  it('refuses to store a zero-block AI turn', async () => {
    expect(service.length()).toBe(0);
    await assertRejectedEmpty1();
  });

  it('refuses to store a zero-block tool turn', async () => {
    expect(service.length()).toBe(0);
    await assertRejectedEmpty2();
  });

  it('still stores a valid human message with one block', async () => {
    const validHuman: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'hello' }],
    };
    service.add(validHuman);
    expect(service.length()).toBe(1);

    await collectRowsForAssertions(service.streamRawHistory(), (rows) => {
      expect(rows).toHaveLength(1);
    });
  });

  it('still stores a valid AI message with one block', async () => {
    const validAI: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'response' }],
    };
    service.add(validAI);
    expect(service.length()).toBe(1);

    await collectRowsForAssertions(service.streamRawHistory(), (rows) => {
      expect(rows).toHaveLength(1);
    });
  });

  it('does not emit contentAdded for rejected zero-block content', () => {
    let emitted = false;
    service.on('contentAdded', () => {
      emitted = true;
    });
    const emptyHuman: IContent = {
      speaker: 'human',
      blocks: [],
    };
    service.add(emptyHuman);
    expect(emitted).toBe(false);
  });

  it('emits contentAdded for valid content', () => {
    let emitted = false;
    service.on('contentAdded', () => {
      emitted = true;
    });
    service.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'hello' }],
    });
    expect(emitted).toBe(true);
  });

  it('still rejects invalid speaker (pre-existing behavior)', async () => {
    const badSpeaker: IContent = {
      speaker: 'invalid' as IContent['speaker'],
      blocks: [{ type: 'text', text: 'hello' }],
    };
    service.add(badSpeaker);
    expect(service.length()).toBe(0);

    await collectRowsForAssertions(service.streamRawHistory(), (rows) => {
      expect(rows).toHaveLength(0);
    });
  });
});
