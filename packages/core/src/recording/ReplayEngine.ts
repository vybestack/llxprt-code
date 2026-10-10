/**
 * Copyright 2025 Vybestack LLC
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
import { JournalResolver } from './journalResolver.js';
import { createAccumulators, finalizeReplay } from './replayMetadataFold.js';
import {
  ReplayMetadataFailure,
  ResolverReplayMetadata,
} from './resolverReplayMetadata.js';
import { readBoundedFirstLine } from './boundedHeaderReader.js';
import { formatReplayDiagnostic } from './replayErrorFormatting.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '../services/history/IContent.js';
import type { ReplayResult, SessionStartPayload } from './types.js';
import type { LocalMediaStore } from '../storage/local-media-store.js';
import type { JournalReadCounters } from './journalCounters.js';
import { MediaAdmissionService } from '../storage/media-admission-service.js';
import { verifyHistoryMedia } from '../storage/media-reference-lifecycle.js';
export { deriveSessionName } from './replayMetadataFold.js';
export { foldCheckpointMetadata } from './replayCheckpointMetadata.js';

export interface ReplaySessionOptions {
  readonly mediaStore?: LocalMediaStore;
  readonly counters?: JournalReadCounters;
}

export async function replaySession(
  filePath: string,
  expectedProjectHash: string,
  options: ReplaySessionOptions = {},
): Promise<ReplayResult> {
  return verifyReplayMedia(
    await collectReplay(filePath, expectedProjectHash, options),
    options,
  );
}

export async function replaySessionThroughSequence(
  filePath: string,
  expectedProjectHash: string,
  maxSequence: number,
  options: ReplaySessionOptions = {},
): Promise<ReplayResult> {
  return verifyReplayMedia(
    await collectReplay(filePath, expectedProjectHash, options, maxSequence),
    options,
  );
}

/**
 * Replays a recording row by row without retaining rows. The returned ok
 * result carries replay metadata with an empty `history`; every resolved row
 * goes to `onRow` and is released after it returns.
 */
export async function replaySessionRows(
  filePath: string,
  expectedProjectHash: string,
  onRow: (row: IContent) => Promise<void>,
): Promise<ReplayResult> {
  const acc = createAccumulators();
  let resolver: JournalResolver | undefined;
  try {
    resolver = await JournalResolver.open(filePath, {
      replayObserver: new ResolverReplayMetadata(acc, expectedProjectHash),
    });
    for await (const entry of resolver.resolve()) {
      await onRow(entry.content);
    }
    return finalizeReplay(acc);
  } catch (error) {
    if (error instanceof ReplayMetadataFailure) return error.result;
    return {
      ok: false,
      error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      warnings: acc.warnings,
    };
  } finally {
    await resolver?.close();
  }
}

// This compatibility API explicitly owns an eager result. Continuation uses
// cursor boot instead; the collector must never become a resume fallback.
async function collectReplay(
  filePath: string,
  projectHash: string,
  options: ReplaySessionOptions,
  throughSeq?: number,
): Promise<ReplayResult> {
  const acc = createAccumulators();
  const history: IContent[] = [];
  const counters = options.counters;
  let resolver: JournalResolver | undefined;
  try {
    resolver = await JournalResolver.open(filePath, {
      throughSeq,
      replayObserver: new ResolverReplayMetadata(acc, projectHash, throughSeq),
      counters:
        counters === undefined
          ? undefined
          : {
              recordDecoded: () => counters.recordDecoded(),
              rowDecoded: () => counters.rowDecoded(),
              // The collector retains each yielded row until returning its result.
              rowReleased: () => undefined,
            },
    });
    for await (const entry of resolver.resolve()) {
      history.push(entry.content);
      counters?.ownership?.retain(entry.content);
    }
    const metadata = finalizeReplay(acc);
    return metadata.ok
      ? { ...metadata, history: [...invalidateResponsesStatefulChain(history)] }
      : metadata;
  } catch (error) {
    if (error instanceof ReplayMetadataFailure) return error.result;
    return {
      ok: false,
      error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      warnings: acc.warnings,
    };
  } finally {
    try {
      await resolver?.close();
    } finally {
      for (const row of history) {
        counters?.ownership?.release(row);
        counters?.rowReleased();
      }
    }
  }
}
async function verifyReplayMedia(
  replay: ReplayResult,
  options: ReplaySessionOptions,
): Promise<ReplayResult> {
  if (!replay.ok) {
    return replay;
  }
  try {
    const admissionContext = {
      turnId: 'session-replay',
      source: 'session-replay',
      preserveLegacyMimeParameters: true,
    };
    const admission =
      options.mediaStore === undefined
        ? undefined
        : new MediaAdmissionService(options.mediaStore);
    const history =
      admission === undefined
        ? replay.history
        : await admission.admitContents(replay.history, admissionContext);
    try {
      await verifyHistoryMedia(history, options.mediaStore, 'session-replay');
    } catch (error) {
      if (admission === undefined) throw error;
      try {
        await admission.releaseContents(history, admissionContext);
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          'Session replay media verification and owner release failed',
        );
      }
      throw error;
    }
    await admission?.releaseContents(history, admissionContext);
    return { ...replay, history };
  } catch (error) {
    return {
      ok: false,
      error: formatReplayDiagnostic(error),
      warnings: replay.warnings,
    };
  }
}

export async function readSessionHeader(
  filePath: string,
): Promise<SessionStartPayload | null> {
  const firstLine = await readBoundedFirstLine(filePath);
  if (firstLine === null) return null;
  try {
    const parsed = JSON.parse(firstLine) as Record<string, unknown>;
    if (parsed.type !== 'session_start') return null;
    return parsed.payload as SessionStartPayload;
  } catch {
    return null;
  }
}
