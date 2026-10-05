/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderFallbackCandidate } from '../providerFallbackCandidate.js';

import type { ProviderContentEnforcementDeps } from '../providerContentEnforcement.js';
import { makeUserMessage } from '../../core/__tests__/chatSession-density-helpers.js';

export const installRestoredFixture: ProviderContentEnforcementDeps['performFallbackCompression'] =
  async (_prompt, install): Promise<boolean> => {
    await installFixtureCandidate(install, [
      makeUserMessage('restored-1'),
      makeUserMessage('restored-2'),
    ]);
    return true;
  };

/** Test-only caller-owned candidates. Production preparation reads pinned disk rows. */
export async function installFixtureCandidate(
  install: (candidate: ProviderFallbackCandidate) => Promise<void>,
  values: readonly IContent[],
): Promise<void> {
  const rows = new HistoryDensityRows();
  try {
    for (const row of values) rows.appendIdentity(row);
    await install({ rows, start: 0, hasPendingRows: true });
  } finally {
    rows.close();
  }
}
