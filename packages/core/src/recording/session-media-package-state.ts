/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  IContent,
  MediaReferenceBlock,
} from '../services/history/IContent.js';
import type { MediaAdmissionService } from '../storage/media-admission-service.js';
import { collectMediaReferences } from '../storage/media-reference-lifecycle.js';
import type { ReservationLedger } from './session-media-package-ledger.js';
import {
  MAX_HISTORY_CONTENTS,
  MAX_PERSISTED_STATES,
  MAX_REFERENCES,
  MAX_PERSISTED_STATE_AGGREGATE_BYTES,
  MAX_PERSISTED_STATE_BYTES,
  PERSISTED_SESSION_PREFIX,
  SUPPORTED_PERSISTED_SESSION_VERSION,
  boundedAggregate,
  boundedFileSize,
  hasSameObjectMetadata,
  isContent,
  isRecord,
  readBoundedFile,
  uniqueReferences,
  type PackagedPersistedState,
  type PinnedPackageFile,
} from './session-media-package-validation.js';

export interface PinnedPersistedState {
  readonly definition: PackagedPersistedState;
  readonly pinned: PinnedPackageFile;
}

export type ReferenceVerifier = (
  historyReferences: readonly MediaReferenceBlock[],
) => void;

/** Checks history references against the manifest without retaining them. */
export function createReferenceVerifier(
  source: string,
  manifestReferences: readonly MediaReferenceBlock[],
): ReferenceVerifier {
  const manifestById = new Map(
    manifestReferences.map((reference) => [reference.contentId, reference]),
  );
  return (historyReferences) => {
    for (const reference of historyReferences) {
      const expected = manifestById.get(reference.contentId);
      if (expected === undefined) {
        throw new Error(`Packaged ${source} references undeclared media`);
      }
      if (
        reference.originalContentId !== expected.originalContentId ||
        reference.selectedContentId !== expected.selectedContentId ||
        !hasSameObjectMetadata(
          reference.originalObject,
          expected.originalObject,
        ) ||
        !hasSameObjectMetadata(
          reference.selectedObject,
          expected.selectedObject,
        )
      ) {
        throw new Error(`Packaged ${source} reference metadata is invalid`);
      }
    }
  };
}

function parsePackagedState(
  serialized: string,
  definition: PackagedPersistedState,
): Record<string, unknown> {
  const parsed: unknown = JSON.parse(serialized);
  if (!isRecord(parsed)) {
    throw new Error('Invalid packaged persisted session state');
  }
  const history = parsed['history'];
  if (
    parsed['version'] !== definition.version ||
    !Array.isArray(history) ||
    !history.every(isContent) ||
    history.length > MAX_HISTORY_CONTENTS
  ) {
    throw new Error('Invalid packaged persisted session state');
  }
  return parsed;
}

async function readPackagedState(pinned: PinnedPackageFile): Promise<string> {
  const bytes = await readBoundedFile(
    pinned.path,
    MAX_PERSISTED_STATE_BYTES,
    'Packaged persisted session state',
  );
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== pinned.byteLength || digest !== pinned.sha256) {
    throw new Error(
      'Packaged persisted session state changed after validation',
    );
  }
  return bytes.toString('utf8');
}

/**
 * Validates each packaged state one at a time and pins its path and digest.
 * A state's history is parsed transiently and never retained.
 */
export async function pinPersistedStates(
  packageDirectory: string,
  states: readonly PackagedPersistedState[],
  verifyReferences: ReferenceVerifier,
): Promise<readonly PinnedPersistedState[]> {
  const paths = states.map((definition) =>
    join(packageDirectory, definition.file),
  );
  const sizes: number[] = [];
  for (const path of paths) {
    sizes.push(
      await boundedFileSize(
        path,
        MAX_PERSISTED_STATE_BYTES,
        'Packaged persisted session state',
      ),
    );
  }
  boundedAggregate(
    sizes,
    MAX_PERSISTED_STATE_AGGREGATE_BYTES,
    'Packaged persisted session states',
  );
  const pinnedStates: PinnedPersistedState[] = [];
  for (let index = 0; index < states.length; index += 1) {
    const bytes = await readBoundedFile(
      paths[index],
      MAX_PERSISTED_STATE_BYTES,
      'Packaged persisted session state',
    );
    const parsed = parsePackagedState(bytes.toString('utf8'), states[index]);
    verifyReferences(
      collectMediaReferences(parsed['history'] as readonly IContent[]),
    );
    pinnedStates.push({
      definition: states[index],
      pinned: {
        path: paths[index],
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    });
  }
  return pinnedStates;
}

/** Rewrites one pinned state for the destination session and writes it out. */
export async function writeRewrittenPersistedState(
  state: PinnedPersistedState,
  outputPath: string,
  projectHash: string,
  sessionId: string,
): Promise<void> {
  const record = parsePackagedState(
    await readPackagedState(state.pinned),
    state.definition,
  );
  await writeFile(
    outputPath,
    JSON.stringify({ ...record, projectHash, sessionId }),
    { mode: 0o600, flag: 'wx' },
  );
}

export function importedStateFileName(
  sessionId: string,
  index: number,
): string {
  return `${PERSISTED_SESSION_PREFIX}imported-${sessionId}-${index}.json`;
}

export interface ExportStateContext {
  readonly recordingPath: string;
  readonly stateDirectory: string;
  readonly sessionId: string;
  readonly projectHash: string;
  readonly admission: MediaAdmissionService;
  readonly ledger: ReservationLedger;
  readonly onContents: (contents: readonly IContent[]) => void;
}

async function exportPersistedStateEntries(
  recordingPath: string,
): Promise<readonly string[]> {
  const entries = (await readdir(dirname(recordingPath)))
    .filter(
      (entry) =>
        entry.startsWith(PERSISTED_SESSION_PREFIX) && entry.endsWith('.json'),
    )
    .sort();
  if (entries.length > MAX_PERSISTED_STATES) {
    throw new Error('Export persisted state count exceeds limit');
  }
  const sizes: number[] = [];
  for (const entry of entries) {
    sizes.push(
      await boundedFileSize(
        join(dirname(recordingPath), entry),
        MAX_PERSISTED_STATE_BYTES,
        'Persisted session state',
      ),
    );
  }
  boundedAggregate(
    sizes,
    MAX_PERSISTED_STATE_AGGREGATE_BYTES,
    'Persisted session states',
  );
  return entries;
}

async function exportPersistedState(
  context: ExportStateContext,
  entry: string,
  stateIndex: number,
): Promise<string | undefined> {
  const parsed: unknown = JSON.parse(
    (
      await readBoundedFile(
        join(dirname(context.recordingPath), entry),
        MAX_PERSISTED_STATE_BYTES,
        'Persisted session state',
      )
    ).toString('utf8'),
  );
  if (!isRecord(parsed)) throw new Error(`Invalid persisted session ${entry}`);
  if (
    parsed['sessionId'] !== context.sessionId ||
    parsed['projectHash'] !== context.projectHash
  ) {
    return undefined;
  }
  if (parsed['version'] !== SUPPORTED_PERSISTED_SESSION_VERSION) {
    throw new Error(
      `Unsupported persisted session version ${String(parsed['version'])}`,
    );
  }
  const history = parsed['history'];
  if (
    !Array.isArray(history) ||
    !history.every(isContent) ||
    history.length > MAX_HISTORY_CONTENTS
  ) {
    throw new Error(`Invalid persisted session history ${entry}`);
  }
  const admissionContext = {
    turnId: `session-package-persisted-${stateIndex}`,
    source: 'session-package-export',
  };
  const admitted = await context.admission.admitContents(
    history,
    admissionContext,
  );
  await context.ledger.record({
    contents: admitted,
    context: admissionContext,
    mode: 'contents',
  });
  context.onContents(admitted);
  const file = `persisted-${stateIndex}.json`;
  await mkdir(context.stateDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(context.stateDirectory, file),
    JSON.stringify({ ...parsed, history: admitted }),
    { mode: 0o600, flag: 'wx' },
  );
  return `state/${file}`;
}

/**
 * Exports the persisted states belonging to the session one at a time,
 * writing each straight to the staged package. Returns the packaged files.
 */
export async function exportPersistedStates(
  context: ExportStateContext,
): Promise<readonly string[]> {
  const entries = await exportPersistedStateEntries(context.recordingPath);
  const files: string[] = [];
  for (const entry of entries) {
    const file = await exportPersistedState(context, entry, files.length);
    if (file !== undefined) files.push(file);
  }
  return files;
}

/** Unique media references seen while exporting, bounded by the package limit. */
export class MediaReferenceIndex {
  private readonly byContentId = new Map<string, MediaReferenceBlock>();

  add(contents: readonly IContent[]): void {
    for (const reference of collectMediaReferences(contents)) {
      const existing = this.byContentId.get(reference.contentId);
      if (existing !== undefined) {
        uniqueReferences([existing, reference]);
      } else if (this.byContentId.size >= MAX_REFERENCES) {
        throw new Error('Session media package reference count exceeds limit');
      }
      this.byContentId.set(reference.contentId, reference);
    }
  }

  references(): readonly MediaReferenceBlock[] {
    return [...this.byContentId.values()];
  }
}
