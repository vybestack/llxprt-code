/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SchedulerCallbacks } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import {
  CoreToolScheduler,
  type CoreToolSchedulerOptions,
} from '../core/coreToolScheduler.js';
import { SessionSchedulerOwner } from './sessionSchedulerOwner.js';

export type SchedulerConstruction = (
  options: CoreToolSchedulerOptions,
) => CoreToolScheduler;

const constructScheduler: SchedulerConstruction = (options) =>
  new CoreToolScheduler(options);

export function assembleSchedulerOwner(
  label: string,
  options: CoreToolSchedulerOptions,
  construct: SchedulerConstruction = constructScheduler,
): SessionSchedulerOwner {
  const captured = { ...options };
  let scheduler: CoreToolScheduler | undefined;
  return new SessionSchedulerOwner(
    label,
    () => {
      scheduler = construct(captured);
      return scheduler;
    },
    async () => {
      await scheduler?.joinExecutions();
    },
  );
}

export function bindSchedulerOwner(
  config: CoreToolSchedulerOptions['config'],
  messageBus: CoreToolSchedulerOptions['messageBus'],
  interactiveMode: boolean,
  toolRegistry: CoreToolSchedulerOptions['toolRegistry'],
  construct: SchedulerConstruction,
  readExecutionPolicy: CoreToolSchedulerOptions['readExecutionPolicy'],
  getToolGovernance: CoreToolSchedulerOptions['getToolGovernance'],
  readApprovalMode: CoreToolSchedulerOptions['readApprovalMode'],
  telemetry: CoreToolSchedulerOptions['telemetry'],
): (callbacks: SchedulerCallbacks) => SessionSchedulerOwner {
  const label = config.getSessionId();
  return (callbacks) =>
    assembleSchedulerOwner(
      label,
      {
        config,
        telemetry,
        readExecutionPolicy,
        readApprovalMode,
        getToolGovernance,
        messageBus,
        toolRegistry,
        toolContextInteractiveMode: interactiveMode,
        ...callbacks,
      },
      construct,
    );
}
