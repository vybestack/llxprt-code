/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CheckAsyncTasksTool,
  ShellTool,
  type AnyDeclarativeTool,
  type ToolExecutionPolicy,
  type ToolLookup,
  type ToolSelection,
} from '@vybestack/llxprt-code-tools';
import { AsyncWorkFacade } from '@vybestack/llxprt-code-core/services/asyncWorkFacade.js';
import { CoreAsyncTaskServiceAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreAsyncTaskServiceAdapter.js';
import type { TaskLaunchOwner } from './task-launch-owner.js';
import type { ShellJobOwner } from './shell-job-owner.js';
import { TaskTool } from '../tools/task.js';
import type { ChildToolDisplay } from './childToolDisplay.js';
import type { SchedulerConstruction } from './assembleSchedulerOwner.js';

/**
 * Gives one child agent a view of the inherited tools in which the shell tool
 * reads its execution settings (inactivity window, timeouts, output limits)
 * from the child's own policy. Without it a child's shell commands run with
 * the settings of the session that owns the shared shell tool, so a value set
 * in the subagent's profile would never apply to them.
 */
export function bindChildExecutionPolicy(
  tools: ToolSelection,
  readChildPolicy: () => ToolExecutionPolicy,
): ToolSelection {
  const scope = (tool: AnyDeclarativeTool): AnyDeclarativeTool =>
    tool instanceof ShellTool
      ? tool.withExecutionPolicy(readChildPolicy)
      : tool;
  return {
    getTool: (...args) => {
      const tool = tools.getTool(...args);
      return tool === undefined ? undefined : scope(tool);
    },
    getAllToolNames: () => tools.getAllToolNames(),
    getAllTools: () => tools.getAllTools().map(scope),
    getEnabledTools: () => tools.getEnabledTools().map(scope),
    getFunctionDeclarations: () => tools.getFunctionDeclarations(),
    getFunctionDeclarationsFiltered: (names) =>
      tools.getFunctionDeclarationsFiltered(names),
  };
}

export function bindChildToolRegistry<T extends ToolLookup>(
  registry: T,
  display: ChildToolDisplay,
  taskLaunchOwner: TaskLaunchOwner | undefined,
  shellOwner: ShellJobOwner,
): T {
  const view = new Proxy(registry, {
    get(target: T, key: string | symbol): unknown {
      if (key === 'getTool') {
        return (...args: Parameters<ToolLookup['getTool']>) => {
          const tool = target.getTool(...args);
          if (tool instanceof CheckAsyncTasksTool && taskLaunchOwner) {
            return tool.withAsyncTaskService(
              new CoreAsyncTaskServiceAdapter(
                new AsyncWorkFacade(taskLaunchOwner, () =>
                  shellOwner.current(),
                ),
              ),
            );
          }
          if (tool instanceof ShellTool) {
            return tool.withBackgroundJobs({
              launchBackgroundJob: (input) => shellOwner.launch(input),
              tailBackgroundJob: (id) =>
                shellOwner.current()?.tailOutput(id) ?? {
                  id,
                  output: '',
                  truncated: false,
                },
            });
          }
          return tool instanceof TaskTool
            ? tool.withChildDisplay(() => display.open(), taskLaunchOwner)
            : tool;
        };
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return view;
}

export function withChildToolDisplay(
  construct: SchedulerConstruction,
  display: ChildToolDisplay,
  taskLaunchOwner: TaskLaunchOwner | undefined,
  shellOwner: ShellJobOwner,
): SchedulerConstruction {
  return (options) =>
    construct({
      ...options,
      toolRegistry: bindChildToolRegistry(
        options.toolRegistry,
        display,
        taskLaunchOwner,
        shellOwner,
      ),
    });
}
