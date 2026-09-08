/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  MediaAdmissionContext,
  MediaAdmissionRelease,
  MediaAdmissionService,
} from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  ModelOutput,
  ModelStreamChunk,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import { prepareUserTurnContents } from './turnIdentity.js';

interface MediaAdmissionRuntime {
  readonly mediaAdmission?: Pick<
    MediaAdmissionService,
    'admitContent' | 'admitContents'
  > &
    Partial<
      Pick<MediaAdmissionService, 'releaseContents' | 'releaseAdmissions'>
    >;
}

interface TurnIdentityHistory {
  generateTurnKey(): string;
  getIdGeneratorCallback(turnKey?: string): () => string;
}

export interface PreparedUserTurn {
  readonly userContents: IContent[];
  readonly userIContents: IContent[];
  readonly turnId: string;
  readonly admission: MediaAdmissionRelease | undefined;
  readonly releaseIfUncommitted: () => Promise<void>;
  readonly transferToHistory: () => Promise<void>;
  readonly isTransferredToHistory: () => boolean;
}

interface AdmittedModelOutput {
  readonly response: ModelOutput;
  readonly afcHistory: IContent[] | undefined;
  readonly admissions: readonly MediaAdmissionRelease[];
}

export function turnMediaAdmissionContext(
  turnId: string,
  source: string,
): MediaAdmissionContext {
  return {
    turnId,
    source,
    reservationOwnerScope: `turn:${turnId}:${source}`,
  };
}

export async function admitContentAtMediaSeam(
  runtimeContext: MediaAdmissionRuntime,
  content: IContent,
  turnId: string,
  source: string,
): Promise<IContent> {
  const mediaAdmission = runtimeContext.mediaAdmission;
  return mediaAdmission === undefined
    ? content
    : mediaAdmission.admitContent(
        content,
        turnMediaAdmissionContext(turnId, source),
      );
}

export async function admitContentsAtMediaSeam(
  runtimeContext: MediaAdmissionRuntime,
  contents: IContent[],
  turnId: string,
  source: string,
): Promise<IContent[]> {
  const mediaAdmission = runtimeContext.mediaAdmission;
  return mediaAdmission === undefined
    ? contents
    : mediaAdmission.admitContents(
        contents,
        turnMediaAdmissionContext(turnId, source),
      );
}

/**
 * Admit AFC history consistently across the streaming and non-streaming
 * transports: media-bearing entries are admitted, empty-block entries are
 * dropped, and the field is undefined when every entry is empty. Both
 * transports must record identical history for the same logical turn.
 */
async function admitAfcHistory(
  runtimeContext: MediaAdmissionRuntime,
  afcHistory: IContent[],
  turnId: string,
  source: string,
): Promise<IContent[] | undefined> {
  const admitted = await admitContentsAtMediaSeam(
    runtimeContext,
    afcHistory,
    turnId,
    source,
  );
  const nonEmpty = admitted.filter((content) => content.blocks.length > 0);
  return nonEmpty.length > 0 ? nonEmpty : undefined;
}

export async function prepareAdmittedUserTurn(
  runtimeContext: MediaAdmissionRuntime,
  historyService: TurnIdentityHistory,
  contents: IContent[],
  promptId: string,
): Promise<PreparedUserTurn> {
  const turnId = historyService.generateTurnKey();
  const mediaAdmission = runtimeContext.mediaAdmission;
  const admitted = await admitContentsAtMediaSeam(
    runtimeContext,
    contents,
    turnId,
    'user-input',
  );
  const prepared = prepareUserTurnContents(
    admitted,
    historyService,
    promptId,
    turnId,
  );
  const admission: MediaAdmissionRelease | undefined =
    mediaAdmission === undefined
      ? undefined
      : {
          contents: admitted,
          context: turnMediaAdmissionContext(turnId, 'user-input'),
          mode: 'contents',
        };
  let state: 'active' | 'released' | 'transferred' = 'active';
  return {
    userContents: prepared.userContents,
    userIContents: prepared.userIContents,
    turnId,
    admission,
    releaseIfUncommitted: async () => {
      if (state !== 'active') return;
      state = 'released';
      if (admission !== undefined) {
        await mediaAdmission?.releaseAdmissions?.([admission]);
      }
    },
    transferToHistory: async () => {
      if (state === 'released') {
        throw new Error(
          'Released user media admission cannot transfer to history',
        );
      }
      if (state === 'transferred') return;
      if (admission !== undefined) {
        await mediaAdmission?.releaseAdmissions?.([admission]);
      }
      state = 'transferred';
    },
    isTransferredToHistory: () => state === 'transferred',
  };
}
export async function releaseAdmissionsAfterError(
  runtimeContext: MediaAdmissionRuntime,
  admissions: readonly MediaAdmissionRelease[],
  primaryError: unknown,
  message: string,
): Promise<never> {
  try {
    await runtimeContext.mediaAdmission?.releaseAdmissions?.(admissions);
  } catch (cleanupError: unknown) {
    throw new AggregateError([primaryError, cleanupError], message);
  }
  throw primaryError;
}

export async function admitStreamChunkForHistory(
  runtimeContext: MediaAdmissionRuntime,
  chunk: ModelStreamChunk,
  filteredContent: IContent,
  turnId: string,
): Promise<ModelStreamChunk> {
  const { afcHistory: sourceAfcHistory, ...chunkWithoutAfcHistory } = chunk;
  const content = await admitContentAtMediaSeam(
    runtimeContext,
    filteredContent,
    turnId,
    'provider-stream-output',
  );
  let afcHistory: IContent[] | undefined;
  try {
    afcHistory =
      sourceAfcHistory === undefined
        ? undefined
        : await admitAfcHistory(
            runtimeContext,
            sourceAfcHistory,
            turnId,
            'provider-stream-afc-history',
          );
  } catch (error: unknown) {
    try {
      await runtimeContext.mediaAdmission?.releaseAdmissions?.([
        {
          contents: [content],
          context: turnMediaAdmissionContext(turnId, 'provider-stream-output'),
          mode: 'content',
        },
      ]);
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [error, cleanupError],
        'Stream AFC admission failed and output cleanup was incomplete',
      );
    }
    throw error;
  }
  return {
    ...chunkWithoutAfcHistory,
    content,
    ...(afcHistory === undefined ? {} : { afcHistory }),
  };
}

export async function admitModelOutputForHistory(
  runtimeContext: MediaAdmissionRuntime,
  response: ModelOutput,
  turnId: string,
): Promise<AdmittedModelOutput> {
  const { afcHistory: sourceAfcHistory, ...responseWithoutAfcHistory } =
    response;
  const admissions: MediaAdmissionRelease[] = [];
  const content = await admitContentAtMediaSeam(
    runtimeContext,
    response.content,
    turnId,
    'provider-output',
  );
  admissions.push({
    contents: [content],
    context: turnMediaAdmissionContext(turnId, 'provider-output'),
    mode: 'content',
  });
  let afcHistory: IContent[] | undefined;
  try {
    afcHistory =
      sourceAfcHistory === undefined
        ? undefined
        : await admitAfcHistory(
            runtimeContext,
            sourceAfcHistory,
            turnId,
            'provider-afc-history',
          );
    if (afcHistory !== undefined) {
      admissions.push({
        contents: afcHistory,
        context: turnMediaAdmissionContext(turnId, 'provider-afc-history'),
        mode: 'contents',
      });
    }
  } catch (error: unknown) {
    return releaseAdmissionsAfterError(
      runtimeContext,
      admissions,
      error,
      'AFC admission failed and output cleanup was incomplete',
    );
  }
  return {
    response: {
      ...responseWithoutAfcHistory,
      content,
      ...(afcHistory === undefined ? {} : { afcHistory }),
    },
    afcHistory,
    admissions,
  };
}
