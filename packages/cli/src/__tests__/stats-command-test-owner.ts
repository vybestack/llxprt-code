/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { fetchAllQuotaInfo } from '../ui/commands/statsQuota.js';

import type { CommandOwnerFixture } from './mockCommandContext.js';

import { createStatsCommand } from '../ui/commands/statsCommand.js';
import { bindStatsCommand } from '../ui/commands/statsCommandHost.js';
import type { SlashCommand } from '../ui/commands/types.js';
export function registerStatsCommand(owner: CommandOwnerFixture): SlashCommand {
  return createStatsCommand(
    bindStatsCommand(
      () =>
        fetchAllQuotaInfo(
          owner.runtimeApi.getEphemeralSetting.bind(owner.runtimeApi),
          owner.runtimeApi.getActiveProviderName.bind(owner.runtimeApi),
          owner.runtimeApi.detectProviderQuota.bind(owner.runtimeApi),
          owner.runtimeApi.fetch,
          owner.oauthControl.isAvailable.bind(owner.oauthControl),
          (request) => owner.oauthControl.getAllAnthropicUsageInfo(request),
          (request) => owner.oauthControl.getAllCodexUsageInfo(request),
        ),
      () => owner.oauthControl.isAvailable(),
      (logger) => owner.oauthControl.discoverBuckets(logger),
      () => owner.session.stats.sessionStartTime,
      owner.ui.addItem,
    ),
  );
}
