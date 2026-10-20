/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type ToolConfirmationRequest,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type { SchedulerCallbacks } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import type { ApprovalHandler } from '../core/agenticLoop/types.js';
import type {
  SessionSchedulerOwner,
  SchedulerLease,
} from './sessionSchedulerOwner.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

const logger = new DebugLogger('llxprt:agents:turn-tools');

interface ToolRun {
  readonly callIds: Set<string>;
  active: boolean;
  release(): void;
}

export class TurnToolExecutionOwner {
  private run: ToolRun | undefined;
  private retired = false;

  constructor(
    private readonly bus: MessageBus,
    private readonly approval: ApprovalHandler | undefined,
    private readonly createScheduler: (
      callbacks: SchedulerCallbacks,
    ) => SessionSchedulerOwner,
  ) {}

  begin(): () => void {
    if (this.retired) throw new Error('Turn tool execution is retired');
    if (this.run?.active === true)
      throw new Error('Turn tool execution is already active');
    const run: ToolRun = {
      callIds: new Set(),
      active: true,
      release: () => {},
    };
    const approval = this.approval;
    const unsubscribe =
      approval !== undefined
        ? this.bus.subscribe<ToolConfirmationRequest>(
            MessageBusType.TOOL_CONFIRMATION_REQUEST,
            (request) => {
              const callId = request.toolCall.id;
              if (
                callId === undefined ||
                !run.active ||
                !run.callIds.has(callId)
              )
                return;
              void approval(request)
                .then((result) => {
                  if (run.active && run.callIds.has(callId))
                    this.bus.respondToConfirmation(
                      request.correlationId,
                      result.outcome,
                      result.payload,
                    );
                })
                .catch((error: unknown) => {
                  if (!run.active || !run.callIds.has(callId)) return;
                  logger.debug(
                    () =>
                      `approvalHandler rejected; denying confirmation: ${error instanceof Error ? error.message : String(error)}`,
                  );
                  this.bus.respondToConfirmation(
                    request.correlationId,
                    ToolConfirmationOutcome.Cancel,
                  );
                });
            },
          )
        : () => {};
    run.release = () => {
      if (!run.active) return;
      run.active = false;
      run.callIds.clear();
      unsubscribe();
    };
    this.run = run;
    return run.release;
  }

  acquire(callbacks: SchedulerCallbacks): SchedulerLease {
    const run = this.run;
    if (run === undefined || !run.active || this.retired)
      throw new Error('Turn tool execution is not active');
    const lease = this.createScheduler(callbacks).acquire();
    const callIds = new Set<string>();
    let released = false;
    return {
      ready: lease.ready,
      schedule: (requests, signal, hookOwner) => {
        if (released || !run.active || this.retired)
          throw new Error('Turn tool scheduling lease is closed');
        for (const request of Array.isArray(requests) ? requests : [requests]) {
          callIds.add(request.callId);
          run.callIds.add(request.callId);
        }
        return lease.schedule(requests, signal, hookOwner);
      },
      release: () => {
        released = true;
        for (const id of callIds) run.callIds.delete(id);
        return lease.release();
      },
    };
  }

  retire(): void {
    this.retired = true;
    this.run?.release();
  }
}
