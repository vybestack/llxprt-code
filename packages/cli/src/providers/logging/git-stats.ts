/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '@vybestack/llxprt-code-core';

export interface GitStats {
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
}

export interface DiffStats {
  linesAdded: number;
  linesRemoved: number;
}

export interface SessionStats {
  filesChanged: Set<string>;
  totalLinesAdded: number;
  totalLinesRemoved: number;
}

export interface SessionSummary {
  filesChanged: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  sessionId: string;
}

export interface LogEntry {
  type: string;
  stats: GitStats;
  timestamp: string;
}

export class GitStatsTracker {
  private enabled: boolean;
  private sessionStats: SessionStats;

  constructor(private config: Config) {
    // Handle invalid config gracefully
    try {
      this.enabled = this.config?.getConversationLoggingEnabled?.() ?? false;
    } catch (_error) {
      this.enabled = false;
    }

    this.sessionStats = {
      filesChanged: new Set<string>(),
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    };
  }

  async trackFileEdit(
    filePath: string,
    oldContent: string,
    newContent: string,
  ): Promise<GitStats | null> {
    // Check current config state for each call (runtime toggle support)
    if (!this.isEnabled()) {
      return null;
    }

    // Handle null/undefined content gracefully
    if (oldContent === null || oldContent === undefined) {
      oldContent = '';
    }
    if (newContent === null || newContent === undefined) {
      newContent = '';
    }

    // Handle invalid file paths gracefully
    if (!filePath || typeof filePath !== 'string') {
      return null;
    }

    // Calculate diff statistics
    const stats = this.calculateStats(oldContent, newContent);

    // Update session stats
    this.sessionStats.filesChanged.add(filePath);
    this.sessionStats.totalLinesAdded += stats.linesAdded;
    this.sessionStats.totalLinesRemoved += stats.linesRemoved;

    // Return stats for logging
    return {
      ...stats,
      filesChanged: this.sessionStats.filesChanged.size,
    };
  }

  private calculateStats(oldContent: string, newContent: string): DiffStats {
    // Handle empty content explicitly
    if (oldContent === '' && newContent === '') {
      return { linesAdded: 0, linesRemoved: 0 };
    }

    // Split content into lines, treating empty string as no lines
    const oldLines = oldContent === '' ? [] : oldContent.split('\n');
    const newLines = newContent === '' ? [] : newContent.split('\n');

    // If same content, no changes
    if (oldContent === newContent) {
      return { linesAdded: 0, linesRemoved: 0 };
    }

    // Count changes line by line and calculate adds/removes
    let added = 0;
    let removed = 0;

    // Find common lines and differences
    const minLength = Math.min(oldLines.length, newLines.length);

    // Count changed lines in the common range
    for (let i = 0; i < minLength; i++) {
      if (oldLines[i] !== newLines[i]) {
        // Line changed - count as both add and remove
        added++;
        removed++;
      }
    }

    // Add extra lines (if new is longer)
    if (newLines.length > oldLines.length) {
      added += newLines.length - oldLines.length;
    }

    // Remove missing lines (if old is longer)
    if (oldLines.length > newLines.length) {
      removed += oldLines.length - newLines.length;
    }

    return {
      linesAdded: added,
      linesRemoved: removed,
    };
  }

  isEnabled(): boolean {
    // Update enabled state based on current config
    try {
      this.enabled = this.config?.getConversationLoggingEnabled?.() ?? false;
    } catch (_error) {
      this.enabled = false;
    }
    return this.enabled;
  }

  hasComplexSettings(): boolean {
    // This tracker intentionally has no complex settings - simple on/off only
    return false;
  }

  getLogEntry(): LogEntry | null {
    if (!this.isEnabled()) {
      return null;
    }

    // Return the current session stats as a log entry
    return {
      type: 'git_stats',
      stats: {
        linesAdded: this.sessionStats.totalLinesAdded,
        linesRemoved: this.sessionStats.totalLinesRemoved,
        filesChanged: this.sessionStats.filesChanged.size,
      },
      timestamp: new Date().toISOString(),
    };
  }

  getSummary(): SessionSummary {
    let sessionId = '';
    try {
      sessionId = this.config?.getSessionId?.() ?? '';
    } catch (_error) {
      sessionId = '';
    }

    return {
      filesChanged: this.sessionStats.filesChanged.size,
      totalLinesAdded: this.sessionStats.totalLinesAdded,
      totalLinesRemoved: this.sessionStats.totalLinesRemoved,
      sessionId,
    };
  }
}
