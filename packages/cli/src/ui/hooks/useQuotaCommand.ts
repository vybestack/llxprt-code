/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  useDetectProviderQuota,
  useFetch,
  useGetActiveProviderName,
  useGetEphemeralSetting,
} from '../contexts/RuntimeContext.js';

import { useCallback, useMemo } from 'react';
import { useBound } from './agentStream/useStreamOwnerCallbacks.js';

import { useOAuthControl } from '../contexts/OAuthControlContext.js';
import { bindQuotaCommandOperations } from '../commands/credentialCommandHost.js';
import { createQuotaCommand } from '../commands/quotaCommand.js';
import type { SlashCommand } from '../commands/types.js';
import { useQuotaReader } from './useQuotaReader.js';

export function useQuotaCommand(): SlashCommand {
  const apiDetectProviderQuota = useDetectProviderQuota();
  const apiFetch = useFetch();
  const apiGetActiveProviderName = useGetActiveProviderName();
  const apiGetEphemeralSetting = useGetEphemeralSetting();
  const oauth = useOAuthControl();
  const readSetting = apiGetEphemeralSetting;
  const available = useBound(oauth, oauth.isAvailable);
  const readQuota = useQuotaReader(
    readSetting,
    apiGetActiveProviderName,
    apiDetectProviderQuota,
    apiFetch,
    available,
    useBound(oauth, oauth.getAllAnthropicUsageInfo),
    useBound(oauth, oauth.getAllCodexUsageInfo),
  );
  const readCredits = useBound(oauth, oauth.getAllCodexRateLimitResetCredits);
  const hasToken = useBound(oauth, oauth.hasCodexToken);
  const listBuckets = useBound(oauth, oauth.listBuckets);
  const readToken = useBound(oauth, oauth.readCodexBucketToken);
  const baseUrl = useCallback(() => readSetting('base-url'), [readSetting]);
  const request = apiFetch;
  return useMemo(
    () =>
      createQuotaCommand(
        bindQuotaCommandOperations(
          {
            isAvailable: available,
            getAllCodexRateLimitResetCredits: readCredits,
            hasCodexToken: hasToken,
            listBuckets,
            readCodexBucketToken: readToken,
          },
          request,
          baseUrl,
          readQuota,
        ),
      ),
    [
      available,
      readCredits,
      hasToken,
      listBuckets,
      readToken,
      request,
      baseUrl,
      readQuota,
    ],
  );
}
