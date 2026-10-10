import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageOperationRunner } from '@vybestack/llxprt-code-core/services/image/imageCapability.js';
import type { GitHubReportOperations } from '@vybestack/llxprt-code-tools';

import type { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import type {
  ProfileDefinitionReads,
  SubagentDefinitionReads,
} from '@vybestack/llxprt-code-core';
import type {
  TaskExecutionPolicy,
  SubagentRunPolicy,
} from '@vybestack/llxprt-code-core/session/session-settings-policies.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ToolExecutionPolicy } from '@vybestack/llxprt-code-tools';
import type { RegistryPolicy } from '@vybestack/llxprt-code-tools';
import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import {
  ToolRegistry,
  type AnyDeclarativeTool,
  type ToolSelection,
  type ToolPublication,
} from '@vybestack/llxprt-code-tools';
import {
  isToolBlocked,
  applyTaskSchemaPolicy,
} from '@vybestack/llxprt-code-tools';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { createToolRegistry } from '@vybestack/llxprt-code-core/config/toolRegistryFactory.js';
import type { TaskToolRegistration } from '@vybestack/llxprt-code-core/config/toolRegistryFactory.js';
import { ToolDispatchAdmission } from '@vybestack/llxprt-code-core';
import {
  DiscoveredMCPTool,
  type McpApprovalPolicy,
} from '@vybestack/llxprt-code-mcp';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import { CoreToolRegistryHostAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreToolRegistryHostAdapter.js';
import type { McpRuntimeOwner } from '../api/mcpRuntimeAssembly.js';

type ConfigurationEntry = {
  readonly displayName: string;
  readonly isRegistered: boolean;
  readonly reason?: string;
};

export class SessionToolCatalogOwner {
  private readonly admission = new ToolDispatchAdmission();
  private closed = false;
  private workspaceStopped: () => boolean = () => false;
  private builtins: ToolRegistry | undefined;
  private workspace: ToolSelection | undefined;
  private initialization: Promise<void> | undefined;
  private configuration: readonly ConfigurationEntry[] = [];
  private sessionApproval: McpApprovalPolicy | undefined;
  private sessionBus: CoreMessageBusAdapter | undefined;
  readonly selection: ToolSelection = {
    getTool: (name, context) => {
      const tool = this.resolve(name, context);
      return tool === undefined ? undefined : this.bind(tool);
    },
    getAllToolNames: () => this.allTools().map((tool) => tool.name),
    getAllTools: () => this.allTools().map((tool) => this.bind(tool)),
    getEnabledTools: () =>
      this.allTools()
        .filter((tool) => this.available(tool.name))
        .map((tool) => this.bind(tool)),
    getFunctionDeclarations: () => this.declarations(),
    getFunctionDeclarationsFiltered: (names) => this.declarations(names),
  };

  constructor(
    private readonly config: Config,
    private readonly readTaskSchemaPolicy: () => RegistryPolicy,
    private readonly readExecutionPolicy: () => ToolExecutionPolicy,
  ) {}

  private imageOperation: ImageOperationRunner | undefined;
  bindImageOperation(operation: ImageOperationRunner): void {
    this.admission.assertOpen();
    if (this.initialization !== undefined)
      throw new Error('Images must be assembled before tool initialization');
    if (this.imageOperation !== undefined)
      throw new Error('Session images are already composed');
    this.imageOperation = operation;
  }

  private githubReports: GitHubReportOperations | undefined;
  bindGitHubReports(reports: GitHubReportOperations): void {
    this.admission.assertOpen();
    if (this.initialization !== undefined)
      throw new Error(
        'GitHub reports must be assembled before tool initialization',
      );
    if (this.githubReports !== undefined)
      throw new Error('GitHub reports are already composed');
    this.githubReports = reports;
  }

  describeConfiguration(): {
    registered: Array<{ displayName: string }>;
    unregistered: Array<{ displayName: string; reason?: string }>;
  } {
    this.admission.assertOpen();
    return {
      registered: this.configuration
        .filter((tool) => tool.isRegistered)
        .map(({ displayName }) => ({ displayName })),
      unregistered: this.configuration
        .filter((tool) => !tool.isRegistered)
        .map(({ displayName, reason }) => ({ displayName, reason })),
    };
  }

  initialize(
    workspace: McpRuntimeOwner,
    bus: MessageBus,
    registration: TaskToolRegistration,
    summarize: Parameters<typeof createToolRegistry>[9],
    approval: McpApprovalPolicy,
    instructions: InstructionReadOperations,
    createChildSettings: () => SettingsService,
    readTaskPolicy: () => TaskExecutionPolicy,
    readRunPolicy: () => SubagentRunPolicy,
    profiles: ProfileDefinitionReads = workspace.profileDefinitions,
    subagents: SubagentDefinitionReads = workspace.subagentDefinitions,
    hookOwner?: SessionHookOwner,
    telemetry?: RootTelemetry,
  ): Promise<void> {
    this.admission.assertOpen();
    this.workspaceStopped = () => workspace.isStopped();
    this.sessionApproval = approval;
    this.sessionBus = new CoreMessageBusAdapter(bus);
    this.initialization ??= createToolRegistry(
      this.config,
      this.config,
      bus,
      this.readTaskSchemaPolicy,
      this.readExecutionPolicy,
      workspace.workspacePaths,
      workspace.workspaceFiles,
      workspace.workspaceIgnore,
      workspace.workspaceScans,
      summarize,
      workspace.workspaceLsp.diagnostics,
      {
        ...registration,
        create: (config, args) =>
          registration.create(config, {
            ...args,
            toolSelection: this.selection,
            hookOwner,
            workspaceTrust: workspace.trust,
            instructions,
            createChildSettings,
            telemetry,
            readTaskPolicy,
            readRunPolicy,
            readGovernance: () => this.readGovernance(),
          }),
      },
      workspace.readInstructions,
      false,
      profiles,
      subagents,
      workspace.ide,
      workspace.trust,
      this.githubReports,
      this.imageOperation,
      telemetry,
    ).then(({ registry, allPotentialTools }) => {
      this.admission.assertOpen();
      this.configuration = allPotentialTools.map(
        ({ displayName, isRegistered, reason }) => ({
          displayName,
          isRegistered,
          reason,
        }),
      );
      this.builtins = registry;
      this.workspace = workspace.toolSelection;
    });
    return this.initialization;
  }

  initializeInherited(
    selection: ToolSelection,
    bus: MessageBus,
    trust?: McpRuntimeOwner['trust'],
  ): Promise<void> {
    this.admission.assertOpen();
    this.initialization ??= Promise.resolve().then(() => {
      this.admission.assertOpen();
      this.builtins = new ToolRegistry(
        new CoreToolRegistryHostAdapter(this.config, trust),
        new CoreMessageBusAdapter(bus),
        this.readTaskSchemaPolicy,
      );
      this.workspace = selection;
    });
    return this.initialization;
  }

  private catalogs(): { builtins: ToolRegistry; workspace: ToolSelection } {
    if (this.closed) throw new Error('Session tool selection is closed');
    if (this.builtins === undefined || this.workspace === undefined)
      throw new Error('Session tools are not initialized');
    return { builtins: this.builtins, workspace: this.workspace };
  }

  private allTools(): AnyDeclarativeTool[] {
    const { builtins, workspace } = this.catalogs();
    const tools = new Map(
      builtins.getAllTools().map((tool) => [tool.name, tool]),
    );
    for (const tool of workspace.getAllTools()) {
      if (
        (tool.name === 'task' || tool.name === 'run_shell_command') &&
        tools.has(tool.name)
      )
        throw new Error(`Workspace cannot replace session tool '${tool.name}'`);
      tools.set(tool.name, tool);
    }
    return [...tools.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    );
  }

  private resolve(
    name: string,
    context?: Parameters<ToolSelection['getTool']>[1],
  ): AnyDeclarativeTool | undefined {
    const { builtins, workspace } = this.catalogs();
    const tool = workspace.getTool(name) ?? builtins.getTool(name, context);
    if (tool === undefined || !this.available(tool.name)) return undefined;
    return tool;
  }

  readGovernance() {
    return this.readTaskSchemaPolicy().governance;
  }

  private available(name: string): boolean {
    return !isToolBlocked(name, this.readTaskSchemaPolicy().governance);
  }

  acceptSkillPublication(): (
    workspace: ReturnType<ToolSelection['getFunctionDeclarations']>,
  ) => ReturnType<ToolSelection['getFunctionDeclarations']> {
    const { builtins } = this.catalogs();
    return (workspace) => {
      const declarations = new Map(
        builtins.getFunctionDeclarations().map((entry) => [entry.name, entry]),
      );
      for (const entry of workspace) {
        if (entry.name === 'task' || entry.name === 'run_shell_command')
          throw new Error(
            `Workspace cannot replace session tool '${entry.name}'`,
          );
        declarations.set(entry.name, entry);
      }
      return structuredClone([...declarations.values()])
        .filter(
          (entry) => entry.name !== undefined && this.available(entry.name),
        )
        .map((entry) =>
          applyTaskSchemaPolicy(entry, this.readTaskSchemaPolicy()),
        );
    };
  }

  private declarations(
    names?: string[],
  ): ReturnType<ToolSelection['getFunctionDeclarations']> {
    const { builtins, workspace } = this.catalogs();
    const select = (
      catalog: ToolSelection,
    ): ReturnType<ToolSelection['getFunctionDeclarations']> =>
      names === undefined
        ? catalog.getFunctionDeclarations()
        : catalog.getFunctionDeclarationsFiltered(names);
    const declarations = new Map(
      select(builtins).map((declaration) => [declaration.name, declaration]),
    );
    for (const declaration of select(workspace))
      declarations.set(declaration.name, declaration);
    return structuredClone(
      [...declarations.values()].filter(
        (declaration) =>
          declaration.name !== undefined && this.available(declaration.name),
      ),
    ).map((declaration) =>
      applyTaskSchemaPolicy(declaration, this.readTaskSchemaPolicy()),
    );
  }

  private bind(tool: AnyDeclarativeTool): AnyDeclarativeTool {
    const { builtins } = this.catalogs();
    const builtin = builtins.getAllTools().includes(tool);
    const executable =
      tool instanceof DiscoveredMCPTool && this.sessionApproval !== undefined
        ? this.bindMcpApproval(tool)
        : tool;
    return this.admission.bind(executable, () => {
      if (this.workspaceStopped())
        throw new Error('Tool dispatch admission is closed');
      const current = this.resolve(tool.name);
      return builtin ? current === tool : current !== undefined;
    });
  }

  private bindMcpApproval(tool: DiscoveredMCPTool): AnyDeclarativeTool {
    if (this.sessionApproval === undefined || this.sessionBus === undefined)
      throw new Error('Missing session MCP approval composition');
    return tool.withSessionApproval(this.sessionApproval, this.sessionBus);
  }

  prepareTools(
    prepare: (
      tools: Pick<ToolSelection, 'getAllTools'> & ToolPublication,
    ) => void,
  ): void {
    const { builtins } = this.catalogs();
    prepare({
      getAllTools: this.selection.getAllTools,
      registerTool: (tool) => {
        this.admission.assertOpen();
        builtins.registerTool(tool);
      },
      unregisterTool: (name) => {
        this.admission.assertOpen();
        builtins.unregisterTool(name);
      },
    });
  }

  closeAdmission(): Promise<void> {
    this.closed = true;
    return this.admission.close();
  }

  async dispose(): Promise<void> {
    try {
      await this.closeAdmission();
    } finally {
      this.closed = true;
    }
  }
}
