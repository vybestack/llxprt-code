/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Config,
  discoverSkillsForConfig,
  type LlxprtExtension,
  type MCPServerConfig,
  type SkillDefinition,
} from '@vybestack/llxprt-code-core';
import type { McpOAuthBinding } from '@vybestack/llxprt-code-mcp';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../core/subagent-cleanup.js';
import { McpRuntimeOwner } from './mcpRuntimeAssembly.js';

export interface SkillDiscoveryIntent {
  readonly workingDir: string;
  readonly debugMode?: boolean;
  readonly trustedFolder?: boolean;
  readonly skillsEnabled?: boolean;
  readonly disabledSkills?: readonly string[];
  readonly adminSkillsEnabled?: boolean;
  readonly extensions?: readonly LlxprtExtension[];
  readonly mcpEnabled?: boolean;
  readonly mcpServers?: Readonly<Record<string, MCPServerConfig>>;
  readonly mcpServerCommand?: string;
  readonly allowedMcpServers?: readonly string[];
  readonly blockedMcpServers?: ReadonlyArray<{
    name: string;
    extensionName: string;
  }>;
  readonly includeDirectories?: readonly string[];
  readonly initialSettings?: Readonly<Record<string, unknown>>;
}

export interface SkillDiscoveryHost {
  readonly oauth: McpOAuthBinding;
}

export async function discoverAgentSkills(
  intent: SkillDiscoveryIntent,
  host: SkillDiscoveryHost,
): Promise<SkillDefinition[]> {
  const config = new Config({
    sessionId: crypto.randomUUID(),
    cwd: intent.workingDir,
    targetDir: intent.workingDir,
    model: 'skill-discovery',
    debugMode: intent.debugMode ?? false,
    trustedFolder: intent.trustedFolder,
    skillsSupport: intent.skillsEnabled,
    disabledSkills: intent.disabledSkills?.slice(),
    adminSkillsEnabled: intent.adminSkillsEnabled,
    extensions: intent.extensions?.slice(),
    mcpEnabled: intent.mcpEnabled,
    mcpServers: intent.mcpServers,
    mcpServerCommand: intent.mcpServerCommand,
    allowedMcpServers: intent.allowedMcpServers?.slice(),
    blockedMcpServers: intent.blockedMcpServers?.slice(),
    includeDirectories: intent.includeDirectories?.slice(),
    initialSettings: intent.initialSettings,
    telemetry: { enabled: false },
    enableHooks: false,
    coreTools: [],
  });
  let runtime: McpRuntimeOwner;
  try {
    runtime = await McpRuntimeOwner.create(host.oauth, config);
  } catch (error) {
    return cleanupAfterFailure(error, () => config.dispose());
  }
  const close = (): Promise<void> =>
    runCleanupSteps([() => runtime.dispose(), () => config.dispose()]);
  let skills: SkillDefinition[];
  try {
    skills = await discoverSkillsForConfig(
      { list: (all) => runtime.workspaceSkills.operations.list(all) },
      () => runtime.initialize(),
    );
  } catch (error) {
    return cleanupAfterFailure(error, close);
  }
  await close();
  return skills;
}
