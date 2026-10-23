/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback } from 'react';
import { fetchAllQuotaInfo } from '../commands/statsQuota.js';

export function useQuotaReader(
  readSetting: Parameters<typeof fetchAllQuotaInfo>[0],
  readProvider: Parameters<typeof fetchAllQuotaInfo>[1],
  detectQuota: Parameters<typeof fetchAllQuotaInfo>[2],
  request: Parameters<typeof fetchAllQuotaInfo>[3],
  available: Parameters<typeof fetchAllQuotaInfo>[4],
  readAnthropic: Parameters<typeof fetchAllQuotaInfo>[5],
  readCodex: Parameters<typeof fetchAllQuotaInfo>[6],
): () => Promise<string[]> {
  return useCallback(
    () =>
      fetchAllQuotaInfo(
        readSetting,
        readProvider,
        detectQuota,
        request,
        available,
        readAnthropic,
        readCodex,
      ),
    [
      readSetting,
      readProvider,
      detectQuota,
      request,
      available,
      readAnthropic,
      readCodex,
    ],
  );
}
