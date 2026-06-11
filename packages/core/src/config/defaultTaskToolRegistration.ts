/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260610-ISSUE1592.P01
 * @requirement REQ-INV-003
 *
 * Core-local default TaskTool registration.
 * This is the ONLY core-config file that imports ../tools/task.js.
 * It provides byte-identical behavior to today's direct TaskTool usage.
 *
 * DELETED in P03 when both composition roots (CLI and a2a-server) wire
 * taskToolRegistration importing TaskTool from @vybestack/llxprt-code-agents.
 */

import { TaskTool } from '../tools/task.js';
import type {
  TaskToolRegistration,
  TaskToolArgs,
} from './toolRegistryFactory.js';

export const defaultTaskToolRegistration: TaskToolRegistration = {
  toolClass: TaskTool,
  className: TaskTool.name, // 'TaskTool'
  staticName: TaskTool.Name, // 'task'
  buildArgs(_config: unknown, taskToolArgs: TaskToolArgs): unknown[] {
    return [_config, taskToolArgs];
  },
  create(
    config: unknown,
    args: TaskToolArgs,
  ): import('../tools/tools.js').AnyDeclarativeTool {
    return new TaskTool(config as import('../config/config.js').Config, args);
  },
};
