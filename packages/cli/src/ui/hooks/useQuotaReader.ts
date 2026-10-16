/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback } from 'react';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import { useOAuthControl } from '../contexts/OAuthControlContext.js';
import { fetchAllQuotaInfo } from '../commands/statsQuota.js';
import { useBound } from './agentStream/useStreamOwnerCallbacks.js';

export function useQuotaReader(): () => Promise<string[]> {
  const api = useRuntimeApi();
  const oauth = useOAuthControl();
  const readSetting = useBound(api, api.getEphemeralSetting);
  const readProvider = useBound(api, api.getActiveProviderName);
  const detectQuota = useBound(api, api.detectProviderQuota);
  const request = api.fetch;
  const available = useBound(oauth, oauth.isAvailable);
  const readAnthropic = useCallback<Parameters<typeof fetchAllQuotaInfo>[5]>(
    (fetch) => oauth.getAllAnthropicUsageInfo(fetch),
    [oauth],
  );
  const readCodex = useCallback<Parameters<typeof fetchAllQuotaInfo>[6]>(
    (fetch) => oauth.getAllCodexUsageInfo(fetch),
    [oauth],
  );
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
