/**
 * @plan:PLAN-20260608-ISSUE1585.P10
 * @requirement:REQ-BEHAVIORAL-TDD
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Subagent Tools Behavioral Tests
 *
 * Verifies observable behavior of Task/ListSubagents/CheckAsyncTasks
 * through ISubagentService and IAsyncTaskService adapters. Primary
 * assertions are on ToolResult content, not method call counts.
 *
 * STATUS: RED — Tests compile but will fail at runtime until P11
 * moves real tool code and adapters are wired up.
 */

import { describe, it, expect } from 'vitest';
import { CheckAsyncTasksTool, ListSubagentsTool, TaskTool } from '../index.js';
import type {
  ISubagentService,
  IAsyncTaskService,
  SubagentResult,
  SubagentInfo,
  AsyncTaskInfo,
} from '../interfaces/index.js';
import { executeToolForBehavioralAssertion } from './red-test-helpers.js';

/**
 * Fake ISubagentService with controllable subagent results.
 */
function createFakeSubagentService(
  agents: SubagentInfo[] = [],
): ISubagentService {
  return {
    executeSubagent: async (request) => {
      const agent = agents.find((a) => a.name === request.name);
      if (agent) {
        return {
          output: `Subagent ${request.name} executed: ${request.prompt}`,
          success: true,
        } satisfies SubagentResult;
      }
      return {
        output: '',
        success: false,
        error: `Unknown subagent: ${request.name}`,
      } satisfies SubagentResult;
    },
    listSubagents: () => agents,
    getSubagentConfig: (name: string) => {
      const agent = agents.find((a) => a.name === name);
      if (agent) {
        return {
          name: agent.name,
          instructions: `Instructions for ${agent.name}`,
        };
      }
      return undefined;
    },
  };
}

/**
 * Fake IAsyncTaskService with controllable task statuses.
 */
function createFakeAsyncTaskService(
  tasks: AsyncTaskInfo[] = [],
): IAsyncTaskService {
  return {
    checkAsyncTask: async (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      return task?.status ?? 'failed';
    },
    getTaskStatus: () => tasks,
    getTask: (taskId: string) => tasks.find((t) => t.id === taskId),
    getTaskByPrefix: (prefix: string) => {
      const candidates = tasks.filter((t) => t.id.startsWith(prefix));
      return candidates.length === 1
        ? { task: candidates[0], candidates }
        : { task: undefined, candidates };
    },
  };
}

describe('Subagent Tools Behavioral Tests @plan:PLAN-20260608-ISSUE1585.P10', () => {
  describe('TaskTool executes through ISubagentService and returns ToolResult', () => {
    it('executeSubagent returns result with correct content', async () => {
      const agents: SubagentInfo[] = [
        { name: 'typescript-expert', description: 'TS expert' },
      ];
      const service = createFakeSubagentService(agents);

      const result = await executeToolForBehavioralAssertion(
        new TaskTool(service),
        { name: 'typescript-expert', prompt: 'Fix this bug' },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('typescript-expert');
      expect(result.llmContent).toContain('Fix this bug');
    });

    it('executeSubagent returns error for unknown agent', async () => {
      const service = createFakeSubagentService([]);

      const result = await executeToolForBehavioralAssertion(
        new TaskTool(service),
        { name: 'unknown-agent', prompt: 'Do something' },
      );

      expect(result.error?.message).toContain('Unknown subagent');
      expect(result.llmContent).toContain('unknown-agent');
    });
  });

  describe('ListSubagentsTool lists available subagents', () => {
    it('listSubagents returns agent list in ToolResult', async () => {
      const agents: SubagentInfo[] = [
        { name: 'typescript-expert', description: 'TS expert' },
        { name: 'deep-thinker', description: 'Think deeply' },
      ];
      const service = createFakeSubagentService(agents);

      const result = await executeToolForBehavioralAssertion(
        new ListSubagentsTool(service),
        {},
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('typescript-expert');
      expect(result.llmContent).toContain('deep-thinker');
    });

    it('empty list when no subagents available', async () => {
      const service = createFakeSubagentService([]);
      const result = await executeToolForBehavioralAssertion(
        new ListSubagentsTool(service),
        {},
      );
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('No subagents');
    });
  });

  describe('CheckAsyncTasksTool checks task status through IAsyncTaskService', () => {
    it('checkAsyncTask returns correct status for known task', async () => {
      const tasks: AsyncTaskInfo[] = [
        { id: 'task-1', name: 'Build', status: 'completed' },
        { id: 'task-2', name: 'Test', status: 'running' },
      ];
      const service = createFakeAsyncTaskService(tasks);

      const result = await executeToolForBehavioralAssertion(
        new CheckAsyncTasksTool(service),
        { task_id: 'task-1' },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('completed');
    });

    it('getTaskStatus returns all task statuses in ToolResult', async () => {
      const tasks: AsyncTaskInfo[] = [
        { id: 'task-1', name: 'Build', status: 'completed' },
        { id: 'task-2', name: 'Test', status: 'running' },
      ];
      const service = createFakeAsyncTaskService(tasks);

      const result = await executeToolForBehavioralAssertion(
        new CheckAsyncTasksTool(service),
        {},
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('task-1');
      expect(result.llmContent).toContain('running');
    });

    it('checkAsyncTask returns failed for unknown task', async () => {
      const service = createFakeAsyncTaskService([]);

      const result = await executeToolForBehavioralAssertion(
        new CheckAsyncTasksTool(service),
        { task_id: 'unknown-task' },
      );

      expect(result.error?.message).toContain('Task not found');
      expect(result.llmContent).toContain('unknown-task');
    });
  });
});
