/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CheckAsyncTasksTool,
  ShellTool,
  type ToolLookup,
} from '@vybestack/llxprt-code-tools';
import { AsyncWorkFacade } from '@vybestack/llxprt-code-core/services/asyncWorkFacade.js';
import { CoreAsyncTaskServiceAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreAsyncTaskServiceAdapter.js';
import type { TaskLaunchOwner } from './task-launch-owner.js';
import type { ShellJobOwner } from './shell-job-owner.js';
import { TaskTool } from '../tools/task.js';
import { ChildToolDisplay } from './childToolDisplay.js';
import type { SchedulerConstruction } from './assembleSchedulerOwner.js';

export function bindChildToolRegistry(
  registry: ToolLookup,
  display: ChildToolDisplay,
  taskLaunchOwner: TaskLaunchOwner | undefined,
  shellOwner: ShellJobOwner,
): ToolLookup {
  const view = new Proxy(registry, {
    get(target: ToolLookup, key: string | symbol): unknown {
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
            ? tool.withChildDisplay(() => display.open(), taskLaunchOwner, view)
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

export function createChildToolAssembly(
  construct: SchedulerConstruction,
  taskLaunchOwner: TaskLaunchOwner,
  shellOwner: ShellJobOwner,
) {
  const childDisplay = new ChildToolDisplay();
  return {
    childDisplay,
    schedulerFactory: withChildToolDisplay(
      construct,
      childDisplay,
      taskLaunchOwner,
      shellOwner,
    ),
  };
}
