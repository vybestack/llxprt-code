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

import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

describe('issue #2410 – HistoryService rejects zero-block turns', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  it('refuses to store a zero-block human turn', () => {
    const emptyHuman: IContent = {
      speaker: 'human',
      blocks: [],
    };
    service.add(emptyHuman);
    expect(service.getAll()).toHaveLength(0);
  });

  it('refuses to store a zero-block AI turn', () => {
    const emptyAI: IContent = {
      speaker: 'ai',
      blocks: [],
    };
    service.add(emptyAI);
    expect(service.getAll()).toHaveLength(0);
  });

  it('refuses to store a zero-block tool turn', () => {
    const emptyTool: IContent = {
      speaker: 'tool',
      blocks: [],
    };
    service.add(emptyTool);
    expect(service.getAll()).toHaveLength(0);
  });

  it('still stores a valid human message with one block', () => {
    const validHuman: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'hello' }],
    };
    service.add(validHuman);
    expect(service.getAll()).toHaveLength(1);
  });

  it('still stores a valid AI message with one block', () => {
    const validAI: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'response' }],
    };
    service.add(validAI);
    expect(service.getAll()).toHaveLength(1);
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

  it('still rejects invalid speaker (pre-existing behavior)', () => {
    const badSpeaker: IContent = {
      speaker: 'invalid' as IContent['speaker'],
      blocks: [{ type: 'text', text: 'hello' }],
    };
    service.add(badSpeaker);
    expect(service.getAll()).toHaveLength(0);
  });
});
