/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IGitStatsService, GitStats } from '@vybestack/llxprt-code-core';
import { GitStatsTracker, type GitStatsConfig } from './git-stats.js';

/**
 * Implementation of IGitStatsService using GitStatsTracker
 */
export class GitStatsServiceImpl implements IGitStatsService {
  private tracker: GitStatsTracker;

  constructor(config: GitStatsConfig) {
    this.tracker = new GitStatsTracker(config);
  }

  async trackFileEdit(
    filePath: string,
    oldContent: string,
    newContent: string,
  ): Promise<GitStats | null> {
    return this.tracker.trackFileEdit(filePath, oldContent, newContent);
  }

  /**
   * Get the underlying GitStatsTracker for CLI-specific operations
   */
  getTracker(): GitStatsTracker {
    return this.tracker;
  }
}
