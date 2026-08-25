/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { join } from 'node:path';
import type {
  IContent,
  MediaReferenceBlock,
} from '../services/history/IContent.js';
import {
  MAX_HISTORY_CONTENTS,
  MAX_PERSISTED_STATE_AGGREGATE_BYTES,
  MAX_PERSISTED_STATE_BYTES,
  PERSISTED_SESSION_PREFIX,
  boundedAggregate,
  boundedFileSize,
  hasSameObjectMetadata,
  isContent,
  isRecord,
  readBoundedFile,
  type PackagedPersistedState,
} from './session-media-package-validation.js';

export interface CapturedPersistedState {
  readonly definition: PackagedPersistedState;
  readonly serialized: string;
  readonly record: Readonly<Record<string, unknown>>;
  readonly history: readonly IContent[];
}

export async function capturePersistedStates(
  packageDirectory: string,
  states: readonly PackagedPersistedState[],
): Promise<readonly CapturedPersistedState[]> {
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
  const captured: CapturedPersistedState[] = [];
  for (let index = 0; index < states.length; index += 1) {
    const definition = states[index];
    const path = paths[index];
    const serialized = (
      await readBoundedFile(
        path,
        MAX_PERSISTED_STATE_BYTES,
        'Packaged persisted session state',
      )
    ).toString('utf8');
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
    captured.push({ definition, serialized, record: parsed, history });
  }
  return captured;
}

export function rewrittenPersistedStates(
  states: readonly CapturedPersistedState[],
  projectHash: string,
  sessionId: string,
): ReadonlyArray<{ fileName: string; serialized: string }> {
  return states.map((state, index) => ({
    fileName: `${PERSISTED_SESSION_PREFIX}imported-${sessionId}-${index}.json`,
    serialized: JSON.stringify({ ...state.record, projectHash, sessionId }),
  }));
}

export function verifyHistoryReferences(
  source: string,
  historyReferences: readonly MediaReferenceBlock[],
  manifestReferences: readonly MediaReferenceBlock[],
): void {
  const manifestById = new Map(
    manifestReferences.map((reference) => [reference.contentId, reference]),
  );
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
      !hasSameObjectMetadata(reference.selectedObject, expected.selectedObject)
    ) {
      throw new Error(`Packaged ${source} reference metadata is invalid`);
    }
  }
}
