/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  composeWorkspaceSkills,
  type WorkspaceSkillAssemblyOperations,
} from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import type { WorkspaceSkillOwner } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type {
  WorkspaceToolCatalogOwner,
  WorkspaceTrustControlPort,
  Config,
} from '@vybestack/llxprt-code-core';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type { McpConstructionResources } from './mcp-construction-resources.js';
import type { SessionClientHookBinding } from './session-hook-binding.js';

export const DEFAULT_SKILL_OPERATIONS: WorkspaceSkillAssemblyOperations = {
  reloadPolicy: async () => ({}),
  registerTools: registerActivateSkillTool,
};

import { registerActivateSkillTool } from '../skill-tool-registrar.js';
import type { WorkspaceExtensionOwner } from '@vybestack/llxprt-code-core/utils/workspace-extension-owner.js';

export function assembleWorkspaceSkills(
  resources: McpConstructionResources,
  config: Config,
  filesystem: WorkspaceFilesystemOwner,
  tools: WorkspaceToolCatalogOwner,
  trust: WorkspaceTrustControlPort,
  readMessageBus: () => MessageBus,
  readBindings: () => readonly SessionClientHookBinding[],
  operations: WorkspaceSkillAssemblyOperations,
  readExtensions: () => ReturnType<Config['getExtensions']>,
): WorkspaceSkillOwner {
  const skills = composeWorkspaceSkills(
    config,
    (directory, approved) =>
      filesystem.admitSkillDirectory(directory, approved),
    () => filesystem.notifyTrustChanged(),
    trust,
    () => readMessageBus(),
    operations,
    () => {
      const catalog = tools.acceptSkillPublication();
      const clients = new Set<AgentClientContract>();
      const publishers: Array<
        (
          declarations: ReturnType<ToolSelection['getFunctionDeclarations']>,
        ) => Promise<void>
      > = [];
      const failures: unknown[] = [];
      for (const binding of readBindings()) {
        try {
          const client = binding.readClient();
          if (clients.has(client)) continue;
          clients.add(client);
          if (binding.acceptSkillPublication === undefined)
            throw new Error(
              'Session binding lacks skill publication admission',
            );
          publishers.push(binding.acceptSkillPublication());
        } catch (error) {
          failures.push(error);
        }
      }
      return {
        registry: catalog.registry,
        publish: async () => {
          const errors = [...failures];
          for (const publish of publishers) {
            try {
              await publish(catalog.declarations());
            } catch (error) {
              errors.push(error);
            }
          }
          if (errors.length === 1) throw errors[0];
          if (errors.length > 1)
            throw new AggregateError(
              errors,
              'Skill session publication failed',
            );
        },
        release: catalog.release,
      };
    },
    readExtensions,
  );
  resources.retain(() => skills.dispose());
  return skills;
}

export function assembleWorkspaceSkillsAndExtensions(
  resources: McpConstructionResources,
  config: Config,
  filesystem: WorkspaceFilesystemOwner,
  tools: WorkspaceToolCatalogOwner,
  trust: WorkspaceTrustControlPort,
  readMessageBus: () => MessageBus,
  readBindings: () => readonly SessionClientHookBinding[],
  operations: WorkspaceSkillAssemblyOperations,
  assembleExtensions: () => WorkspaceExtensionOwner,
  readExtensions: () => ReturnType<Config['getExtensions']>,
): [WorkspaceSkillOwner, WorkspaceExtensionOwner] {
  const skills = assembleWorkspaceSkills(
    resources,
    config,
    filesystem,
    tools,
    trust,
    readMessageBus,
    readBindings,
    operations,
    readExtensions,
  );
  const extensions = assembleExtensions();
  resources.retain(() => extensions.dispose());
  return [skills, extensions];
}
