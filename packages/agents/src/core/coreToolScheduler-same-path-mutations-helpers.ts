/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers for the same-path mutation ordering scheduler tests
 * (issue #3239): deterministic control primitives, scheduler/registry
 * construction, publication-order tracking, and a real-tool host factory.
 */

import { beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreToolScheduler, type ToolCall } from './coreToolScheduler.js';
import type { CompletedToolCall } from './coreToolScheduler.js';
import type { ToolCallRequestInfo } from '@vybestack/llxprt-code-core/core/turn.js';
import { createMockConfig } from './coreToolScheduler-test-helpers.js';
import { createSessionMessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  type Kind,
  ToolRegistry,
} from '@vybestack/llxprt-code-tools';
import type {
  AnyDeclarativeTool,
  IToolHost,
  IToolMessageBus,
  ToolInvocation,
  ToolLocation,
  ToolResult,
} from '@vybestack/llxprt-code-tools';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

export function deferred<T>(): Deferred<T> {
  let settle: (value: T) => void = () => {
    throw new Error('deferred settle called before initialization');
  };
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: (value) => settle(value) };
}

export function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Creates a temp workspace for each test in the enclosing describe block and
 * removes it afterwards. Tests read the current path through the accessor.
 */
export function useTempWorkspace(): () => string {
  let workspace = '';
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'same-path-scheduler-'));
  });
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });
  return () => workspace;
}

/**
 * A declarative test tool whose kind comes from the tool constructor and
 * whose reported locations come from the call arguments, so scheduling
 * behavior can be observed without mocking the scheduler. Execution is
 * driven by a test-supplied behavior function; assertions read the
 * observable event journal.
 */
export type ControlledExecute = (
  args: Record<string, unknown>,
) => Promise<ToolResult>;

class PathControlledInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    params: Record<string, unknown>,
    messageBus: IToolMessageBus | undefined,
    private readonly executeImpl: ControlledExecute,
  ) {
    super(params, messageBus);
  }

  getDescription(): string {
    return 'Path-controlled test invocation';
  }

  override toolLocations(): ToolLocation[] {
    const requested = this.params.paths;
    if (!Array.isArray(requested)) {
      return [];
    }
    return requested
      .filter((entry): entry is string => typeof entry === 'string')
      .map((filePath) => ({ path: filePath }));
  }

  async execute(): Promise<ToolResult> {
    return this.executeImpl(this.params);
  }
}

export class PathControlledTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    name: string,
    kind: Kind,
    private readonly executeImpl: ControlledExecute,
  ) {
    super(name, name, name, kind, {}, false, false);
  }

  protected override createInvocation(
    params: Record<string, unknown>,
    messageBus?: IToolMessageBus,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    return new PathControlledInvocation(params, messageBus, this.executeImpl);
  }
}

/** Records `start:<call>` on entry, then waits for that call's gate. */
export function gatedJournalExecute(
  events: string[],
  gates: ReadonlyMap<string, Deferred<void>>,
): ControlledExecute {
  return async (args) => {
    const callId = String(args.call);
    events.push(`start:${callId}`);
    const gate = gates.get(callId);
    if (gate) {
      await gate.promise;
    }
    events.push(`end:${callId}`);
    return { llmContent: `done:${callId}`, returnDisplay: `done:${callId}` };
  };
}

/** Records `start:<call>` on entry, then waits until every call started. */
export function barrierJournalExecute(
  events: string[],
  requiredCalls: readonly string[],
): ControlledExecute {
  const allStarted = deferred<void>();
  const started = new Set<string>();
  return async (args) => {
    const callId = String(args.call);
    events.push(`start:${callId}`);
    started.add(callId);
    if (requiredCalls.every((call) => started.has(call))) {
      allStarted.resolve();
    }
    await allStarted.promise;
    return { llmContent: `done:${callId}`, returnDisplay: `done:${callId}` };
  };
}

/** Records `start:<call>`, waits for its gate, then fails the tool call. */
export function failingJournalExecute(
  events: string[],
  gates: ReadonlyMap<string, Deferred<void>>,
): ControlledExecute {
  return async (args) => {
    const callId = String(args.call);
    events.push(`start:${callId}`);
    const gate = gates.get(callId);
    if (gate) {
      await gate.promise;
    }
    throw new Error(`controlled failure for ${callId}`);
  };
}

export function toolRequest(
  callId: string,
  name: string,
  args: Record<string, unknown>,
): ToolCallRequestInfo {
  return {
    callId,
    name,
    args,
    isClientInitiated: false,
    prompt_id: 'same-path-mutations-test',
  };
}

export function buildRegistry(
  tools: readonly AnyDeclarativeTool[],
): ToolRegistry {
  const registry = new ToolRegistry({}, createSessionMessageBus());
  for (const tool of tools) {
    registry.registerTool(tool);
  }
  return registry;
}

export function buildScheduler(
  registry: ToolRegistry,
  observers: {
    onToolCallsUpdate?: (calls: ToolCall[]) => void;
    onAllToolCallsComplete?: (calls: CompletedToolCall[]) => void;
  } = {},
): CoreToolScheduler {
  // Real session message bus (typed factory, no structural mock): the
  // scheduler consumes it directly through its options, and YOLO approval
  // auto-approves confirmations without consulting the bus.
  const messageBus = createSessionMessageBus();
  const config = createMockConfig({
    getToolRegistry: () => registry,
  });
  return new CoreToolScheduler({
    config,
    messageBus,
    toolRegistry: registry,
    onToolCallsUpdate: observers.onToolCallsUpdate,
    onAllToolCallsComplete: observers.onAllToolCallsComplete
      ? async (calls) => observers.onAllToolCallsComplete?.(calls)
      : undefined,
    getPreferredEditor: () => undefined,
    onEditorClose: () => undefined,
  });
}

/** Tracks the order in which calls first reach a terminal (published) status. */
export function trackPublicationOrder(): {
  order: string[];
  onToolCallsUpdate: (calls: ToolCall[]) => void;
} {
  const order: string[] = [];
  const onToolCallsUpdate = (calls: ToolCall[]): void => {
    for (const call of calls) {
      if (
        (call.status === 'success' || call.status === 'error') &&
        !order.includes(call.request.callId)
      ) {
        order.push(call.request.callId);
      }
    }
  };
  return { order, onToolCallsUpdate };
}

/** Real-tool host bound to a temp workspace directory. */
export function createToolHost(targetDir: string): IToolHost {
  return {
    getTargetDir: () => targetDir,
    getWorkspaceRoots: () => [targetDir],
    getApprovalMode: () => 'auto',
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
    getEphemeralSettings: () => ({}),
    getDebugMode: () => false,
  };
}
