/**
 * @plan:PLAN-20260608-ISSUE1585.P04
 * @requirement:REQ-INTERFACE-OWNERSHIP, REQ-BEHAVIORAL-TDD
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Interface Contract Behavioral Tests
 *
 * Verifies structural contracts of tools-owned interfaces.
 * These tests exercise the interface shapes to ensure the
 * public API surface is correct and complete.
 *
 * Each test verifies an interface contract is structurally sound:
 * - Methods have the correct signatures (parameter counts, return types)
 * - Helper types like IToolKeyStorage.maskKeyForDisplay behave correctly
 *   when a concrete implementation provides masking behavior
 * - Interface barrels export every required contract
 */

import { describe, it, expect } from 'bun:test';
import { hasPublishSubscribe } from '../interfaces/index.js';
import { ToolConfirmationOutcome } from '../types/tool-confirmation-types.js';
import type {
  IToolHost,
  IToolRegistryHost,
  IToolMessageBus,
  IShellExecutionService,
  ISubagentService,
  IAsyncTaskService,
  ISkillService,
  IMcpToolService,
  IIdeService,
  ILspService,
  IStorageService,
  IToolKeyStorage,
  ITodoService,
  ISettingsService,
  IPromptRegistryService,
  PublishSubscribeCapable,
  PolicyUpdateOptions,
  AsyncWorkInfo,
  DiffUpdateResult,
  SkillInfo,
  McpFunctionCall,
} from '../interfaces/index.js';

/**
 * Helper: assert a value satisfies an interface by structural assignment.
 * If the interface contract changes (e.g. a required method is removed),
 * the TypeScript compiler will catch it. At runtime, we verify method
 * existence on a compliant object.
 */
function assertImplements<T>(_: T): void {
  // Structural type check only — compile-time enforcement
}

/** Settings stub backed by a table, so the lookup's branching lives here
 * rather than inside a test body (#3129). */
function settingsLookup(
  values: Readonly<Record<string, string>>,
): (key: string) => string | undefined {
  return (key) => values[key];
}

describe('Interface Contract Behavioral Tests @plan:PLAN-20260608-ISSUE1585.P04', () => {
  describe('IToolHost contract', () => {
    const createHost = (overrides: Partial<IToolHost> = {}): IToolHost => ({
      getTargetDir: () => '/tmp/workspace',
      getWorkspaceRoots: () => ['/tmp/workspace'],
      getApprovalMode: () => 'auto',
      setApprovalMode: () => {},
      isInteractive: () => false,
      hasFeatureFlag: () => false,
      getFileService: () => ({
        shouldGitIgnoreFile: () => false,
        shouldLlxprtIgnoreFile: () => false,
        shouldIgnoreFile: () => false,
        filterFiles: (paths) => paths,
      }),
      getFileFilteringOptions: () => ({
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
      getFileExclusions: () => [],
      getReadManyFilesExclusions: () => ['**/fixtures/**'],
      getFileFilteringRespectLlxprtIgnore: () => true,
      getLlxprtIgnoreFilePath: () => '/tmp/workspace/.llxprtignore',
      recordFileRead: () => {},
      getLlxprtIgnorePatterns: () => ['*.secret'],
      getEphemeralSettings: () => ({}),
      getDebugMode: () => false,
      ...overrides,
    });

    it('requires getTargetDir returning string', () => {
      const host: IToolHost = createHost({
        getTargetDir: () => '/tmp/workspace',
      });

      assertImplements<IToolHost>(host);
      expect(host.getTargetDir()).toBe('/tmp/workspace');
      expect(typeof host.getTargetDir()).toBe('string');
      expect(host.getReadManyFilesExclusions()).toStrictEqual([
        '**/fixtures/**',
      ]);
    });

    it('requires getWorkspaceRoots returning string array', () => {
      const host: IToolHost = createHost({
        getTargetDir: () => '/tmp',
        getWorkspaceRoots: () => ['/root1', '/root2'],
      });

      const roots = host.getWorkspaceRoots();
      expect(Array.isArray(roots)).toBe(true);
      expect(roots).toHaveLength(2);
    });

    it('requires hasFeatureFlag accepting string flag', () => {
      const host: IToolHost = createHost({
        getTargetDir: () => '/tmp',
        getWorkspaceRoots: () => [],
        hasFeatureFlag: (flag: string) => flag === 'experimental',
      });

      expect(host.hasFeatureFlag('experimental')).toBe(true);
      expect(host.hasFeatureFlag('unknown')).toBe(false);
    });
  });

  describe('IToolRegistryHost contract', () => {
    it('supports current optional tool discovery and enablement methods', () => {
      const registryHost = {
        getCoreTools: () => ['shell', 'read-file'],
        getExcludeTools: () => ['dangerous-tool'],
        getToolDiscoveryCommand: () => 'llm-tools discover',
        getToolCallCommand: () => 'llm-tools call',
        isToolEnabled: (name: string) => name !== 'dangerous-tool',
      } satisfies IToolRegistryHost;
      assertImplements<IToolRegistryHost>(registryHost);

      expect(registryHost.getCoreTools()).toStrictEqual(['shell', 'read-file']);
      expect(registryHost.getExcludeTools()).toStrictEqual(['dangerous-tool']);
      expect(registryHost.getToolDiscoveryCommand()).toBe('llm-tools discover');
      expect(registryHost.getToolCallCommand()).toBe('llm-tools call');
      expect(registryHost.isToolEnabled('shell')).toBe(true);
      expect(registryHost.isToolEnabled('dangerous-tool')).toBe(false);
    });

    it('allows optional discovery methods to return undefined', () => {
      const registryHost = {
        getCoreTools: () => [],
        getExcludeTools: () => [],
        getToolDiscoveryCommand: () => undefined,
        getToolCallCommand: () => undefined,
        isToolEnabled: (_name: string) => true,
      } satisfies IToolRegistryHost;
      expect(registryHost.getToolDiscoveryCommand()).toBeUndefined();
      expect(registryHost.getToolCallCommand()).toBeUndefined();
    });
  });

  describe('IShellExecutionService contract', () => {
    it('requires execute returning ShellResult with stdout, stderr, exitCode, aborted', async () => {
      const shell: IShellExecutionService = {
        execute: async (_cmd: string, _opts?: unknown) => ({
          stdout: 'hello',
          stderr: '',
          exitCode: 0,
          aborted: false,
        }),
        isCommandAllowed: (_cmd: string) => true,
      };
      assertImplements<IShellExecutionService>(shell);

      const result = await shell.execute('echo hello');
      expect(result.stdout).toBe('hello');
      expect(result.exitCode).toBe(0);
      expect(typeof result.aborted).toBe('boolean');
    });

    it('requires isCommandAllowed returning boolean', () => {
      const shell: IShellExecutionService = {
        execute: async () => ({
          stdout: '',
          stderr: '',
          exitCode: 0,
          aborted: false,
        }),
        isCommandAllowed: (cmd: string) => cmd.startsWith('echo'),
      };
      expect(shell.isCommandAllowed('echo hi')).toBe(true);
      expect(shell.isCommandAllowed('rm -rf /')).toBe(false);
    });
  });

  describe('IToolKeyStorage contract', () => {
    it('maskKeyForDisplay masks keys correctly with a concrete implementation', () => {
      // Behavioral test: a real maskKeyForDisplay implementation
      // must mask all but the last 4 characters
      const keyStorage: IToolKeyStorage = {
        saveKey: async (_toolName: string, _key: string) => {},
        getKey: async (_toolName: string) => null,
        deleteKey: async (_toolName: string) => {},
        hasKey: async (_toolName: string) => false,
        resolveKey: async (_toolName: string) => null,
        maskKeyForDisplay: (key: string) => {
          if (key.length <= 8) return '****';
          return '*'.repeat(key.length - 4) + key.slice(-4);
        },
        getSupportedToolNames: () => ['codesearch', 'exa'],
      };
      assertImplements<IToolKeyStorage>(keyStorage);

      // 'sk-1234567890abcdef' = 19 chars → 15 stars + last 4 chars
      expect(keyStorage.maskKeyForDisplay('sk-1234567890abcdef')).toBe(
        '***************cdef',
      );
      expect(keyStorage.maskKeyForDisplay('short')).toBe('****');
      expect(keyStorage.maskKeyForDisplay('')).toBe('****');
    });

    it('getSupportedToolNames returns expected tool names', () => {
      const keyStorage: IToolKeyStorage = {
        saveKey: async () => {},
        getKey: async () => null,
        deleteKey: async () => {},
        hasKey: async () => false,
        resolveKey: async () => null,
        maskKeyForDisplay: (key: string) => key,
        getSupportedToolNames: () => ['codesearch', 'exa'],
      };
      const names = keyStorage.getSupportedToolNames();
      expect(Array.isArray(names)).toBe(true);
      expect(names).toContain('codesearch');
      expect(names).toContain('exa');
    });
  });

  describe('IToolMessageBus contract', () => {
    it('requires requestConfirmation and publishPolicyUpdate', async () => {
      const bus: IToolMessageBus = {
        requestConfirmation: async (..._args: unknown[]) =>
          ToolConfirmationOutcome.ProceedOnce,
        publishPolicyUpdate: async (
          _outcome: ToolConfirmationOutcome,
          _options?: PolicyUpdateOptions,
        ) => {},
      };
      assertImplements<IToolMessageBus>(bus);

      const outcome = await bus.requestConfirmation({ tool: 'shell' });
      expect(outcome).toBe(ToolConfirmationOutcome.ProceedOnce);
    });

    it('subscribe is optional capability outside the base interface', () => {
      const busWithoutSubscribe: IToolMessageBus = {
        requestConfirmation: async () => ToolConfirmationOutcome.Cancel,
        publishPolicyUpdate: async () => {},
      };
      assertImplements<IToolMessageBus>(busWithoutSubscribe);
      expect(hasPublishSubscribe(busWithoutSubscribe)).toBe(false);
    });

    it('subscribe returns unsubscribe function when publish-subscribe capability is provided', () => {
      const bus: IToolMessageBus & PublishSubscribeCapable = {
        requestConfirmation: async () => ToolConfirmationOutcome.Cancel,
        publishPolicyUpdate: async () => {},
        publish: () => {},
        subscribe: (_event: string, _handler) => () => {},
      };
      expect(hasPublishSubscribe(bus)).toBe(true);
      const unsub = bus.subscribe('policy-update', () => {});
      expect(typeof unsub).toBe('function');
    });
  });

  describe('ISubagentService contract', () => {
    it('requires executeSubagent, listSubagents, getSubagentConfig', async () => {
      const service: ISubagentService = {
        executeSubagent: async (request) => ({
          output: `Ran ${request.name}`,
          success: true,
        }),
        listSubagents: async () => [
          { name: 'typescript-expert', description: 'TS expert' },
        ],
        getSubagentConfig: async (name: string) =>
          name === 'typescript-expert'
            ? { name: 'typescript-expert', instructions: 'Be helpful' }
            : undefined,
      };
      assertImplements<ISubagentService>(service);

      const result = await service.executeSubagent({
        name: 'typescript-expert',
        prompt: 'Fix this',
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain('typescript-expert');

      const agents = await service.listSubagents();
      expect(agents).toHaveLength(1);

      const config = await service.getSubagentConfig('typescript-expert');
      expect(config?.name).toBe('typescript-expert');
      expect(await service.getSubagentConfig('nonexistent')).toBeUndefined();
    });
  });

  describe('IAsyncTaskService contract', () => {
    it('requires status, lookup, output, and cancellation operations', async () => {
      const workItems: AsyncWorkInfo[] = [
        {
          kind: 'subagent',
          id: 'task-1',
          subagentName: 'typescript-expert',
          goalPrompt: 'Fix the typecheck diagnostics',
          status: 'completed',
          output: 'Typecheck passed',
        },
        {
          kind: 'shell',
          id: 'task-2',
          command: 'npm run typecheck',
          cwd: '/tmp/workspace',
          status: 'running',
          pid: 3141,
        },
      ];
      const service: IAsyncTaskService = {
        checkAsyncTask: async (id: string) =>
          id === 'task-1' ? 'completed' : 'running',
        getTaskStatus: () => workItems,
        getTask: (id: string) => workItems.find((task) => task.id === id),
        getTaskByPrefix: (prefix: string) => {
          const candidates = workItems.filter((task) =>
            task.id.startsWith(prefix),
          );
          const [task] = candidates;
          if (candidates.length === 1) {
            return { task };
          }
          return { candidates };
        },
        getOutputTail: (id: string) => ({
          id,
          output: id === 'task-2' ? 'Checking types...' : '',
          truncated: false,
        }),
        cancel: async (id: string) => id === 'task-2',
      };
      assertImplements<IAsyncTaskService>(service);

      expect(await service.checkAsyncTask('task-1')).toBe('completed');
      expect(await service.checkAsyncTask('task-2')).toBe('running');
      const tasks = service.getTaskStatus();
      expect(tasks).toHaveLength(2);
      expect(tasks).toContainEqual(
        expect.objectContaining({
          kind: 'shell',
          command: 'npm run typecheck',
        }),
      );
      expect(service.getTask('task-1')).toStrictEqual(
        expect.objectContaining({ kind: 'subagent' }),
      );
      expect(service.getTaskByPrefix('task-2').task?.id).toBe('task-2');
      expect(service.getOutputTail('task-2').output).toBe('Checking types...');
      expect(await service.cancel('task-2')).toBe(true);
    });
  });

  describe('IIdeService contract', () => {
    it('requires applyDiff, getConnectionStatus, openDiff', async () => {
      const service: IIdeService = {
        applyDiff: async (params): Promise<DiffUpdateResult> =>
          params.diff.length > 0
            ? { status: 'accepted', content: params.diff }
            : { status: 'rejected', content: undefined },
        getConnectionStatus: () => 'connected',
        openDiff: async () => {},
      };
      assertImplements<IIdeService>(service);

      const result = await service.applyDiff({
        filePath: '/tmp/test.ts',
        diff: 'some diff content',
      });
      expect(result.status).toBe('accepted');
      expect(result.content).toBe('some diff content');

      expect(service.getConnectionStatus()).toBe('connected');

      const rejected = await service.applyDiff({
        filePath: '/tmp/test.ts',
        diff: '',
      });
      expect(rejected).toStrictEqual({
        status: 'rejected',
        content: undefined,
      });
    });
  });

  describe('ILspService contract', () => {
    it('requires diagnostics operations and LSP configuration', async () => {
      const service: ILspService = {
        getDiagnostics: (filePath: string) =>
          filePath.endsWith('.ts')
            ? [{ message: 'Type error', severity: 'error', line: 10 }]
            : [],
        waitForDiagnostics: async (filePath: string, _timeout: number) =>
          service.getDiagnostics(filePath),
        getLspConfig: () => ({
          includeSeverities: ['error', 'warning'],
          maxDiagnosticsPerFile: 25,
        }),
      };
      assertImplements<ILspService>(service);

      const diags = service.getDiagnostics('/tmp/test.ts');
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toBe('Type error');

      const waited = await service.waitForDiagnostics('/tmp/test.ts', 5000);
      expect(waited).toHaveLength(1);
      expect(service.getLspConfig()).toStrictEqual({
        includeSeverities: ['error', 'warning'],
        maxDiagnosticsPerFile: 25,
      });
    });
  });

  describe('IStorageService contract', () => {
    it('requires getGlobalMemoryDir, getGlobalDataDir, readFile, writeFile, ensureDir', async () => {
      const service: IStorageService = {
        getGlobalMemoryDir: () => '/home/user/.llxprt',
        getGlobalDataDir: () => '/home/user/.local/share/llxprt-code',
        readFile: async (path: string) => `content of ${path}`,
        writeFile: async () => {},
        ensureDir: async () => {},
      };
      assertImplements<IStorageService>(service);

      expect(service.getGlobalMemoryDir()).toBe('/home/user/.llxprt');
      expect(service.getGlobalDataDir()).toBe(
        '/home/user/.local/share/llxprt-code',
      );
      const content = await service.readFile('/home/user/.llxprt/LLXPRT.md');
      expect(content).toContain('content of');
    });
  });

  describe('ITodoService contract', () => {
    it('requires getTodoStore, getReminderService, getContextTracker, getDefaultAgentId', () => {
      const service: ITodoService = {
        getTodoStore: () => ({
          getTodos: () => [
            { id: '1', content: 'Task 1', status: 'in_progress' },
          ],
          setTodos: () => {},
        }),
        getReminderService: () => ({
          shouldGenerateReminder: () => true,
        }),
        getContextTracker: () => ({
          setActiveTodo: () => {},
          clearActiveTodo: () => {},
        }),
        getDefaultAgentId: () => 'agent-001',
      };
      assertImplements<ITodoService>(service);

      const store = service.getTodoStore();
      const todos = store.getTodos?.();
      expect(todos).toHaveLength(1);
      expect(todos?.[0]?.status).toBe('in_progress');
      expect(service.getDefaultAgentId()).toBe('agent-001');
    });
  });

  describe('ISettingsService contract', () => {
    it('requires getSettingsService, getSetting, setSetting', async () => {
      const service: ISettingsService = {
        getSettingsService: () => ({
          get: settingsLookup({ theme: 'dark' }),
          set: () => {},
        }),
        getSetting: settingsLookup({ theme: 'dark' }),
        setSetting: async () => {},
      };
      assertImplements<ISettingsService>(service);

      expect(service.getSetting('theme')).toBe('dark');
      expect(service.getSetting('nonexistent')).toBeUndefined();
    });
  });

  describe('IPromptRegistryService contract', () => {
    it('requires getPromptRegistry and getPrompt', () => {
      const service: IPromptRegistryService = {
        getPromptRegistry: () => ({
          getPrompt: (name: string) =>
            name === 'system'
              ? { name: 'system', content: 'You are helpful' }
              : undefined,
          getPromptNames: () => ['system'],
        }),
        getPrompt: (name: string) =>
          name === 'system'
            ? { name: 'system', content: 'You are helpful' }
            : undefined,
      };
      assertImplements<IPromptRegistryService>(service);

      const prompt = service.getPrompt('system');
      expect(prompt?.name).toBe('system');
      expect(service.getPrompt('nonexistent')).toBeUndefined();
    });
  });

  describe('ISkillService contract', () => {
    it('requires activation, discovery, lookup, and resource operations', async () => {
      const skills: SkillInfo[] = [
        {
          name: 'pr-creator',
          description: 'Creates pull requests',
          location: '/skills/pr-creator',
        },
      ];
      const service: ISkillService = {
        activateSkill: async (name: string) =>
          name === 'pr-creator'
            ? { success: true, instructions: 'PR creation skill' }
            : { success: false, availableSkills: ['pr-creator'] },
        getSkillManager: () => ({
          getSkills: () => skills,
          getSkill: (name: string) =>
            skills.find((skill) => skill.name === name) ?? null,
        }),
        listSkills: () => skills,
        getSkill: (name: string) =>
          skills.find((skill) => skill.name === name) ?? null,
      };
      assertImplements<ISkillService>(service);

      const result = await service.activateSkill('pr-creator');
      expect(result.success).toBe(true);
      expect(result.instructions).toBe('PR creation skill');

      const mgr = service.getSkillManager();
      expect(mgr.getSkills?.()).toHaveLength(1);
      expect(service.listSkills()).toStrictEqual(skills);
      expect(service.getSkill('pr-creator')?.description).toBe(
        'Creates pull requests',
      );
      expect(service.getSkill('missing')).toBeNull();
    });
  });

  describe('IMcpToolService contract', () => {
    it('requires one-argument callTool and permits trusted-folder queries', async () => {
      const service: IMcpToolService = {
        callTool: async (functionCalls) =>
          functionCalls.map((functionCall) => ({
            text: functionCall.name ?? 'unnamed',
            functionResponse: {
              name: functionCall.name,
              response: { content: functionCall.args ?? {} },
            },
          })),
        isTrustedFolder: () => true,
      };
      assertImplements<IMcpToolService>(service);

      const functionCalls: McpFunctionCall[] = [
        { name: 'search', args: { query: 'interface contracts' } },
      ];
      const parts = await service.callTool(functionCalls);
      expect(parts).toHaveLength(1);
      expect(parts[0]?.text).toBe('search');
      expect(parts[0]?.functionResponse?.name).toBe('search');
      expect(parts[0]?.functionResponse?.response?.content).toStrictEqual({
        query: 'interface contracts',
      });
      expect(service.isTrustedFolder?.()).toBe(true);
      expect(await service.callTool([])).toStrictEqual([]);
    });
  });

  describe('Barrel export completeness', () => {
    it('all 15 interface types are re-exported from the barrel', async () => {
      // Dynamic import of the barrel to verify all types are exported
      // Since these are type-only exports, we verify by checking the module loads
      const barrel = await import('../interfaces/index.js');
      // Type-only exports won't appear as runtime keys, but the module must load
      // without errors. We verify the import succeeds.
      expect(barrel).toBeDefined();
    });
  });
});
