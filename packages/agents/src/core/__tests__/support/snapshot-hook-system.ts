/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AfterModelHookOutput,
  BeforeModelHookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import type {
  AggregatedHookSnapshotResult,
  HookModelSnapshotOutput,
  HookModelSnapshotRequest,
} from '@vybestack/llxprt-code-core/hooks/hookSnapshotAggregator.js';
import type {
  HookLLMRequest,
  HookLLMResponse,
} from '@vybestack/llxprt-code-core/hooks/hookTranslator.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

type ModelHookOutput = BeforeModelHookOutput | AfterModelHookOutput;

/**
 * In-process model hook doubles that observe and decide on a materialized
 * request. The source route hands hooks a disk-backed row selection instead,
 * so these are adapted by `withSnapshotModelEvents`.
 */
export interface MaterializedModelHooks {
  fireBeforeModelEvent(
    request: Omit<HookLLMRequest, 'version'>,
  ): Promise<ModelHookOutput | undefined>;
  fireAfterModelEvent(
    request: Omit<HookLLMRequest, 'version'>,
    response: Omit<HookLLMResponse, 'version'>,
  ): Promise<ModelHookOutput | undefined>;
}

export interface SnapshotModelHooks {
  fireBeforeModelSnapshotEvent(
    request: HookModelSnapshotRequest,
    signal?: AbortSignal,
  ): Promise<AggregatedHookSnapshotResult>;
  fireAfterModelSnapshotEvent(
    request: HookModelSnapshotRequest,
    response: Omit<HookLLMResponse, 'version'>,
    signal?: AbortSignal,
  ): Promise<AggregatedHookSnapshotResult>;
}

async function materialize(
  request: HookModelSnapshotRequest,
  signal?: AbortSignal,
): Promise<Omit<HookLLMRequest, 'version'>> {
  const contents: IContent[] = [];
  for await (const row of request.contents.openReader(signal))
    contents.push(row);
  return { ...request, contents };
}

/** Only the decision surface the source route reads from a hook output. */
function decide(
  output: ModelHookOutput | undefined,
): AggregatedHookSnapshotResult {
  const finalOutput =
    output === undefined
      ? undefined
      : ({
          shouldStopExecution: () => output.shouldStopExecution(),
          isBlockingDecision: () => output.isBlockingDecision(),
          getEffectiveReason: () => output.getEffectiveReason(),
          readSystemMessage: () => output.systemMessage,
          readLlmResponse: () => output.hookSpecificOutput?.['llm_response'],
          readValue: (path: ReadonlyArray<string | number>) =>
            path[0] === 'hookSpecificOutput'
              ? output.hookSpecificOutput?.[String(path[1])]
              : undefined,
          assertTextRequest: () => undefined,
          applyRequestRows: <T>(target: T): T => target,
        } as unknown as HookModelSnapshotOutput);
  return {
    success: true,
    finalOutput,
    errors: [],
    totalDuration: 0,
    close: () => undefined,
  };
}

/**
 * Adds the snapshot model events the source route calls to a hook system test
 * double. Each call materializes the request rows and forwards to the double's
 * `fireBeforeModelEvent` / `fireAfterModelEvent` at call time, so tests can
 * keep reprogramming those mocks after construction.
 */
export function withSnapshotModelEvents<T extends MaterializedModelHooks>(
  system: T,
): T & SnapshotModelHooks {
  const snapshotHooks: SnapshotModelHooks = {
    fireBeforeModelSnapshotEvent: async (request, signal) =>
      decide(
        await system.fireBeforeModelEvent(await materialize(request, signal)),
      ),
    fireAfterModelSnapshotEvent: async (request, response, signal) =>
      decide(
        await system.fireAfterModelEvent(
          await materialize(request, signal),
          response,
        ),
      ),
  };
  return Object.assign(system, snapshotHooks);
}
