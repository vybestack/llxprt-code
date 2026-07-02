/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests: TodoWrite emoji filtering with real EmojiFilter.
 * Assertions target observable store/output behavior only.
 */

import { describe, it, expect } from 'vitest';
import { TodoPauseTool, TodoWriteTool, TodoReadTool } from '../index.js';
import type { ITodoService, TodoStore } from '../interfaces/index.js';
import type { Todo } from '../types/todo-schemas.js';
import { executeToolForBehavioralAssertion } from './red-test-helpers.js';

const CHECK_MARK_EMOJI = '✅';
const MEMO_EMOJI = '📝';
const ROCKET_EMOJI = '🚀';
const STAR_EMOJI = '⭐';

const EMOJI_TODO_ITEM = CHECK_MARK_EMOJI + ' Fix the bug in parser';
const EMOJI_SUBTASK_ITEM = MEMO_EMOJI + ' Write unit tests';
const CLEAN_TODO_ITEM = '[OK] Fix the bug in parser';
// 📝 is decorative-only, gets stripped entirely
const CLEAN_SUBTASK_ITEM = ' Write unit tests';

/**
 * Minimal IToolHost stub. Only provides what TodoWrite needs.
 */
function createToolHostWithEmojiMode(mode: string) {
  return {
    getTargetDir: () => '/tmp',
    getWorkspaceRoots: () => [],
    getApprovalMode: () => 'default' as const,
    setApprovalMode: () => {},
    isInteractive: () => false,
    hasFeatureFlag: () => false,
    getFileService: () => ({
      shouldGitIgnoreFile: () => false,
      shouldLlxprtIgnoreFile: () => false,
      shouldIgnoreFile: () => false,
      filterFiles: (paths: string[]) => paths,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getFileFilteringRespectLlxprtIgnore: () => true,
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    getLlxprtIgnorePatterns: () => [],
    getEphemeralSettings: () => ({ emojifilter: mode }),
    getDebugMode: () => false,
  };
}

function createToolHostWithEmptySettings() {
  const host = createToolHostWithEmojiMode('');
  host.getEphemeralSettings = () => ({});
  return host;
}

function createFakeTodoService(
  initialTodos: Todo[] = [],
): ITodoService & { getStoredTodos: () => Todo[] } {
  let todos = [...initialTodos];

  const store: TodoStore = {
    getTodos: () => todos,
    setTodos: (newTodos: Todo[]) => {
      todos = [...newTodos];
    },
  };

  return {
    getTodoStore: () => store,
    getReminderService: () => ({
      shouldGenerateReminder: () => false,
      getReminderForStateChange: () => undefined,
    }),
    getContextTracker: () => ({
      setActiveTodo: () => {},
    }),
    getDefaultAgentId: () => 'test-agent',
    getStoredTodos: () => todos,
  };
}

describe('TodoWrite Emoji Filtering Behavioral Tests', () => {
  describe('auto mode: silently filters emojis from todo content', () => {
    it('filters emojis from todo content before storing', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('auto');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: EMOJI_TODO_ITEM, status: 'pending' }],
      });

      expect(result.error).toBeUndefined();
      const stored = service.getStoredTodos();
      expect(stored[0].content).not.toBe(EMOJI_TODO_ITEM);
      expect(stored[0].content).toBe(CLEAN_TODO_ITEM);
      expect(result.llmContent).toContain(CLEAN_TODO_ITEM);
    });

    it('filters emojis from subtask content before storing', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('auto');
      const tool = new TodoWriteTool(service, host);

      await executeToolForBehavioralAssertion(tool, {
        todos: [
          {
            id: '1',
            content: EMOJI_TODO_ITEM,
            status: 'pending',
            subtasks: [{ id: '1-1', content: EMOJI_SUBTASK_ITEM }],
          },
        ],
      });

      const stored = service.getStoredTodos();
      const subtask = stored[0].subtasks;
      expect(subtask).toBeDefined();
      if (!subtask) return;
      expect(subtask[0].content).toBe(CLEAN_SUBTASK_ITEM);
    });

    it('auto mode does not include warning feedback in output', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('auto');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: EMOJI_TODO_ITEM, status: 'pending' }],
      });

      expect(result.error).toBeUndefined();
      expect(result.llmContent).not.toContain('system-reminder');
      expect(result.llmContent).not.toContain('avoid using emojis');
    });
  });

  describe('warn mode: filters emojis and surfaces warning feedback', () => {
    it('filters emojis from stored content', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('warn');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: EMOJI_TODO_ITEM, status: 'pending' }],
      });

      expect(result.error).toBeUndefined();
      const stored = service.getStoredTodos();
      expect(stored[0].content).toBe(CLEAN_TODO_ITEM);
    });

    it('includes warning feedback in ToolResult output', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('warn');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: EMOJI_TODO_ITEM, status: 'pending' }],
      });

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('system-reminder');
      expect(result.llmContent).toContain('avoid using emojis');
    });

    it('filters emojis from subtask content too', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('warn');
      const tool = new TodoWriteTool(service, host);

      await executeToolForBehavioralAssertion(tool, {
        todos: [
          {
            id: '1',
            content: 'Task without emoji',
            status: 'pending',
            subtasks: [{ id: '1-1', content: EMOJI_SUBTASK_ITEM }],
          },
        ],
      });

      const stored = service.getStoredTodos();
      const subtask = stored[0].subtasks;
      if (!subtask) throw new Error('Expected subtasks');
      expect(subtask[0].content).toBe(CLEAN_SUBTASK_ITEM);
    });
  });

  describe('error mode: rejects todo_write with ToolResult.error', () => {
    it('returns ToolResult.error when emojis detected', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('error');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: EMOJI_TODO_ITEM, status: 'pending' }],
      });

      expect(result.error).toBeDefined();
      if (!result.error) throw new Error('Expected error');
      expect(result.error.message.toLowerCase()).toContain('emoji');
    });

    it('does not store emoji content in error mode', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('error');
      const tool = new TodoWriteTool(service, host);

      await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: EMOJI_TODO_ITEM, status: 'pending' }],
      });

      const stored = service.getStoredTodos();
      expect(stored.length).toBe(0);
    });

    it('succeeds when no emojis are present', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('error');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [
          { id: '1', content: 'Fix the bug in parser', status: 'pending' },
        ],
      });

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Fix the bug in parser');
    });

    it('rejects when subtask has emoji', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('error');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [
          {
            id: '1',
            content: 'Clean task',
            status: 'pending',
            subtasks: [{ id: '1-1', content: EMOJI_SUBTASK_ITEM }],
          },
        ],
      });

      expect(result.error).toBeDefined();
    });
  });

  describe('allowed mode: leaves emoji content intact', () => {
    it('stores content with emojis unchanged', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('allowed');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: EMOJI_TODO_ITEM, status: 'pending' }],
      });

      expect(result.error).toBeUndefined();
      const stored = service.getStoredTodos();
      expect(stored[0].content).toBe(EMOJI_TODO_ITEM);
      expect(result.llmContent).toContain(EMOJI_TODO_ITEM);
    });

    it('leaves subtask emojis intact', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('allowed');
      const tool = new TodoWriteTool(service, host);

      await executeToolForBehavioralAssertion(tool, {
        todos: [
          {
            id: '1',
            content: EMOJI_TODO_ITEM,
            status: 'pending',
            subtasks: [{ id: '1-1', content: EMOJI_SUBTASK_ITEM }],
          },
        ],
      });

      const stored = service.getStoredTodos();
      const subtask = stored[0].subtasks;
      if (!subtask) throw new Error('Expected subtasks');
      expect(subtask[0].content).toBe(EMOJI_SUBTASK_ITEM);
    });

    it('does not include any system feedback', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('allowed');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: EMOJI_TODO_ITEM, status: 'pending' }],
      });

      expect(result.llmContent).not.toContain('system-reminder');
    });
  });

  describe('round-trip: write with filter then read back', () => {
    it('auto mode: read returns filtered content after write', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('auto');
      const writeTool = new TodoWriteTool(service, host);
      const readTool = new TodoReadTool(service);

      await executeToolForBehavioralAssertion(writeTool, {
        todos: [{ id: '1', content: EMOJI_TODO_ITEM, status: 'pending' }],
      });

      const readResult = await executeToolForBehavioralAssertion(readTool, {});
      expect(readResult.llmContent).toContain(CLEAN_TODO_ITEM);
      expect(readResult.llmContent).not.toContain(CHECK_MARK_EMOJI);
    });
  });

  describe('no host: backward compatibility when no host provided', () => {
    it('still works without a host (no emoji filtering)', async () => {
      const service = createFakeTodoService();
      const tool = new TodoWriteTool(service);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: EMOJI_TODO_ITEM, status: 'pending' }],
      });

      expect(result.error).toBeUndefined();
      const stored = service.getStoredTodos();
      expect(stored[0].content).toBe(EMOJI_TODO_ITEM);
    });
  });

  describe('edge cases', () => {
    it('auto mode filters multiple different emojis in a single todo', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('auto');
      const tool = new TodoWriteTool(service, host);

      const multiEmojiContent =
        CHECK_MARK_EMOJI + ' ' + STAR_EMOJI + ' Fix bugs and ship';
      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: multiEmojiContent, status: 'pending' }],
      });

      expect(result.error).toBeUndefined();
      const stored = service.getStoredTodos();
      expect(stored[0].content).not.toContain(CHECK_MARK_EMOJI);
      expect(stored[0].content).not.toContain(STAR_EMOJI);
      expect(stored[0].content).toContain('[OK]');
      expect(stored[0].content).toContain('[STAR]');
      expect(stored[0].content).toContain('Fix bugs and ship');
    });

    it('warn mode does not add feedback when no emojis present', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('warn');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [
          { id: '1', content: 'Clean task without emojis', status: 'pending' },
        ],
      });

      expect(result.error).toBeUndefined();
      expect(result.llmContent).not.toContain('system-reminder');
      expect(result.llmContent).not.toContain('avoid using emojis');
      expect(result.llmContent).toContain('Clean task without emojis');
    });

    it('auto mode leaves clean content unchanged', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('auto');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: 'No emojis here', status: 'pending' }],
      });

      expect(result.error).toBeUndefined();
      const stored = service.getStoredTodos();
      expect(stored[0].content).toBe('No emojis here');
    });

    it('returnDisplay does not contain system-reminder in warn mode', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('warn');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: EMOJI_TODO_ITEM, status: 'pending' }],
      });

      expect(result.error).toBeUndefined();
      expect(typeof result.returnDisplay).toBe('string');
      if (typeof result.returnDisplay !== 'string') return;
      expect(result.returnDisplay).not.toContain('system-reminder');
      expect(result.returnDisplay).toContain(CLEAN_TODO_ITEM);
    });
  });

  describe('warn mode: subtask-only emoji propagates feedback', () => {
    it('parent todo clean, subtask has emoji, warn mode filters and llmContent includes warning', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('warn');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [
          {
            id: '1',
            content: 'Clean parent task',
            status: 'pending',
            subtasks: [{ id: '1-1', content: EMOJI_SUBTASK_ITEM }],
          },
        ],
      });

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('system-reminder');
      expect(result.llmContent).toContain('avoid using emojis');

      const stored = service.getStoredTodos();
      const parent = stored[0];
      expect(parent.content).toBe('Clean parent task');
      const subtasks = parent.subtasks;
      expect(subtasks).toBeDefined();
      if (!subtasks) return;
      expect(subtasks[0].content).toBe(CLEAN_SUBTASK_ITEM);
    });
  });

  describe('host returning {}: defaults to auto and silently filters', () => {
    it('filters emoji content when ephemeral settings is an empty object', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmptySettings();
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: EMOJI_TODO_ITEM, status: 'pending' }],
      });

      expect(result.error).toBeUndefined();
      const stored = service.getStoredTodos();
      expect(stored[0].content).toBe(CLEAN_TODO_ITEM);
      expect(result.llmContent).not.toContain('system-reminder');
    });
  });

  describe('constructor wiring: TodoWrite receives host adapter', () => {
    it('constructs with host adapter and filters emoji content at runtime', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('error');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: EMOJI_TODO_ITEM, status: 'pending' }],
      });

      expect(result.error).toBeDefined();
      expect(service.getStoredTodos().length).toBe(0);
    });

    it('constructs without host and passes emojis through', async () => {
      const service = createFakeTodoService();
      const tool = new TodoWriteTool(service);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: EMOJI_TODO_ITEM, status: 'pending' }],
      });

      expect(result.error).toBeUndefined();
      expect(service.getStoredTodos()[0].content).toBe(EMOJI_TODO_ITEM);
    });

    describe('subtasks property preservation', () => {
      it('todo without subtasks has no own subtasks property after processing', async () => {
        const service = createFakeTodoService();
        const host = createToolHostWithEmojiMode('auto');
        const tool = new TodoWriteTool(service, host);

        await executeToolForBehavioralAssertion(tool, {
          todos: [{ id: '1', content: 'Plain task', status: 'pending' }],
        });

        const stored = service.getStoredTodos();
        expect(stored.length).toBe(1);
        expect(stored[0].content).toBe('Plain task');
        expect(
          Object.prototype.hasOwnProperty.call(stored[0], 'subtasks'),
        ).toBe(false);
      });

      it('todo with subtasks retains subtasks own property', async () => {
        const service = createFakeTodoService();
        const host = createToolHostWithEmojiMode('auto');
        const tool = new TodoWriteTool(service, host);

        await executeToolForBehavioralAssertion(tool, {
          todos: [
            {
              id: '1',
              content: 'Parent task',
              status: 'pending',
              subtasks: [{ id: '1-1', content: 'Child task' }],
            },
          ],
        });

        const stored = service.getStoredTodos();
        const subtasks = stored[0].subtasks;
        expect(subtasks).toBeDefined();
        if (!subtasks) return;
        expect(subtasks.length).toBe(1);
        expect(subtasks[0].content).toBe('Child task');
      });

      it('todo without subtasks has no own subtasks property in warn mode', async () => {
        const service = createFakeTodoService();
        const host = createToolHostWithEmojiMode('warn');
        const tool = new TodoWriteTool(service, host);

        await executeToolForBehavioralAssertion(tool, {
          todos: [{ id: '1', content: EMOJI_TODO_ITEM, status: 'pending' }],
        });

        const stored = service.getStoredTodos();
        expect(
          Object.prototype.hasOwnProperty.call(stored[0], 'subtasks'),
        ).toBe(false);
      });
    });

    describe('warn feedback deduplication', () => {
      it('multiple emoji fields produce a single deduplicated warning message', async () => {
        const service = createFakeTodoService();
        const host = createToolHostWithEmojiMode('warn');
        const tool = new TodoWriteTool(service, host);

        const result = await executeToolForBehavioralAssertion(tool, {
          todos: [
            {
              id: '1',
              content: EMOJI_TODO_ITEM,
              status: 'pending',
              subtasks: [{ id: '1-1', content: EMOJI_SUBTASK_ITEM }],
            },
            {
              id: '2',
              content: CHECK_MARK_EMOJI + ' Second task',
              status: 'pending',
              subtasks: [
                { id: '2-1', content: MEMO_EMOJI + ' Another subtask' },
              ],
            },
          ],
        });

        expect(result.error).toBeUndefined();
        expect(result.llmContent).toContain('system-reminder');
        expect(result.llmContent).toContain('avoid using emojis');

        const feedbackPattern = /avoid using emojis/g;
        const matches = result.llmContent.match(feedbackPattern);
        expect(matches).not.toBeNull();
        if (matches === null) return;
        expect(matches.length).toBe(1);
      });
    });

    describe('toolCalls.parameters scope: content filtered, parameters structurally preserved', () => {
      it('auto mode filters emoji in content and subtask content but preserves toolCalls parameters', async () => {
        const service = createFakeTodoService();
        const host = createToolHostWithEmojiMode('auto');
        const tool = new TodoWriteTool(service, host);

        await executeToolForBehavioralAssertion(tool, {
          todos: [
            {
              id: '1',
              content: CHECK_MARK_EMOJI + ' Task with tool calls',
              status: 'pending',
              subtasks: [
                {
                  id: '1-1',
                  content: MEMO_EMOJI + ' Subtask with tool call',
                  toolCalls: [
                    {
                      id: 'tc-1',
                      name: 'write_file',
                      parameters: {
                        file_path: '/some/path',
                        content: CHECK_MARK_EMOJI + ' emoji in params',
                        description: STAR_EMOJI + ' emoji in description',
                      },
                      timestamp: new Date(),
                    },
                  ],
                },
              ],
            },
          ],
        });

        const stored = service.getStoredTodos();
        expect(stored[0].content).not.toContain(CHECK_MARK_EMOJI);
        expect(stored[0].content).toContain('[OK]');
        const subtasks = stored[0].subtasks;
        expect(subtasks).toBeDefined();
        if (!subtasks) return;
        const subtask = subtasks[0];
        expect(subtask.content).not.toContain(MEMO_EMOJI);
        const toolCalls = subtask.toolCalls;
        expect(toolCalls).toBeDefined();
        if (!toolCalls) return;
        expect(toolCalls[0].name).toBe('write_file');
        expect(toolCalls[0].parameters.file_path).toBe('/some/path');
        expect(toolCalls[0].parameters.content).toBe(
          CHECK_MARK_EMOJI + ' emoji in params',
        );
        expect(toolCalls[0].parameters.description).toBe(
          STAR_EMOJI + ' emoji in description',
        );
      });

      it('warn mode filters content but preserves toolCalls parameters intact', async () => {
        const service = createFakeTodoService();
        const host = createToolHostWithEmojiMode('warn');
        const tool = new TodoWriteTool(service, host);

        const result = await executeToolForBehavioralAssertion(tool, {
          todos: [
            {
              id: '1',
              content: 'Clean task',
              status: 'pending',
              subtasks: [
                {
                  id: '1-1',
                  content: CHECK_MARK_EMOJI + ' Subtask',
                  toolCalls: [
                    {
                      id: 'tc-1',
                      name: 'shell',
                      parameters: { command: 'echo ' + ROCKET_EMOJI },
                      timestamp: new Date(),
                    },
                  ],
                },
              ],
            },
          ],
        });

        expect(result.error).toBeUndefined();
        const stored = service.getStoredTodos();
        const subtasks = stored[0].subtasks;
        expect(subtasks).toBeDefined();
        if (!subtasks) return;
        const subtask = subtasks[0];
        expect(subtask.content).not.toContain(CHECK_MARK_EMOJI);
        const toolCalls = subtask.toolCalls;
        expect(toolCalls).toBeDefined();
        if (!toolCalls) return;
        expect(toolCalls[0].parameters.command).toBe('echo ' + ROCKET_EMOJI);
      });

      it('error mode does not block based on emoji in toolCalls parameters', async () => {
        const service = createFakeTodoService();
        const host = createToolHostWithEmojiMode('error');
        const tool = new TodoWriteTool(service, host);

        const result = await executeToolForBehavioralAssertion(tool, {
          todos: [
            {
              id: '1',
              content: 'Clean task',
              status: 'pending',
              subtasks: [
                {
                  id: '1-1',
                  content: 'Clean subtask',
                  toolCalls: [
                    {
                      id: 'tc-1',
                      name: 'shell',
                      parameters: { command: 'echo ' + ROCKET_EMOJI },
                      timestamp: new Date(),
                    },
                  ],
                },
              ],
            },
          ],
        });

        expect(result.error).toBeUndefined();
        const stored = service.getStoredTodos();
        expect(stored.length).toBe(1);
        const subtasks = stored[0].subtasks;
        expect(subtasks).toBeDefined();
        if (!subtasks) return;
        const toolCalls = subtasks[0].toolCalls;
        expect(toolCalls).toBeDefined();
        if (!toolCalls) return;
        expect(toolCalls[0].parameters.command).toBe('echo ' + ROCKET_EMOJI);
      });
    });
  });

  describe('decorative-only emoji content: revalidation catches empty content after filtering', () => {
    it('auto mode returns error when todo content is decorative-only emoji', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('auto');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: ROCKET_EMOJI, status: 'pending' }],
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain(
        'Emoji filtering produced invalid todo content',
      );
      expect(service.getStoredTodos().length).toBe(0);
    });

    it('warn mode returns error when todo content is decorative-only emoji', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('warn');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [{ id: '1', content: ROCKET_EMOJI, status: 'pending' }],
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain(
        'Emoji filtering produced invalid todo content',
      );
      expect(service.getStoredTodos().length).toBe(0);
    });

    it('auto mode returns error when subtask content is decorative-only emoji', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('auto');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [
          {
            id: '1',
            content: 'Valid parent task',
            status: 'pending',
            subtasks: [{ id: '1-1', content: MEMO_EMOJI }],
          },
        ],
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain(
        'Emoji filtering produced invalid todo content',
      );
      expect(service.getStoredTodos().length).toBe(0);
    });

    it('warn mode returns error when subtask content is decorative-only emoji', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('warn');
      const tool = new TodoWriteTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        todos: [
          {
            id: '1',
            content: 'Valid parent task',
            status: 'pending',
            subtasks: [{ id: '1-1', content: ROCKET_EMOJI }],
          },
        ],
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain(
        'Emoji filtering produced invalid todo content',
      );
      expect(service.getStoredTodos().length).toBe(0);
    });
  });

  describe('TodoPause reason filtering', () => {
    it('auto mode filters emojis from pause reason display and LLM content', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('auto');
      const tool = new TodoPauseTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        reason: 'Blocked by ' + CHECK_MARK_EMOJI + ' sample placeholder',
      });

      expect(result.error).toBeUndefined();
      expect(result.returnDisplay).toContain('[OK] sample placeholder');
      expect(result.returnDisplay).not.toContain(CHECK_MARK_EMOJI);
      expect(result.llmContent).not.toContain(CHECK_MARK_EMOJI);
    });

    it('auto mode filters emojis from pause tool description', () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('auto');
      const tool = new TodoPauseTool(service, host);

      const description = tool.getDescription({
        reason: 'Blocked by ' + CHECK_MARK_EMOJI + ' sample placeholder',
      });

      expect(description).toContain('[OK] sample placeholder');
      expect(description).not.toContain(CHECK_MARK_EMOJI);
    });

    it('auto mode describes decorative-only pause reason without raw emojis', () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('auto');
      const tool = new TodoPauseTool(service, host);
      const dogSequence = '\u{1F415}\u{1F436}\u{1F415}\u{1F436}';

      const description = tool.getDescription({ reason: dogSequence });

      expect(description).toContain(
        'Pause reason is empty after emoji filtering',
      );
      expect(description).not.toContain(dogSequence);
    });

    it('warn mode filters pause reason and returns warning only in LLM content', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('warn');
      const tool = new TodoPauseTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        reason: 'Blocked by ' + CHECK_MARK_EMOJI + ' sample placeholder',
      });

      expect(result.error).toBeUndefined();
      expect(result.returnDisplay).toContain('[OK] sample placeholder');
      expect(result.returnDisplay).not.toContain('system-reminder');
      expect(result.llmContent).toContain('system-reminder');
      expect(result.llmContent).toContain('avoid using emojis');
    });

    it('error mode blocks pause reason emojis', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('error');
      const tool = new TodoPauseTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        reason: 'Blocked by ' + CHECK_MARK_EMOJI + ' sample placeholder',
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message.toLowerCase()).toContain('emoji');
      expect(result.returnDisplay).not.toContain(CHECK_MARK_EMOJI);
      expect(service.getStoredTodos().length).toBe(0);
    });

    it('allowed mode preserves pause reason emojis', async () => {
      const service = createFakeTodoService();
      const host = createToolHostWithEmojiMode('allowed');
      const tool = new TodoPauseTool(service, host);

      const result = await executeToolForBehavioralAssertion(tool, {
        reason: 'Blocked by ' + CHECK_MARK_EMOJI + ' sample placeholder',
      });

      expect(result.error).toBeUndefined();
      expect(result.returnDisplay).toContain(CHECK_MARK_EMOJI);
      expect(result.llmContent).toContain(CHECK_MARK_EMOJI);
    });
  });
});
