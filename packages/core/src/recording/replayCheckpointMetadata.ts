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

import type { CheckpointMetadataView, SessionRecordLine } from './types.js';

/**
 * Checkpoint metadata folding for replay (kept beside ReplayEngine so the
 * engine stays within its size budget).
 */
export function appendCheckpointMetadataWarnings(
  events: readonly SessionRecordLine[],
  warnings: string[],
): void {
  const knownIds = new Set<string>();
  const deletedIds = new Set<string>();
  for (const line of events) {
    const checkpointId = extractCheckpointId(line);
    if (checkpointId === null) continue;
    if (line.type === 'checkpoint_created') {
      if (knownIds.has(checkpointId)) {
        warnings.push(
          `Sequence ${line.seq}: checkpoint_created duplicates checkpoint ${checkpointId}`,
        );
      } else {
        knownIds.add(checkpointId);
      }
    } else if (
      line.type === 'checkpoint_renamed' ||
      line.type === 'checkpoint_deleted'
    ) {
      if (!knownIds.has(checkpointId)) {
        warnings.push(
          `Sequence ${line.seq}: ${line.type} references unknown checkpoint ${checkpointId}`,
        );
      } else if (deletedIds.has(checkpointId)) {
        warnings.push(
          `Sequence ${line.seq}: ${line.type} references deleted checkpoint ${checkpointId}`,
        );
      }
      if (line.type === 'checkpoint_deleted') deletedIds.add(checkpointId);
    }
  }
}

function extractCheckpointId(line: SessionRecordLine): string | null {
  if (typeof line.payload !== 'object' || line.payload === null) return null;
  const checkpointId =
    'checkpointId' in line.payload ? line.payload.checkpointId : undefined;
  return typeof checkpointId === 'string' ? checkpointId : null;
}

/**
 * Fold checkpoint lifecycle events into a stable view ordered by sequence.
 * Each checkpoint is tracked by stable `checkpointId`. Created events set
 * the name, watermark, and createdAt; renamed events update the name;
 * deleted events set `deleted: true`.
 */
export function foldCheckpointMetadata(
  events: readonly SessionRecordLine[],
): CheckpointMetadataView[] {
  const byId = new Map<string, CheckpointMetadataView>();

  for (const line of events) {
    foldCheckpointLine(line, byId);
  }

  return Array.from(byId.values()).sort((a, b) => a.sequence - b.sequence);
}

function foldCheckpointLine(
  line: SessionRecordLine,
  byId: Map<string, CheckpointMetadataView>,
): void {
  if (typeof line.payload !== 'object' || line.payload === null) return;
  const payload = line.payload;
  const checkpointId =
    'checkpointId' in payload ? payload.checkpointId : undefined;
  if (typeof checkpointId !== 'string' || checkpointId.length === 0) return;
  const existing = byId.get(checkpointId);
  const name = 'name' in payload ? payload.name : undefined;
  if (
    line.type === 'checkpoint_created' &&
    typeof name === 'string' &&
    existing === undefined
  ) {
    byId.set(checkpointId, {
      checkpointId,
      name,
      sequence: line.seq,
      deleted: false,
      createdAt: line.ts,
    });
  } else if (
    line.type === 'checkpoint_renamed' &&
    typeof name === 'string' &&
    existing !== undefined
  ) {
    byId.set(checkpointId, { ...existing, name });
  } else if (line.type === 'checkpoint_deleted' && existing !== undefined) {
    byId.set(checkpointId, { ...existing, deleted: true });
  }
}
