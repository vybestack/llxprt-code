/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { getToolKeyStorage } from '@vybestack/llxprt-code-core';
import type { AgentDeps } from './agentImpl.js';
import { ToolControl } from './control/toolControl.js';

export function assembleAgentTools(deps: AgentDeps): ToolControl {
  return new ToolControl({
    taskLaunchOwner: deps.taskLaunchOwner,
    shellOwner: deps.shellOwner,
    childDisplay: deps.loopHolder.childDisplay,
    schedulerFactory: deps.loopHolder.schedulerFactory,
    messageBus: deps.messageBus,
    telemetry: deps.settingsOwner.telemetry,
    config: deps.config,
    selection: deps.sessionClient.toolCatalog.selection,
    readExecutionPolicy: () => deps.settingsOwner.readToolExecutionPolicy(),
    readApprovalMode: () =>
      deps.mcpOperations.trust.isTrustedFolder()
        ? deps.config.getApprovalMode()
        : ApprovalMode.DEFAULT,
    getToolGovernance: () => deps.sessionClient.toolCatalog.readGovernance(),
    setAllowedTools: (names) => deps.settingsOwner.setAllowedTools(names),
    describeConfiguration: () =>
      deps.sessionClient.toolCatalog.describeConfiguration(),
    editorCallbacksHolder: deps.editorCallbacksHolder,
    displayCallbacksHolder: deps.displayCallbacksHolder,
    resolveClient: () => deps.resolveClient(),
    keysDeps: { getStorage: () => getToolKeyStorage() },
  });
}
