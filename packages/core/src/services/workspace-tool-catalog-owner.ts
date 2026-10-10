/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { buildToolGovernance } from '@vybestack/llxprt-code-tools';

import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type {
  AnyDeclarativeTool,
  McpToolPublication,
  ToolPublication,
  ToolSelection,
  RegistryPolicy,
} from '@vybestack/llxprt-code-tools';
import type { WorkspaceTrustReadPort } from './workspace-trust-reader.js';
import type { Config } from '../config/config.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { CoreToolRegistryHostAdapter } from '../tools-adapters/CoreToolRegistryHostAdapter.js';
import { CoreMessageBusAdapter } from '../tools-adapters/CoreMessageBusAdapter.js';
import { ToolDispatchAdmission } from './tool-dispatch-admission.js';
import { syncActivateMcpServerTool } from '../config/mcp-lazy-tool-sync.js';

export class WorkspaceToolCatalogOwner {
  private catalog: ToolRegistry | undefined;
  private readonly admission = new ToolDispatchAdmission();
  private closed = false;
  private released = false;
  private get registry(): ToolRegistry {
    if (this.released) throw new Error('Workspace tool publication is closed');
    if (this.catalog === undefined) {
      this.admission.assertOpen();
      this.catalog = new ToolRegistry(
        new CoreToolRegistryHostAdapter(this.config, this.trust),
        new CoreMessageBusAdapter(this.bus),
        () => {
          if (this.readMcpPolicy !== undefined) {
            return {
              hideTaskAsync: false,
              governance: buildToolGovernance({
                getExcludeTools: () => this.config.getExcludeTools?.(),
              }),
              ...this.readMcpPolicy(),
            };
          }
          const values = this.config.getInitialSettings();
          const mcp = values.mcp;
          const nested =
            typeof mcp === 'object' && mcp !== null && 'lazy' in mcp
              ? mcp.lazy
              : undefined;
          const eager = values['mcp.eagerServers'];
          return {
            hideTaskAsync: false,
            governance: buildToolGovernance({
              getExcludeTools: () => this.config.getExcludeTools?.(),
            }),
            lazyMcp: (values['mcp.lazy'] ?? nested) === true,
            eagerServers:
              Array.isArray(eager) &&
              eager.every((value): value is string => typeof value === 'string')
                ? [...eager]
                : [],
          };
        },
      );
    }
    return this.catalog;
  }
  readonly publication: McpToolPublication &
    ToolPublication &
    Pick<ToolSelection, 'getTool'> = {
    getTool: (name) =>
      this.registry.getAllTools().find((tool) => tool.name === name),
    registerTool: (tool) => {
      if (this.closed) throw new Error('Workspace tool publication is closed');
      this.registerTool(tool);
    },
    unregisterTool: (name) => this.registry.unregisterTool(name),
    removeMcpToolsByServer: (server) =>
      this.registry.removeMcpToolsByServer(server),
    sortTools: () => this.registry.sortTools(),
  };
  readonly selection: ToolSelection = {
    getTool: (name) => this.select(name),
    getAllToolNames: () => this.visible().map((tool) => tool.name),
    getAllTools: () => this.visible(true),
    getEnabledTools: () => this.visible(false),
    getFunctionDeclarations: () => this.declarations(),
    getFunctionDeclarationsFiltered: (names) =>
      this.declarations().filter(
        (declaration) =>
          declaration.name !== undefined && names.includes(declaration.name),
      ),
  };

  constructor(
    private readonly config: Pick<Config, 'getInitialSettings'> &
      ConstructorParameters<typeof CoreToolRegistryHostAdapter>[0],
    private readonly bus: MessageBus,
    private readonly trust: WorkspaceTrustReadPort,
    private readonly readMcpPolicy?: () => Pick<
      RegistryPolicy,
      'lazyMcp' | 'eagerServers'
    >,
  ) {}

  private registerTool(tool: AnyDeclarativeTool): void {
    if (tool.name === 'task' || tool.name === 'run_shell_command')
      throw new Error(
        `Workspace cannot publish reserved session tool '${tool.name}'`,
      );
    this.registry.registerTool(tool);
  }

  acceptMcpPublication(): {
    readonly publication: McpToolPublication;
    release(): void;
  } {
    this.admission.assertOpen();
    let released = false;
    const assertAccepted = (): void => {
      if (released) throw new Error('MCP publication lease is released');
    };
    return {
      publication: {
        registerTool: (tool) => {
          assertAccepted();
          this.registerTool(tool);
        },
        removeMcpToolsByServer: (server) => {
          assertAccepted();
          this.registry.removeMcpToolsByServer(server);
        },
        sortTools: () => {
          assertAccepted();
          this.registry.sortTools();
        },
      },
      release: () => {
        released = true;
      },
    };
  }

  acceptSkillPublication(): {
    readonly registry: Pick<
      ToolRegistry,
      'getTool' | 'registerTool' | 'unregisterTool'
    >;
    readonly declarations: () => ReturnType<
      ToolSelection['getFunctionDeclarations']
    >;
    readonly release: () => void;
  } {
    this.admission.assertOpen();
    const registry = this.registry;
    let released = false;
    const assertAccepted = (): void => {
      if (released) throw new Error('Skill publication lease is released');
    };
    return {
      registry: {
        getTool: (name) => {
          assertAccepted();
          return registry.getTool(name);
        },
        registerTool: (tool) => {
          assertAccepted();
          if (tool.name === 'task' || tool.name === 'run_shell_command')
            throw new Error(
              `Workspace cannot publish reserved session tool '${tool.name}'`,
            );
          registry.registerTool(tool);
        },
        unregisterTool: (name) => {
          assertAccepted();
          registry.unregisterTool(name);
        },
      },
      declarations: () => {
        assertAccepted();
        return this.trust.isTrustedFolder()
          ? structuredClone(registry.getFunctionDeclarations())
          : [];
      },
      release: () => {
        released = true;
      },
    };
  }

  async initialize(): Promise<void> {
    this.admission.assertOpen();
    await this.registry.discoverAllTools();
  }

  private visible(includeDisabled = false): AnyDeclarativeTool[] {
    if (this.closed) throw new Error('Workspace tool selection is closed');
    if (!this.trust.isTrustedFolder()) return [];
    const tools = includeDisabled
      ? this.registry.getAllTools()
      : this.registry.getEnabledTools();
    return tools.map((tool) => this.wrap(tool));
  }

  private select(name: string): AnyDeclarativeTool | undefined {
    if (this.closed) throw new Error('Workspace tool selection is closed');
    if (!this.trust.isTrustedFolder()) return undefined;
    const tool = this.registry.getTool(name);
    return tool === undefined ? undefined : this.wrap(tool);
  }

  private wrap(tool: AnyDeclarativeTool): AnyDeclarativeTool {
    return this.admission.bind(
      tool,
      () =>
        this.trust.isTrustedFolder() &&
        this.registry.getTool(tool.name) === tool,
    );
  }

  private declarations(): ReturnType<ToolSelection['getFunctionDeclarations']> {
    if (this.closed) throw new Error('Workspace tool selection is closed');
    return this.trust.isTrustedFolder()
      ? structuredClone(this.registry.getFunctionDeclarations())
      : [];
  }

  async refreshActivation(refresh: () => Promise<void>): Promise<void> {
    this.admission.assertOpen();
    await syncActivateMcpServerTool(this.registry, this.bus, refresh);
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
      this.released = true;
    }
  }
}
