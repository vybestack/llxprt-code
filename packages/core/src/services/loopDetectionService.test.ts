/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Config } from '../config/config.js';
import {
  GeminiEventType,
  ServerGeminiContentEvent,
  ServerGeminiStreamEvent,
  ServerGeminiToolCallRequestEvent,
} from '../core/turn.js';
import * as loggers from '../telemetry/loggers.js';
import { LoopType } from '../telemetry/types.js';
import { LoopDetectionService } from './loopDetectionService.js';

vi.mock('../telemetry/loggers.js', () => ({
  logLoopDetected: vi.fn(),
}));

const DEFAULT_TOOL_CALL_LOOP_THRESHOLD = 50;
const DEFAULT_CONTENT_LOOP_THRESHOLD = 50;
const CONTENT_CHUNK_SIZE = 50;

describe('LoopDetectionService', () => {
  let service: LoopDetectionService;
  let mockConfig: Config;

  beforeEach(() => {
    mockConfig = {
      getTelemetryEnabled: () => true,
      getEphemeralSetting: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;
    service = new LoopDetectionService(mockConfig);
    vi.clearAllMocks();
  });

  const createToolCallRequestEvent = (
    name: string,
    args: Record<string, unknown>,
  ): ServerGeminiToolCallRequestEvent => ({
    type: GeminiEventType.ToolCallRequest,
    value: {
      name,
      args,
      callId: 'test-id',
      isClientInitiated: false,
      prompt_id: 'test-prompt-id',
    },
  });

  const createContentEvent = (content: string): ServerGeminiContentEvent => ({
    type: GeminiEventType.Content,
    value: content,
  });

  const createRepetitiveContent = (id: number, length: number): string => {
    const baseString = `This is a unique sentence, id=${id}. `;
    let content = '';
    while (content.length < length) {
      content += baseString;
    }
    return content.slice(0, length);
  };

  describe('Tool Call Loop Detection', () => {
    it(`should not detect a loop for fewer than DEFAULT_TOOL_CALL_LOOP_THRESHOLD identical calls`, () => {
      const event = createToolCallRequestEvent('testTool', { param: 'value' });
      for (let i = 0; i < DEFAULT_TOOL_CALL_LOOP_THRESHOLD - 1; i++) {
        expect(service.addAndCheck(event)).toBe(false);
      }
      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });

    it(`should detect a loop on the DEFAULT_TOOL_CALL_LOOP_THRESHOLD-th identical call`, () => {
      const event = createToolCallRequestEvent('testTool', { param: 'value' });
      for (let i = 0; i < DEFAULT_TOOL_CALL_LOOP_THRESHOLD - 1; i++) {
        service.addAndCheck(event);
      }
      expect(service.addAndCheck(event)).toBe(true);
      expect(loggers.logLoopDetected).toHaveBeenCalledTimes(1);
    });

    it('should detect a loop on subsequent identical calls', () => {
      const event = createToolCallRequestEvent('testTool', { param: 'value' });
      for (let i = 0; i < DEFAULT_TOOL_CALL_LOOP_THRESHOLD; i++) {
        service.addAndCheck(event);
      }
      expect(service.addAndCheck(event)).toBe(true);
      expect(loggers.logLoopDetected).toHaveBeenCalledTimes(1);
    });

    it('should not detect a loop for different tool calls', () => {
      const event1 = createToolCallRequestEvent('testTool', {
        param: 'value1',
      });
      const event2 = createToolCallRequestEvent('testTool', {
        param: 'value2',
      });
      const event3 = createToolCallRequestEvent('anotherTool', {
        param: 'value1',
      });

      for (let i = 0; i < DEFAULT_TOOL_CALL_LOOP_THRESHOLD - 2; i++) {
        expect(service.addAndCheck(event1)).toBe(false);
        expect(service.addAndCheck(event2)).toBe(false);
        expect(service.addAndCheck(event3)).toBe(false);
      }
    });

    it('should not reset tool call counter for other event types', () => {
      const toolCallEvent = createToolCallRequestEvent('testTool', {
        param: 'value',
      });
      const otherEvent = {
        type: 'thought',
      } as unknown as ServerGeminiStreamEvent;

      // Send events just below the threshold
      for (let i = 0; i < DEFAULT_TOOL_CALL_LOOP_THRESHOLD - 1; i++) {
        expect(service.addAndCheck(toolCallEvent)).toBe(false);
      }

      // Send a different event type
      expect(service.addAndCheck(otherEvent)).toBe(false);

      // Send the tool call event again, which should now trigger the loop
      expect(service.addAndCheck(toolCallEvent)).toBe(true);
      expect(loggers.logLoopDetected).toHaveBeenCalledTimes(1);
    });
  });

  describe('Content Loop Detection', () => {
    const generateRandomString = (length: number) => {
      let result = '';
      const characters =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const charactersLength = characters.length;
      for (let i = 0; i < length; i++) {
        result += characters.charAt(
          Math.floor(Math.random() * charactersLength),
        );
      }
      return result;
    };

    it('should not detect a loop for random content', () => {
      service.reset('');
      for (let i = 0; i < 1000; i++) {
        const content = generateRandomString(10);
        const isLoop = service.addAndCheck(createContentEvent(content));
        expect(isLoop).toBe(false);
      }
      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });

    it('should detect a loop when a chunk of content repeats consecutively', () => {
      service.reset('');
      const repeatedContent = createRepetitiveContent(1, CONTENT_CHUNK_SIZE);

      let isLoop = false;
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD; i++) {
        isLoop = service.addAndCheck(createContentEvent(repeatedContent));
      }
      expect(isLoop).toBe(true);
      expect(loggers.logLoopDetected).toHaveBeenCalledTimes(1);
    });

    it('should not detect a loop if repetitions are very far apart', () => {
      service.reset('');
      const repeatedContent = createRepetitiveContent(1, CONTENT_CHUNK_SIZE);
      const fillerContent = generateRandomString(500);

      let isLoop = false;
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD; i++) {
        isLoop = service.addAndCheck(createContentEvent(repeatedContent));
        isLoop = service.addAndCheck(createContentEvent(fillerContent));
      }
      expect(isLoop).toBe(false);
      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });

    it('should detect a loop with longer repeating patterns (e.g. ~150 chars)', () => {
      service.reset('');
      const longPattern = createRepetitiveContent(1, 150);
      expect(longPattern.length).toBe(150);

      let isLoop = false;
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD + 2; i++) {
        isLoop = service.addAndCheck(createContentEvent(longPattern));
        if (isLoop) break;
      }
      expect(isLoop).toBe(true);
      expect(loggers.logLoopDetected).toHaveBeenCalledTimes(1);
    });

    it.skip('should detect the specific user-provided loop example', () => {
      service.reset('');
      const userPattern = `I will not output any text.
  I will just end the turn.
  I am done.
  I will not do anything else.
  I will wait for the user's next command.
`;

      let isLoop = false;
      // Loop enough times to trigger the threshold
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD * 10; i++) {
        isLoop = service.addAndCheck(createContentEvent(userPattern));
        if (isLoop) break;
      }
      expect(isLoop).toBe(true);
      expect(loggers.logLoopDetected).toHaveBeenCalledTimes(1);
    });

    it.skip('should detect the second specific user-provided loop example', () => {
      service.reset('');
      const userPattern =
        'I have added all the requested logs and verified the test file. I will now mark the task as complete.\n  ';

      let isLoop = false;
      // Loop enough times to trigger the threshold
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD * 10; i++) {
        isLoop = service.addAndCheck(createContentEvent(userPattern));
        if (isLoop) break;
      }
      expect(isLoop).toBe(true);
      expect(loggers.logLoopDetected).toHaveBeenCalledTimes(1);
    });

    it('should detect a loop of alternating short phrases', () => {
      service.reset('');
      const alternatingPattern = 'Thinking... Done. ';

      let isLoop = false;
      // Needs more iterations because the pattern is short relative to chunk size,
      // so it takes a few slides of the window to find the exact alignment.
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD * 3; i++) {
        isLoop = service.addAndCheck(createContentEvent(alternatingPattern));
        if (isLoop) break;
      }
      expect(isLoop).toBe(true);
      expect(loggers.logLoopDetected).toHaveBeenCalledTimes(1);
    });

    it('should detect a loop of repeated complex thought processes', () => {
      service.reset('');
      const thoughtPattern =
        'I need to check the file. The file does not exist. I will create the file. ';

      let isLoop = false;
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD + 5; i++) {
        isLoop = service.addAndCheck(createContentEvent(thoughtPattern));
        if (isLoop) break;
      }
      expect(isLoop).toBe(true);
      expect(loggers.logLoopDetected).toHaveBeenCalledTimes(1);
    });
  });

  describe('Content Loop Detection with Code Blocks', () => {
    it('should not detect a loop when repetitive content is inside a code block', () => {
      service.reset('');
      const repeatedContent = createRepetitiveContent(1, CONTENT_CHUNK_SIZE);

      service.addAndCheck(createContentEvent('```\n'));

      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD; i++) {
        const isLoop = service.addAndCheck(createContentEvent(repeatedContent));
        expect(isLoop).toBe(false);
      }

      const isLoop = service.addAndCheck(createContentEvent('\n```'));
      expect(isLoop).toBe(false);
      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });

    it('should not detect loops when content transitions into a code block', () => {
      service.reset('');
      const repeatedContent = createRepetitiveContent(1, CONTENT_CHUNK_SIZE);

      // Add some repetitive content outside of code block
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD - 2; i++) {
        service.addAndCheck(createContentEvent(repeatedContent));
      }

      // Now transition into a code block - this should prevent loop detection
      // even though we were already close to the threshold
      const codeBlockStart = '```javascript\n';
      const isLoop = service.addAndCheck(createContentEvent(codeBlockStart));
      expect(isLoop).toBe(false);

      // Continue adding repetitive content inside the code block - should not trigger loop
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD; i++) {
        const isLoopInside = service.addAndCheck(
          createContentEvent(repeatedContent),
        );
        expect(isLoopInside).toBe(false);
      }

      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });

    it('should skip loop detection when already inside a code block (this.inCodeBlock)', () => {
      service.reset('');

      // Start with content that puts us inside a code block
      service.addAndCheck(createContentEvent('Here is some code:\n```\n'));

      // Verify we are now inside a code block and any content should be ignored for loop detection
      const repeatedContent = createRepetitiveContent(1, CONTENT_CHUNK_SIZE);
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD + 5; i++) {
        const isLoop = service.addAndCheck(createContentEvent(repeatedContent));
        expect(isLoop).toBe(false);
      }

      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });

    it('should correctly track inCodeBlock state with multiple fence transitions', () => {
      service.reset('');
      const repeatedContent = createRepetitiveContent(1, CONTENT_CHUNK_SIZE);

      // Outside code block - should track content
      service.addAndCheck(createContentEvent('Normal text '));

      // Enter code block (1 fence) - should stop tracking
      const enterResult = service.addAndCheck(createContentEvent('```\n'));
      expect(enterResult).toBe(false);

      // Inside code block - should not track loops
      for (let i = 0; i < 5; i++) {
        const insideResult = service.addAndCheck(
          createContentEvent(repeatedContent),
        );
        expect(insideResult).toBe(false);
      }

      // Exit code block (2nd fence) - should reset tracking but still return false
      const exitResult = service.addAndCheck(createContentEvent('```\n'));
      expect(exitResult).toBe(false);

      // Enter code block again (3rd fence) - should stop tracking again
      const reenterResult = service.addAndCheck(
        createContentEvent('```python\n'),
      );
      expect(reenterResult).toBe(false);

      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });

    it('should detect a loop when repetitive content is outside a code block', () => {
      service.reset('');
      const repeatedContent = createRepetitiveContent(1, CONTENT_CHUNK_SIZE);

      service.addAndCheck(createContentEvent('```'));
      service.addAndCheck(createContentEvent('\nsome code\n'));
      service.addAndCheck(createContentEvent('```'));

      let isLoop = false;
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD; i++) {
        isLoop = service.addAndCheck(createContentEvent(repeatedContent));
      }
      expect(isLoop).toBe(true);
      expect(loggers.logLoopDetected).toHaveBeenCalledTimes(1);
    });

    it('should handle content with multiple code blocks and no loops', () => {
      service.reset('');
      service.addAndCheck(createContentEvent('```\ncode1\n```'));
      service.addAndCheck(createContentEvent('\nsome text\n'));
      const isLoop = service.addAndCheck(createContentEvent('```\ncode2\n```'));

      expect(isLoop).toBe(false);
      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });

    it('should handle content with mixed code blocks and looping text', () => {
      service.reset('');
      const repeatedContent = createRepetitiveContent(1, CONTENT_CHUNK_SIZE);

      service.addAndCheck(createContentEvent('```'));
      service.addAndCheck(createContentEvent('\ncode1\n'));
      service.addAndCheck(createContentEvent('```'));

      let isLoop = false;
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD; i++) {
        isLoop = service.addAndCheck(createContentEvent(repeatedContent));
      }

      expect(isLoop).toBe(true);
      expect(loggers.logLoopDetected).toHaveBeenCalledTimes(1);
    });

    it('should not detect a loop for a long code block with some repeating tokens', () => {
      service.reset('');
      const repeatingTokens =
        'for (let i = 0; i < 10; i++) { console.log(i); }';

      service.addAndCheck(createContentEvent('```\n'));

      for (let i = 0; i < 20; i++) {
        const isLoop = service.addAndCheck(createContentEvent(repeatingTokens));
        expect(isLoop).toBe(false);
      }

      const isLoop = service.addAndCheck(createContentEvent('\n```'));
      expect(isLoop).toBe(false);
      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });

    it('should reset tracking when a code fence is found', () => {
      service.reset('');
      const repeatedContent = createRepetitiveContent(1, CONTENT_CHUNK_SIZE);

      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD - 1; i++) {
        service.addAndCheck(createContentEvent(repeatedContent));
      }

      // This should not trigger a loop because of the reset
      service.addAndCheck(createContentEvent('```'));

      // We are now in a code block, so loop detection should be off.
      // Let's add the repeated content again, it should not trigger a loop.
      let isLoop = false;
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD; i++) {
        isLoop = service.addAndCheck(createContentEvent(repeatedContent));
        expect(isLoop).toBe(false);
      }

      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });
    it('should reset tracking when a table is detected', () => {
      service.reset('');
      const repeatedContent = createRepetitiveContent(1, CONTENT_CHUNK_SIZE);

      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD - 1; i++) {
        service.addAndCheck(createContentEvent(repeatedContent));
      }

      // This should reset tracking and not trigger a loop
      service.addAndCheck(createContentEvent('| Column 1 | Column 2 |'));

      // Add more repeated content after table - should not trigger loop
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD - 1; i++) {
        const isLoop = service.addAndCheck(createContentEvent(repeatedContent));
        expect(isLoop).toBe(false);
      }

      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });

    it('should reset tracking when a list item is detected', () => {
      service.reset('');
      const repeatedContent = createRepetitiveContent(1, CONTENT_CHUNK_SIZE);

      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD - 1; i++) {
        service.addAndCheck(createContentEvent(repeatedContent));
      }

      // This should reset tracking and not trigger a loop
      service.addAndCheck(createContentEvent('* List item'));

      // Add more repeated content after list - should not trigger loop
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD - 1; i++) {
        const isLoop = service.addAndCheck(createContentEvent(repeatedContent));
        expect(isLoop).toBe(false);
      }

      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });

    it('should reset tracking when a heading is detected', () => {
      service.reset('');
      const repeatedContent = createRepetitiveContent(1, CONTENT_CHUNK_SIZE);

      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD - 1; i++) {
        service.addAndCheck(createContentEvent(repeatedContent));
      }

      // This should reset tracking and not trigger a loop
      service.addAndCheck(createContentEvent('## Heading'));

      // Add more repeated content after heading - should not trigger loop
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD - 1; i++) {
        const isLoop = service.addAndCheck(createContentEvent(repeatedContent));
        expect(isLoop).toBe(false);
      }

      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });

    it('should reset tracking when a blockquote is detected', () => {
      service.reset('');
      const repeatedContent = createRepetitiveContent(1, CONTENT_CHUNK_SIZE);

      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD - 1; i++) {
        service.addAndCheck(createContentEvent(repeatedContent));
      }

      // This should reset tracking and not trigger a loop
      service.addAndCheck(createContentEvent('> Quote text'));

      // Add more repeated content after blockquote - should not trigger loop
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD - 1; i++) {
        const isLoop = service.addAndCheck(createContentEvent(repeatedContent));
        expect(isLoop).toBe(false);
      }

      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });

    it('should reset tracking for various list item formats', () => {
      const repeatedContent = createRepetitiveContent(1, CONTENT_CHUNK_SIZE);

      // Test different list formats - make sure they start at beginning of line
      const listFormats = [
        '* Bullet item',
        '- Dash item',
        '+ Plus item',
        '1. Numbered item',
        '42. Another numbered item',
      ];

      listFormats.forEach((listFormat, index) => {
        service.reset('');

        // Build up to near threshold
        for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD - 1; i++) {
          service.addAndCheck(createContentEvent(repeatedContent));
        }

        // Reset should occur with list item - add newline to ensure it starts at beginning
        service.addAndCheck(createContentEvent('\n' + listFormat));

        // Should not trigger loop after reset - use different content to avoid any cached state issues
        const newRepeatedContent = createRepetitiveContent(
          index + 100,
          CONTENT_CHUNK_SIZE,
        );
        for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD - 1; i++) {
          const isLoop = service.addAndCheck(
            createContentEvent(newRepeatedContent),
          );
          expect(isLoop).toBe(false);
        }
      });

      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });

    it('should reset tracking for various table formats', () => {
      const repeatedContent = createRepetitiveContent(1, CONTENT_CHUNK_SIZE);

      const tableFormats = [
        '| Column 1 | Column 2 |',
        '|---|---|',
        '|++|++|',
        '+---+---+',
      ];

      tableFormats.forEach((tableFormat, index) => {
        service.reset('');

        // Build up to near threshold
        for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD - 1; i++) {
          service.addAndCheck(createContentEvent(repeatedContent));
        }

        // Reset should occur with table format - add newline to ensure it starts at beginning
        service.addAndCheck(createContentEvent('\n' + tableFormat));

        // Should not trigger loop after reset - use different content to avoid any cached state issues
        const newRepeatedContent = createRepetitiveContent(
          index + 200,
          CONTENT_CHUNK_SIZE,
        );
        for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD - 1; i++) {
          const isLoop = service.addAndCheck(
            createContentEvent(newRepeatedContent),
          );
          expect(isLoop).toBe(false);
        }
      });

      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });

    it('should reset tracking for various heading levels', () => {
      const repeatedContent = createRepetitiveContent(1, CONTENT_CHUNK_SIZE);

      const headingFormats = [
        '# H1 Heading',
        '## H2 Heading',
        '### H3 Heading',
        '#### H4 Heading',
        '##### H5 Heading',
        '###### H6 Heading',
      ];

      headingFormats.forEach((headingFormat, index) => {
        service.reset('');

        // Build up to near threshold
        for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD - 1; i++) {
          service.addAndCheck(createContentEvent(repeatedContent));
        }

        // Reset should occur with heading - add newline to ensure it starts at beginning
        service.addAndCheck(createContentEvent('\n' + headingFormat));

        // Should not trigger loop after reset - use different content to avoid any cached state issues
        const newRepeatedContent = createRepetitiveContent(
          index + 300,
          CONTENT_CHUNK_SIZE,
        );
        for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD - 1; i++) {
          const isLoop = service.addAndCheck(
            createContentEvent(newRepeatedContent),
          );
          expect(isLoop).toBe(false);
        }
      });

      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty content', () => {
      const event = createContentEvent('');
      expect(service.addAndCheck(event)).toBe(false);
    });
  });

  describe('Divider Content Detection', () => {
    it('should not detect a loop for repeating divider-like content', () => {
      service.reset('');
      const dividerContent = '-'.repeat(CONTENT_CHUNK_SIZE);
      let isLoop = false;
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD + 5; i++) {
        isLoop = service.addAndCheck(createContentEvent(dividerContent));
        expect(isLoop).toBe(false);
      }
      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });

    it('should not detect a loop for repeating complex box-drawing dividers', () => {
      service.reset('');
      const dividerContent = '╭─'.repeat(CONTENT_CHUNK_SIZE / 2);
      let isLoop = false;
      for (let i = 0; i < DEFAULT_CONTENT_LOOP_THRESHOLD + 5; i++) {
        isLoop = service.addAndCheck(createContentEvent(dividerContent));
        expect(isLoop).toBe(false);
      }
      expect(loggers.logLoopDetected).not.toHaveBeenCalled();
    });
  });

  describe('Reset Functionality', () => {
    it('tool call should reset content count', () => {
      const contentEvent = createContentEvent('Some content.');
      const toolEvent = createToolCallRequestEvent('testTool', {
        param: 'value',
      });
      for (let i = 0; i < 9; i++) {
        service.addAndCheck(contentEvent);
      }

      service.addAndCheck(toolEvent);

      // Should start fresh
      expect(service.addAndCheck(createContentEvent('Fresh content.'))).toBe(
        false,
      );
    });
  });

  describe('General Behavior', () => {
    it('should return false for unhandled event types', () => {
      const otherEvent = {
        type: 'unhandled_event',
      } as unknown as ServerGeminiStreamEvent;
      expect(service.addAndCheck(otherEvent)).toBe(false);
      expect(service.addAndCheck(otherEvent)).toBe(false);
    });
  });
});

describe('LoopDetectionService Max Turns Detection', () => {
  let service: LoopDetectionService;
  let mockConfig: Config;
  let abortController: AbortController;

  beforeEach(() => {
    mockConfig = {
      getEphemeralSetting: vi.fn().mockReturnValue(200), // Default max turns
      getDebugMode: () => false,
      getTelemetryEnabled: () => true,
    } as unknown as Config;

    service = new LoopDetectionService(mockConfig);
    service.reset('test-prompt');
    abortController = new AbortController();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const advanceTurns = async (count: number) => {
    for (let i = 0; i < count; i++) {
      await service.turnStarted(abortController.signal);
    }
  };

  it('should detect max turns exceeded when limit is reached', async () => {
    // Set max turns to 50 for testing
    mockConfig.getEphemeralSetting = vi.fn().mockReturnValue(50);

    // Advance to just before the limit
    await advanceTurns(49);
    expect(loggers.logLoopDetected).not.toHaveBeenCalled();

    // One more turn should trigger the limit
    const result = await service.turnStarted(abortController.signal);
    expect(result).toBe(true);
    expect(loggers.logLoopDetected).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({
        'event.name': 'loop_detected',
        loop_type: LoopType.MAX_TURNS_EXCEEDED,
      }),
    );
  });

  it('should not trigger max turns when set to -1 (unlimited)', async () => {
    // Set max turns to -1 for unlimited
    mockConfig.getEphemeralSetting = vi.fn().mockReturnValue(-1);

    // Advance many turns
    await advanceTurns(200);
    const result = await service.turnStarted(abortController.signal);
    expect(result).toBe(false);
    expect(loggers.logLoopDetected).not.toHaveBeenCalled();
  });

  it('should use default value of -1 (unlimited) when setting is undefined', async () => {
    // Return undefined to test default
    mockConfig.getEphemeralSetting = vi.fn().mockReturnValue(undefined);

    // Advance many turns - should not trigger because default is -1 (unlimited)
    await advanceTurns(200);
    const result = await service.turnStarted(abortController.signal);
    expect(result).toBe(false);
    expect(loggers.logLoopDetected).not.toHaveBeenCalled();
  });

  it('should reset turn count when reset() is called', async () => {
    // Set max turns to 10 for testing
    mockConfig.getEphemeralSetting = vi.fn().mockReturnValue(10);

    // Advance 8 turns
    await advanceTurns(8);

    // Reset the service
    service.reset('new-prompt');

    // Should be able to advance 9 more turns without triggering
    await advanceTurns(9);
    expect(loggers.logLoopDetected).not.toHaveBeenCalled();

    // One more should trigger
    const result = await service.turnStarted(abortController.signal);
    expect(result).toBe(true);
  });

  it('should not interfere with other loop detection mechanisms', async () => {
    // Set high max turns so it doesn't trigger, but let other settings use defaults
    mockConfig.getEphemeralSetting = vi
      .fn()
      .mockImplementation((key: string) => {
        if (key === 'maxTurnsPerPrompt') return 1000;
        return undefined; // Use defaults for other settings
      });

    // Trigger a tool call loop instead with default threshold of 50
    const toolCall = { name: 'test_tool', args: { param: 'value' } };
    for (let i = 0; i < DEFAULT_TOOL_CALL_LOOP_THRESHOLD; i++) {
      service.addAndCheck({
        type: GeminiEventType.ToolCallRequest,
        value: toolCall,
      });
    }

    expect(loggers.logLoopDetected).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({
        'event.name': 'loop_detected',
        loop_type: LoopType.CONSECUTIVE_IDENTICAL_TOOL_CALLS,
      }),
    );
  });
});
