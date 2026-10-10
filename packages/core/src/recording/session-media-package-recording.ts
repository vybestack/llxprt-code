/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { open, type FileHandle } from 'node:fs/promises';
import type { IContent } from '../services/history/IContent.js';
import type { MediaAdmissionService } from '../storage/media-admission-service.js';
import type { ReservationLedger } from './session-media-package-ledger.js';
import {
  streamBoundedLines,
  streamPinnedLines,
} from './session-media-package-lines.js';
import {
  MAX_HISTORY_CONTENTS,
  MAX_RECORDING_BYTES,
  MAX_RECORDING_LINE_BYTES,
  isContent,
  isRecord,
  requirePortableMediaContent,
  requireRecordingLine,
  type PinnedPackageFile,
} from './session-media-package-validation.js';

const RECORDING_LIMITS = {
  maxBytes: MAX_RECORDING_BYTES,
  maxLineBytes: MAX_RECORDING_LINE_BYTES,
};

/** Export-side admission: media is admitted and reserved before packaging. */
export interface ExportAdmission {
  readonly service: MediaAdmissionService;
  readonly ledger: ReservationLedger;
}

export interface PortableRecordingRequest {
  /** Unpinned source (export) or the file pinned during validation (import). */
  readonly source: string | PinnedPackageFile;
  readonly label: string;
  /** Receives each portable line; omitted when only validating. */
  readonly outputPath?: string;
  readonly exportAdmission?: ExportAdmission;
  readonly destinationProjectHash?: string;
  readonly destinationSessionId?: string;
  /** Called with the contents each recording line carries. */
  readonly onContents: (contents: readonly IContent[]) => void;
}

export interface PortableRecordingResult {
  readonly sessionId: string;
  readonly pinned: PinnedPackageFile;
}

interface LineState {
  sessionId: string | undefined;
  historyEntries: number;
}

function parseRecordingLine(serialized: string, lineNumber: number) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`Invalid recording JSON at line ${lineNumber}`, {
      cause: error,
    });
  }
  return requireRecordingLine(parsed, lineNumber);
}

async function admitForExport(
  contents: readonly IContent[],
  mode: 'content' | 'contents',
  lineNumber: number,
  admission: ExportAdmission,
): Promise<IContent[]> {
  const context = {
    turnId: `session-package-line-${lineNumber}`,
    source: 'session-package-export',
  };
  const admitted =
    mode === 'content'
      ? [await admission.service.admitContent(contents[0], context)]
      : await admission.service.admitContents(contents, context);
  await admission.ledger.record({ contents: admitted, context, mode });
  return admitted;
}

async function preparedContents(
  contents: readonly IContent[],
  mode: 'content' | 'contents',
  lineNumber: number,
  request: PortableRecordingRequest,
): Promise<IContent[]> {
  if (request.destinationProjectHash !== undefined) {
    return contents.map(requirePortableMediaContent);
  }
  if (request.exportAdmission === undefined) {
    throw new Error('Media store is required when exporting a session package');
  }
  return admitForExport(contents, mode, lineNumber, request.exportAdmission);
}

function rewriteSessionStart(
  payload: Record<string, unknown>,
  request: PortableRecordingRequest,
  state: LineState,
): Record<string, unknown> {
  const sessionId = payload['sessionId'];
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('Invalid recording session identifier');
  }
  state.sessionId = request.destinationSessionId ?? sessionId;
  const next: Record<string, unknown> = {
    ...payload,
    sessionId: state.sessionId,
    projectHash: request.destinationProjectHash ?? payload['projectHash'],
    workspaceDirs: [],
  };
  delete next['cwd'];
  return next;
}

function countHistoryEntry(state: LineState): void {
  state.historyEntries += 1;
  if (state.historyEntries > MAX_HISTORY_CONTENTS) {
    throw new Error('Session media package history count exceeds limit');
  }
}

async function portablePayload(
  line: Record<string, unknown>,
  lineNumber: number,
  request: PortableRecordingRequest,
  state: LineState,
): Promise<Record<string, unknown>> {
  const payload = line['payload'];
  if (!isRecord(payload))
    throw new Error(`Invalid recording line ${lineNumber}`);
  if (line['type'] === 'session_start') {
    return rewriteSessionStart(payload, request, state);
  }
  if (line['type'] === 'content' || line['type'] === 'compressed') {
    const key = line['type'] === 'content' ? 'content' : 'summary';
    const content = payload[key];
    if (!isContent(content)) {
      throw new Error(
        `Invalid ${String(line['type'])} recording at line ${lineNumber}`,
      );
    }
    const [admitted] = await preparedContents(
      [content],
      'content',
      lineNumber,
      request,
    );
    countHistoryEntry(state);
    request.onContents([admitted]);
    return { ...payload, [key]: admitted };
  }
  if (line['type'] === 'semantic_media_purge') {
    const history = payload['history'];
    if (!Array.isArray(history) || !history.every(isContent)) {
      throw new Error(`Invalid semantic purge recording at line ${lineNumber}`);
    }
    const admitted = await preparedContents(
      history,
      'contents',
      lineNumber,
      request,
    );
    countHistoryEntry(state);
    request.onContents(admitted);
    return { ...payload, history: admitted };
  }
  return payload;
}

async function writeLine(
  output: FileHandle | undefined,
  serialized: string,
): Promise<void> {
  await output?.write(`${serialized}\n`);
}

async function streamLines(
  request: PortableRecordingRequest,
  output: FileHandle | undefined,
  state: LineState,
): Promise<PinnedPackageFile> {
  const onLine = async (text: string, lineNumber: number): Promise<void> => {
    const line = parseRecordingLine(text, lineNumber);
    const payload = await portablePayload(line, lineNumber, request, state);
    await writeLine(output, JSON.stringify({ ...line, payload }));
  };
  const limits = { ...RECORDING_LIMITS, label: request.label };
  const result =
    typeof request.source === 'string'
      ? await streamBoundedLines(request.source, limits, onLine)
      : await streamPinnedLines(request.source, limits, onLine);
  if (result.lineCount === 0)
    throw new Error('Invalid empty session recording');
  return result.pinned;
}

/**
 * Streams a recording line by line, applying the portable rewrite and
 * handing each line's contents to the caller. Only the current line is held.
 */
export async function streamPortableRecording(
  request: PortableRecordingRequest,
): Promise<PortableRecordingResult> {
  const state: LineState = { sessionId: undefined, historyEntries: 0 };
  const output =
    request.outputPath === undefined
      ? undefined
      : await open(request.outputPath, 'wx', 0o600);
  let pinned: PinnedPackageFile | undefined;
  let failure: unknown;
  try {
    pinned = await streamLines(request, output, state);
  } catch (error) {
    failure = error;
  }
  try {
    await output?.close();
  } catch (closeError) {
    failure =
      failure === undefined
        ? closeError
        : new AggregateError(
            [failure, closeError],
            'Portable recording stream and output close failed',
          );
  }
  if (failure !== undefined) throw failure;
  if (state.sessionId === undefined || pinned === undefined) {
    throw new Error('Recording does not contain session_start');
  }
  return { sessionId: state.sessionId, pinned };
}
