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
 * The orchestrator's foreground Config is a wide interface whose host supplies
 * a varying subset (the same file feature-detects getSessionId,
 * getEphemeralSetting, and getToolRegistry at this boundary). Recording inputs
 * ride the same convention: when the config cannot supply them the host has
 * opted out of session recording, and the child runs without a journal rather
 * than failing the launch. The child session id itself is allocated
 * unconditionally by the caller — fs-safe ids are required even when no
 * journal is opened.
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

/**
 * Structural view of the recording capability surface on Config, mirroring
 * the session-control accessors (storage.getProjectChatsDir is the single
 * source of truth for the chats directory).
 */
interface RecordingConfigLike {
  readonly storage?:
    | {
        getProjectChatsDir: () => string;
        getProjectTempDir: () => string;
      }
    | undefined;
  getWorkspaceContext?:
    | (() => { getDirectories: () => readonly string[] })
    | undefined;
}

/**
 * Probe the foreground config for the journal inputs. Returns null when the
 * host does not expose session recording.
 */
function resolveRecordingInputs(config: Config): RecordingInputs | null {
  const candidate = config as unknown as RecordingConfigLike;
  const storage = candidate.storage;
  if (
    storage === undefined ||
    typeof candidate.getWorkspaceContext !== 'function'
  ) {
    return null;
  }
  const workspaceDirs = candidate.getWorkspaceContext().getDirectories();
  return {
    projectHash: basename(storage.getProjectTempDir()),
    chatsDir: storage.getProjectChatsDir(),
    workspaceDirs: [...workspaceDirs],
  };
}

/**
 * Open the ephemeral journal for one subagent launch under the given
 * pre-allocated fs-safe id, or null when the foreground config does not
 * expose recording inputs. The caller owns the returned journal's dispose
 * for the whole launch lifecycle (success, failure, timeout, cancellation).
 */
export async function openChildSessionJournal(params: {
  readonly config: Config;
  readonly childSessionId: string;
  readonly parentSessionId: string;
  readonly provider: string;
  readonly model: string;
}): Promise<ChildSessionJournal | null> {
  const inputs = resolveRecordingInputs(params.config);
  if (inputs === null) {
    return null;
  }
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
  readonly childJournal: ChildSessionJournal | null;
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
      () => params.childJournal?.dispose(),
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
  childJournal: ChildSessionJournal | null,
): Promise<void> {
  return runCleanupSteps([
    () => disposeHistoryLike(runtimeResult.history),
    () => isolatedHandle.cleanup(),
    () => childJournal?.dispose(),
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
