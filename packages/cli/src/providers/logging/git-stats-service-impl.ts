/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IGitStatsService, GitStats } from '@vybestack/llxprt-code-core';
import { GitStatsTracker } from './git-stats.js';
import { Config } from '@vybestack/llxprt-code-core';

/**
 * Implementation of IGitStatsService using GitStatsTracker
 */
export class GitStatsServiceImpl implements IGitStatsService {
  private tracker: GitStatsTracker;

  constructor(config: Config) {
    this.tracker = new GitStatsTracker(config);
  }

  async trackFileEdit(
    filePath: string,
    oldContent: string,
    newContent: string
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