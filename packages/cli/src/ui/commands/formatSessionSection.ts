/**
 * Formats session recording metadata for display in /stats command
 *
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20260214-SESSIONBROWSER.P24, PLAN-20260214-SESSIONBROWSER.P26
 * @requirement REQ-ST-001, REQ-ST-002, REQ-ST-003, REQ-ST-004, REQ-ST-005, REQ-ST-006
 */

import { stat } from 'node:fs/promises';
import type { SessionRecordingMetadata } from '../types/SessionRecordingMetadata.js';
import { formatRelativeTime } from '../../utils/formatRelativeTime.js';

/**
 * Formats a byte count into a human-readable string.
 *
 * @param bytes - The number of bytes
 * @returns A formatted string like "1.2 KB" or "34 bytes"
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P26
 * @requirement REQ-ST-004
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} bytes`;
  }
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb.toFixed(1)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

/**
 * Formats session recording metadata into display lines for the /stats command.
 *
 * @param metadata - The session recording metadata, or null if no session is active
 * @returns Array of formatted strings for display
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P24, PLAN-20260214-SESSIONBROWSER.P26
 * @requirement REQ-ST-001, REQ-ST-002, REQ-ST-003, REQ-ST-004, REQ-ST-005, REQ-ST-006
 */
export async function formatSessionSection(
  metadata: SessionRecordingMetadata | null,
): Promise<string[]> {
  const lines: string[] = ['Session:'];

  // REQ-ST-006: Handle null metadata
  if (metadata === null) {
    lines.push('  No active session recording.');
    return lines;
  }

  // REQ-ST-002: Session ID (truncate to 12 chars)
  const truncatedId =
    metadata.sessionId.length > 12
      ? metadata.sessionId.substring(0, 12)
      : metadata.sessionId;
  lines.push(`  ID: ${truncatedId}`);

  // REQ-ST-003: Start time as relative time
  const startDate = new Date(metadata.startTime);
  const relativeTime = formatRelativeTime(startDate);
  lines.push(`  Started: ${relativeTime}`);

  // REQ-ST-004: File size (handle missing files gracefully)
  if (metadata.filePath) {
    try {
      const stats = await stat(metadata.filePath);
      const formattedSize = formatFileSize(stats.size);
      lines.push(`  File size: ${formattedSize}`);
    } catch {
      // File doesn't exist or can't be read - omit file size line
    }
  }

  // REQ-ST-005: Resumed status
  const resumedValue = metadata.isResumed ? 'yes' : 'no';
  lines.push(`  Resumed: ${resumedValue}`);

  return lines;
}
