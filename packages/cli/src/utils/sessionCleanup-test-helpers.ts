/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { type Config } from '@vybestack/llxprt-code-core';
import { SESSION_FILE_PREFIX } from '@vybestack/llxprt-code-storage';
import { type SessionInfo, getAllSessionFiles } from './sessionUtils.js';

vi.mock('fs/promises');
vi.mock('./sessionUtils.js', () => ({
  getAllSessionFiles: vi.fn(),
}));

export const mockFs = vi.mocked(fs);
export const mockGetAllSessionFiles = vi.mocked(getAllSessionFiles);

export type { Config, SessionInfo };

export function createMockConfig(overrides: Partial<Config> = {}): Config {
  return {
    storage: {
      getProjectTempDir: vi.fn().mockReturnValue('/tmp/test-project'),
    },
    getSessionId: vi.fn().mockReturnValue('current123'),
    getDebugMode: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Config;
}

export function createTestSessions(): SessionInfo[] {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return [
    {
      id: 'current123',
      fileName: `${SESSION_FILE_PREFIX}2025-01-20T10-30-00-current12.json`,
      lastUpdated: now.toISOString(),
      isCurrentSession: true,
    },
    {
      id: 'recent456',
      fileName: `${SESSION_FILE_PREFIX}2025-01-18T15-45-00-recent45.json`,
      lastUpdated: oneWeekAgo.toISOString(),
      isCurrentSession: false,
    },
    {
      id: 'old789abc',
      fileName: `${SESSION_FILE_PREFIX}2025-01-10T09-15-00-old789ab.json`,
      lastUpdated: twoWeeksAgo.toISOString(),
      isCurrentSession: false,
    },
    {
      id: 'ancient12',
      fileName: `${SESSION_FILE_PREFIX}2024-12-25T12-00-00-ancient1.json`,
      lastUpdated: oneMonthAgo.toISOString(),
      isCurrentSession: false,
    },
  ];
}
