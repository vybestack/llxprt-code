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
 * session journal. Lives
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

/** Recording inputs the journal needs from the foreground config. */
interface RecordingInputs {
  readonly projectHash: string;
  readonly chatsDir: string;
  readonly workspaceDirs: readonly string[];
}

function resolveRecordingInputs(
  config: Config,
  workspaceDirs: readonly string[],
): RecordingInputs {
  return {
    projectHash: basename(config.projectTempDir),
    chatsDir: config.projectChatsDir,
    workspaceDirs: [...workspaceDirs],
  };
}

/**
 * Open the ephemeral journal for one subagent launch under the given
 * pre-allocated fs-safe id. The caller owns the returned journal's dispose
 * for the whole launch lifecycle (success, failure, timeout, cancellation).
 */
export async function openChildSessionJournal(params: {
  readonly config: Config;
  /** Workspace roots from the orchestrator's WorkspacePathOperations. */
  readonly workspaceDirs: readonly string[];
  readonly childSessionId: string;
  readonly parentSessionId: string;
  readonly provider: string;
  readonly model: string;
}): Promise<ChildSessionJournal> {
  const inputs = resolveRecordingInputs(params.config, params.workspaceDirs);
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
