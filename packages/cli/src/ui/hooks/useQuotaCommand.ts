/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import { useOAuthControl } from '../contexts/OAuthControlContext.js';
import { bindQuotaCommandOperations } from '../commands/credentialCommandHost.js';
import { createQuotaCommand } from '../commands/quotaCommand.js';
import type { SlashCommand } from '../commands/types.js';
import { useQuotaReader } from './useQuotaReader.js';

export function useQuotaCommand(): SlashCommand {
  const api = useRuntimeApi();
  const oauth = useOAuthControl();
  const readQuota = useQuotaReader();
  return useMemo(
    () =>
      createQuotaCommand(
        bindQuotaCommandOperations(
          {
            isAvailable: () => oauth.isAvailable(),
            getAllCodexRateLimitResetCredits: (request) =>
              oauth.getAllCodexRateLimitResetCredits(request),
            hasCodexToken: () => oauth.hasCodexToken(),
            listBuckets: (provider) => oauth.listBuckets(provider),
            readCodexBucketToken: (bucket) =>
              oauth.readCodexBucketToken(bucket),
          },
          api.fetch,
          () => api.getEphemeralSetting('base-url'),
          readQuota,
        ),
      ),
    [api, oauth, readQuota],
  );
}
