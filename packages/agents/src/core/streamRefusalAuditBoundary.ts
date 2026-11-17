/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { StreamProcessorRuntime } from './chatSessionPorts.js';
import { filterHookRestrictedBlocks } from './hookToolRestrictions.js';
import {
  admitStreamChunkForHistory,
  turnMediaAdmissionContext,
} from './mediaAdmissionSeam.js';
import type { MediaAdmissionRelease } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';

export interface AdmittedRefusalAuditChunk {
  readonly filteredContent: IContent;
  readonly historyContent: IContent;
  readonly admissions: readonly MediaAdmissionRelease[];
}

export function recordToolResponses(
  recordedCallIds: Set<string>,
  callIds: readonly string[],
): void {
  for (const callId of callIds) {
    if (typeof callId === 'string' && callId.length > 0) {
      recordedCallIds.add(callId);
    }
  }
}

export function releasePromptTurnIdentity(
  identities: Map<string, string>,
  promptId: string,
): void {
  identities.delete(promptId);
}

export async function admitRefusalAuditChunk(
  ports: StreamProcessorRuntime,
  chunk: ModelStreamChunk,
  turnId: string,
): Promise<AdmittedRefusalAuditChunk> {
  const filteredContent: IContent = {
    ...chunk.content,
    blocks: filterHookRestrictedBlocks(
      chunk.content.blocks,
      chunk.hookRestrictions?.allowedToolNames,
    ),
  };
  const historyChunk = await admitStreamChunkForHistory(
    ports,
    chunk,
    filteredContent,
    turnId,
  );
  const admissions: MediaAdmissionRelease[] = [
    {
      contents: [historyChunk.content],
      context: turnMediaAdmissionContext(turnId, 'provider-stream-output'),
      mode: 'content',
    },
  ];
  if (historyChunk.afcHistory !== undefined) {
    admissions.push({
      contents: historyChunk.afcHistory,
      context: turnMediaAdmissionContext(turnId, 'provider-stream-afc-history'),
      mode: 'contents',
    });
  }
  return {
    filteredContent,
    historyContent: historyChunk.content,
    admissions,
  };
}
