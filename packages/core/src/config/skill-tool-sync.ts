/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { ACTIVATE_SKILL_TOOL_NAME } from '@vybestack/llxprt-code-tools';
import type { WorkspaceTrustReadPort } from '../services/workspace-trust-reader.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { PostSkillDiscoveryToolRegistrar } from './configTypes.js';
import type {
  WorkspaceSkillPublication,
  SkillPolicy,
} from '../skills/workspace-skill-owner.js';
import type { Config } from './config.js';
import { WorkspaceSkillOwner } from '../skills/workspace-skill-owner.js';

export type WorkspaceSkillConfiguration = Pick<
  Config,
  | 'userSkillsDir'
  | 'userAgentSkillsDir'
  | 'projectSkillsDir'
  | 'projectAgentSkillsDir'
  | 'isSkillsSupportEnabled'
  | 'getExtensions'
  | 'getDisabledSkills'
  | 'isAdminSkillsEnabled'
  | 'setDisabledSkills'
  | 'setAdminSkillsEnabled'
>;

export interface WorkspaceSkillAssemblyOperations {
  readonly reloadPolicy: () => Promise<Partial<SkillPolicy>>;
  readonly registerTools: PostSkillDiscoveryToolRegistrar;
}

export function composeWorkspaceSkills(
  config: WorkspaceSkillConfiguration,
  admitDirectory: (directory: string, approved: () => boolean) => () => void,
  notifyDirectoriesChanged: () => void,
  trust: WorkspaceTrustReadPort,
  readMessageBus: () => MessageBus | undefined,
  operations: WorkspaceSkillAssemblyOperations,
  acceptTools: () => {
    readonly registry: Pick<
      ToolRegistry,
      'getTool' | 'registerTool' | 'unregisterTool'
    >;
    readonly publish: () => Promise<void>;
    readonly release: () => void;
  },
  readExtensions: () => ReturnType<Config['getExtensions']> = () =>
    config.getExtensions(),
): WorkspaceSkillOwner {
  return new WorkspaceSkillOwner({
    directories: Object.freeze({
      userSkillsDir: config.userSkillsDir,
      userAgentSkillsDir: config.userAgentSkillsDir,
      projectSkillsDir: config.projectSkillsDir,
      projectAgentSkillsDir: config.projectAgentSkillsDir,
    }),
    enabled: () => config.isSkillsSupportEnabled(),
    readExtensions,
    readPolicy: () => ({
      disabledSkills: config.getDisabledSkills(),
      adminSkillsEnabled: config.isAdminSkillsEnabled(),
    }),
    applyPolicy: (policy) => {
      config.setDisabledSkills(policy.disabledSkills);
      config.setAdminSkillsEnabled(policy.adminSkillsEnabled);
    },
    reloadPolicy: operations.reloadPolicy,
    isTrusted: () => trust.isTrustedFolder(),
    addDirectory: admitDirectory,
    notifyDirectoriesChanged,
    acceptPublication: (): WorkspaceSkillPublication => {
      const accepted = acceptTools();
      return {
        publish: accepted.publish,
        release: accepted.release,
        rebuild: (service) => {
          const registry = accepted.registry;
          if (!config.isSkillsSupportEnabled()) return () => {};
          const registrar = operations.registerTools;
          const messageBus = readMessageBus();
          if (!messageBus)
            throw new Error('Missing workspace skill MessageBus');
          const previous = registry.getTool(ACTIVATE_SKILL_TOOL_NAME);
          const rollback = (): void => {
            registry.unregisterTool(ACTIVATE_SKILL_TOOL_NAME);
            if (previous) registry.registerTool(previous);
          };
          try {
            registrar(registry, service, messageBus);
          } catch (error) {
            rollback();
            throw error;
          }
          return rollback;
        },
      };
    },
  });
}
