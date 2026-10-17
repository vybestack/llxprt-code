/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export function getInteractiveTranscriptPath(
  recordingOwner: 'agent' | 'raw' | undefined,
  readOwnedPath: () => string | undefined,
  readRawPath: () => string | undefined,
): string | undefined {
  return recordingOwner === 'agent' ? readOwnedPath() : readRawPath();
}
