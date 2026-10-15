/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import type { SessionClientOwner } from '../../../session/session-client-owner.js';
import type { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import type { ProviderActivationIntent } from '../../config-types.js';
import type {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
} from '../../preferred-provider-acquisition.js';
import { preparePreferredProviderCompletion } from '../../preferred-provider-acquisition.js';
import { executeProviderActivation } from '../../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../providerSwitchAssembly.js';
import { assembleModelSelection } from '../../model-selection.js';
import { cleanupAfterFailure } from '../../../core/subagent-cleanup.js';

export async function initializeCallerClient(
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  manager: ReturnType<typeof acquirePreferredProviderManager>,
  oauth: ReturnType<typeof acquirePreferredOAuth>,
  runtimeId: string,
  tokenizer: ReturnType<
    typeof configureProviderRuntimeFactories
  >['tokenizerFactory'],
  mcp: McpRuntimeOwner,
  owner: SessionClientOwner,
  intent: ProviderActivationIntent,
  close: () => Promise<void>,
): Promise<void> {
  try {
    await preparePreferredProviderCompletion(
      config,
      settings,
      settingsOwner,
      manager,
      oauth,
      runtimeId,
      tokenizer,
    );
    await mcp.initialize();
    const activation = await executeProviderActivation(
      config,
      intent,
      assembleProviderSwitch(
        config,
        settings,
        manager,
        oauth,
        () => 'agent',
        () => owner.refreshAuth(),
        settingsOwner,
      ),
      settings,
      manager,
      (method) => owner.refreshAuth(method),
      assembleModelSelection(settingsOwner),
    );
    if (activation.authFailed) throw activation.authError;
    await owner.initializeTools();
    await owner.getAgentClient().startChat();
  } catch (primary) {
    await cleanupAfterFailure(primary, close);
  }
}
