/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AgentClientContract,
  AgentChatRecordingExecution,
} from '@vybestack/llxprt-code-core/core/clientContract.js';
import { getResponseTextFromBlocks } from '@vybestack/llxprt-code-core';
import type { AgentInput, GenerateOptions } from './agent.js';
import type { SessionControl } from './control/sessionControl.js';
import type { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import { createRecordingExecution } from './recordingExecution.js';
import { toPartListUnion } from './agentBootstrap.js';

export async function generateDetachedText(
  input: AgentInput,
  promptId: string,
  generate: AgentClientContract['generateDirectMessage'],
  recording: AgentChatRecordingExecution,
): Promise<string> {
  const response = await generate(
    { message: toPartListUnion(input) },
    promptId,
    recording,
  );
  return getResponseTextFromBlocks(response.content.blocks) ?? '';
}

export function generateSessionText(
  input: AgentInput,
  options: GenerateOptions | undefined,
  generate: AgentClientContract['generateDirectMessage'],
  session: SessionControl,
  hooks: Pick<SessionHookOwner, 'execution'>,
): Promise<string> {
  return generateDetachedText(
    input,
    options?.promptId ?? `generate-${Date.now()}`,
    generate,
    createRecordingExecution(session, () => session.getSessionId(), hooks),
  );
}
