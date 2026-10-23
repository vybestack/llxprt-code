/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TurnToolExecutionOwner } from '../../../agents/src/session/turn-tool-execution-owner.js';
import { bindSchedulerOwner } from '../../../agents/src/session/assembleSchedulerOwner.js';
import { CoreToolScheduler } from '../../../agents/src/core/coreToolScheduler.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type { createAgenticLoop } from '@vybestack/llxprt-code-agents';

export function createLoopToolAcquisition(
  config: Config,
  settingsOwner: SessionSettingsOwner,
  messageBus: MessageBus,
  toolSelection: ToolSelection,
  interactive: boolean,
): Parameters<typeof createAgenticLoop>[0]['acquireTools'] {
  return (decorateScheduler) =>
    new TurnToolExecutionOwner(
      messageBus,
      undefined,
      bindSchedulerOwner(
        config,
        messageBus,
        interactive,
        toolSelection,
        decorateScheduler((options) => new CoreToolScheduler(options)),
        () => settingsOwner.readToolExecutionPolicy(),
        () => settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
        undefined,
        settingsOwner.telemetry,
      ),
    );
}
