/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan:PLAN-20260917-ISSUE854.P05c
 * @requirement:G7
 *
 * Boundary seam between the SubagentOrchestrator and the ephemeral child
 * session journal, plus the journal-aware launch teardown composition. Lives
 * outside the orchestrator file so the over-cap orchestrator is not grown by
 * the wiring.
 *
 */

import { basename } from 'node:path';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  createChildSessionJournal,
  type ChildSessionJournal,
} from '@vybestack/llxprt-code-core/recording/childJournal.js';
import type { AgentRuntimeLoaderResult } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { IsolatedRuntimeContextHandle } from '@vybestack/llxprt-code-providers/runtime.js';
import { AggregateDisposeError } from '../api/disposeErrors.js';
import type { SubAgentScope } from './subagent.js';

/** Recording inputs the journal needs from the foreground config. */
interface RecordingInputs {
  readonly projectHash: string;
  readonly chatsDir: string;
  readonly workspaceDirs: readonly string[];
}

function resolveRecordingInputs(config: Config): RecordingInputs {
  return {
    projectHash: basename(config.storage.getProjectTempDir()),
    chatsDir: config.storage.getProjectChatsDir(),
    workspaceDirs: [...config.getWorkspaceContext().getDirectories()],
  };
}

/**
 * Open the ephemeral journal for one subagent launch under the given
 * pre-allocated fs-safe id. The caller owns the returned journal's dispose
 * for the whole launch lifecycle (success, failure, timeout, cancellation).
 */
export async function openChildSessionJournal(params: {
  readonly config: Config;
  readonly childSessionId: string;
  readonly parentSessionId: string;
  readonly provider: string;
  readonly model: string;
}): Promise<ChildSessionJournal> {
  const inputs = resolveRecordingInputs(params.config);
  return createChildSessionJournal({
    sessionId: params.childSessionId,
    parentSessionId: params.parentSessionId,
    projectHash: inputs.projectHash,
    chatsDir: inputs.chatsDir,
    workspaceDirs: inputs.workspaceDirs,
    provider: params.provider,
    model: params.model,
  });
}

/** Inputs for {@link buildScopeTeardown}. */
export interface ScopeTeardownParams {
  readonly scope: SubAgentScope;
  readonly runtimeResult: AgentRuntimeLoaderResult;
  readonly isolatedHandle: IsolatedRuntimeContextHandle;
  readonly childJournal: ChildSessionJournal;
}

/**
 * Compose the teardown for a launched subagent: scope dispose, history
 * dispose, isolated-runtime cleanup, and finally the child journal so the
 * facade can flush through the recorder before the file and lock are removed.
 */
export function buildScopeTeardown(
  params: ScopeTeardownParams,
): () => Promise<void> {
  return async () => {
    const history = firstDefinedHistory(
      params.runtimeResult.history,
      params.scope.runtimeContext.history,
    );
    await runCleanupSteps([
      () => {
        if (typeof params.scope.dispose === 'function') {
          params.scope.dispose();
        }
      },
      () => disposeHistoryLike(history),
      () => params.isolatedHandle.cleanup(),
      () => params.childJournal.dispose(),
    ]);
  };
}

/**
 * Teardown for a launch that failed before a scope existed: dispose the
 * runtime history, clean the isolated runtime, then remove the journal.
 */
export function teardownRuntimeArtifacts(
  runtimeResult: AgentRuntimeLoaderResult,
  isolatedHandle: IsolatedRuntimeContextHandle,
  childJournal: ChildSessionJournal,
): Promise<void> {
  return runCleanupSteps([
    () => disposeHistoryLike(runtimeResult.history),
    () => isolatedHandle.cleanup(),
    () => childJournal.dispose(),
  ]);
}

async function runCleanupSteps(
  steps: ReadonlyArray<() => unknown | Promise<unknown>>,
): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateDisposeError(errors);
  }
}

/**
 * Boundary-validation helper: disposes (or clears) a history-like object that
 * may be `undefined`/`null` at runtime. Typed `unknown` so the guards are
 * genuinely necessary (no lint suppression directive needed).
 */
function disposeHistoryLike(history: unknown): void {
  if (history === undefined || history === null) {
    return;
  }
  const disposable = (history as { dispose?: () => void }).dispose;
  if (typeof disposable === 'function') {
    disposable.call(history);
    return;
  }
  const clearable = history as {
    clear?: () => void;
    removeAllListeners?: () => void;
  };
  if (typeof clearable.clear === 'function') {
    clearable.clear();
    if (typeof clearable.removeAllListeners === 'function') {
      clearable.removeAllListeners();
    }
  }
}

/**
 * Boundary-validation helper: picks the first defined history source without
 * tripping `no-unnecessary-condition` (both args are statically required).
 */
function firstDefinedHistory(primary: unknown, fallback: unknown): unknown {
  return primary ?? fallback;
}
