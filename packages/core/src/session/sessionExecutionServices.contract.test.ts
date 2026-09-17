/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Compile-time contract assertions for the slice E interface contracts
 * (issue #2615, PR 1). The assertions live in type aliases that fail
 * typecheck when the ports drift from the implementations or from the
 * shape the issue fixes (five members, owner-object registry keys,
 * #2320 bus routing). The runtime block only proves the modules load;
 * these files carry no behavior.
 */

import { describe, expect, it } from 'bun:test';
import type { ToolSchedulerContract } from '../core/toolSchedulerContract.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { SessionRecordingService } from '../recording/SessionRecordingService.js';
import type { AsyncTaskManager } from '../services/asyncTaskManager.js';
import type { ShellJobManager } from '../services/shellJobManager.js';
import type { CancellationTree } from './cancellationTree.js';
import * as cancellationTreeModule from './cancellationTree.js';
import type {
  SchedulerPurpose,
  SessionSchedulerRegistry,
} from './sessionSchedulerRegistry.js';
import * as sessionSchedulerRegistryModule from './sessionSchedulerRegistry.js';
import type {
  ApprovalBusPort,
  RecordingPort,
  SchedulerHandle,
  SessionExecutionServices,
  ShellJobPort,
  TaskPort,
} from './sessionExecutionServices.js';
import * as sessionExecutionServicesModule from './sessionExecutionServices.js';

type Expect<T extends true> = T;

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

/**
 * Each alias resolves its conditional against concrete types, so a port
 * drift makes the conditional false and Expect fails the build here. The
 * implementations above never import the ports; this is the structural
 * typing rule from the issue restated as compile-time checks.
 */
type AsyncTaskManagerIsTaskPort = Expect<
  AsyncTaskManager extends TaskPort ? true : false
>;
type ShellJobManagerIsShellJobPort = Expect<
  ShellJobManager extends ShellJobPort ? true : false
>;
type SessionRecordingServiceIsRecordingPort = Expect<
  SessionRecordingService extends RecordingPort ? true : false
>;
type MessageBusIsApprovalBusPort = Expect<
  MessageBus extends ApprovalBusPort ? true : false
>;
type SchedulerContractIsSchedulerHandle = Expect<
  ToolSchedulerContract extends SchedulerHandle ? true : false
>;

type PortHasExactlyFiveMembers = Expect<
  Equal<
    keyof SessionExecutionServices,
    'scheduler' | 'tasks' | 'shellJobs' | 'approvals' | 'recording'
  >
>;

type RegistryKeysAreOwnerObjects = Expect<
  Equal<
    Parameters<SessionSchedulerRegistry['getOrCreate']>[0],
    Parameters<SessionSchedulerRegistry['release']>[0]
  > &
    Equal<Parameters<SessionSchedulerRegistry['release']>[0], object>
>;

type PurposesAreTheObservedSet = Expect<
  Equal<SchedulerPurpose, 'session' | 'agentic-loop' | 'subagent'>
>;

type CancellationTreeIsRootAndJoin = Expect<
  Equal<keyof CancellationTree, 'root' | 'join'>
>;

// Referencing every assertion alias keeps no-unused-vars honest and makes
// this tuple the single place the contract list is read.
type ContractAssertions = [
  AsyncTaskManagerIsTaskPort,
  ShellJobManagerIsShellJobPort,
  SessionRecordingServiceIsRecordingPort,
  MessageBusIsApprovalBusPort,
  SchedulerContractIsSchedulerHandle,
  PortHasExactlyFiveMembers,
  RegistryKeysAreOwnerObjects,
  PurposesAreTheObservedSet,
  CancellationTreeIsRootAndJoin,
];

describe('slice E interface contracts (#2615)', () => {
  it('keeps every compile-time contract assertion referenced', () => {
    const assertions: Array<ContractAssertions[number]> = [];
    expect(assertions).toHaveLength(0);
  });

  it('loads the contract modules without runtime behavior', () => {
    expect(typeof sessionExecutionServicesModule).toBe('object');
    expect(typeof sessionSchedulerRegistryModule).toBe('object');
    expect(typeof cancellationTreeModule).toBe('object');
  });
});
