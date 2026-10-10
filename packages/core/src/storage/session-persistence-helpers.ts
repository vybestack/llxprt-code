/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DebugLogger } from '../debug/index.js';
import type { IContent } from '../services/history/IContent.js';
import { MediaAdmissionError } from './media-admission-service.js';
import { MediaReferenceValidationError } from './media-reference-lifecycle.js';
import type {
  PersistedSession,
  PersistedUIHistoryItem,
} from './SessionPersistenceService.js';

const MAX_MEDIA_DIAGNOSTIC_DEPTH = 32;

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? Reflect.get(error, 'code')
    : undefined;
}

export function containsMediaDiagnostic(
  error: unknown,
  seen: Set<object> = new Set<object>(),
  depth = 0,
): boolean {
  if (
    error instanceof MediaReferenceValidationError ||
    error instanceof MediaAdmissionError
  ) {
    return true;
  }
  if (
    depth >= MAX_MEDIA_DIAGNOSTIC_DEPTH ||
    typeof error !== 'object' ||
    error === null ||
    seen.has(error)
  ) {
    return false;
  }
  seen.add(error);
  const nested = Reflect.get(error, 'errors');
  return (
    (isUnknownArray(nested) &&
      nested.some((entry) =>
        containsMediaDiagnostic(entry, seen, depth + 1),
      )) ||
    containsMediaDiagnostic(Reflect.get(error, 'cause'), seen, depth + 1)
  );
}

function serializedStringContentLowerBound(
  value: unknown,
  visited: Set<object>,
): number {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  if (typeof value !== 'object' || value === null || visited.has(value)) {
    return 0;
  }
  visited.add(value);
  return Object.values(value).reduce(
    (bytes, nested) =>
      Math.min(
        Number.MAX_SAFE_INTEGER,
        bytes + serializedStringContentLowerBound(nested, visited),
      ),
    0,
  );
}

export function persistenceRequestLowerBound(
  history: readonly IContent[],
  metadata: PersistedSession['metadata'] | undefined,
  uiHistory: readonly PersistedUIHistoryItem[] | undefined,
): number {
  return serializedStringContentLowerBound(
    [history, metadata, uiHistory],
    new Set<object>(),
  );
}

export function enforcePendingPersistenceBytes(
  bytes: number,
  maxBytes: number,
  pendingBytes: number,
): void {
  if (bytes > maxBytes - pendingBytes)
    throw new Error(
      `Session persistence queue byte limit exceeded: ${pendingBytes} + ${bytes} > ${maxBytes}`,
    );
}

export async function collectPersistenceCleanupFailure(
  failures: unknown[],
  cleanup: () => Promise<void>,
): Promise<boolean> {
  try {
    await cleanup();
    return true;
  } catch (error: unknown) {
    failures.push(error);
    return false;
  }
}

export function preflightPersistenceRequest(
  history: readonly IContent[],
  metadata: PersistedSession['metadata'] | undefined,
  uiHistory: readonly PersistedUIHistoryItem[] | undefined,
  maxQueueBytes: number,
  pendingBytes: number,
): void {
  const lowerBound = persistenceRequestLowerBound(history, metadata, uiHistory);
  if (lowerBound > maxQueueBytes - pendingBytes)
    throw new Error(
      `Session persistence queue byte limit exceeded: ${pendingBytes} + at least ${lowerBound} > ${maxQueueBytes}`,
    );
}

export async function backupCorruptedPersistence(
  chatsDir: string,
): Promise<void> {
  const logger = new DebugLogger('llxprt:session:persistence');
  try {
    const files = await fs.promises.readdir(chatsDir);
    const sessionFiles = files
      .filter((f) => f.startsWith('persisted-session-') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (sessionFiles.length > 0) {
      const corruptedFile = path.join(chatsDir, sessionFiles[0]);
      const backupFile = `${corruptedFile}.corrupted-${Date.now()}`;
      await fs.promises.rename(corruptedFile, backupFile);
      logger.warn('Backed up corrupted session to:', backupFile);
    }
  } catch (backupError) {
    logger.error('Failed to backup corrupted session:', backupError);
  }
}
export function pendingPersistenceAccounting(
  serialized: string,
  accountedBytes: number,
  maxQueueBytes: number,
  pendingBytes: number,
): { serializedBytes: number; accountingDelta: number } {
  const serializedBytes = Buffer.byteLength(serialized, 'utf8');
  const accountingDelta = serializedBytes - accountedBytes;
  enforcePendingPersistenceBytes(accountingDelta, maxQueueBytes, pendingBytes);
  return { serializedBytes, accountingDelta };
}

export function savedPersistenceSummary(
  path: string,
  history: readonly IContent[],
  state: {
    readonly generation: number;
    readonly metadata: PersistedSession['metadata'] | undefined;
  },
): {
  path: string;
  historyLength: number;
  generation: number;
  metadata: PersistedSession['metadata'] | undefined;
} {
  return {
    path,
    historyLength: history.length,
    generation: state.generation,
    metadata: state.metadata,
  };
}
