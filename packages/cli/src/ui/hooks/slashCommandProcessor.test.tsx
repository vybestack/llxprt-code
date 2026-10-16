import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
const composeFixtureRuntime = installWorkspaceRuntimeFixture();
import { createDialogStore } from '../stores/dialog/dialogStore.js';
import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { renderHook, waitFor } from '../../__tests__/render.js';
import { useSlashCommandProcessor } from './slashCommandProcessor.js';
import { createMockRuntimeApi } from '../components/__tests__/StatsDisplay.testHelpers.js';

const runtimeApi = createMockRuntimeApi();
const refreshAliases = vi.fn(async () => {});
function unavailableOAuth(): never {
  throw new Error('OAuth is unavailable in this command fixture');
}
function unavailableSettings(): never {
  throw new Error('Settings writes are unavailable in this command fixture');
}
const oauthControl = {
  isAvailable: () => false,
  getSupportedProviders: unavailableOAuth,
  isAuthenticated: unavailableOAuth,
  logout: unavailableOAuth,
  listBuckets: unavailableOAuth,
  getAllAnthropicUsageInfo: unavailableOAuth,
  getAllCodexUsageInfo: unavailableOAuth,
  getAllCodexRateLimitResetCredits: unavailableOAuth,
  hasCodexToken: unavailableOAuth,
  readCodexBucketToken: unavailableOAuth,
  discoverBuckets: unavailableOAuth,
};
void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => runtimeApi,
}));
void vi.mock('../contexts/ProviderAliasRefreshContext.js', () => ({
  useProviderAliasRefresh: () => refreshAliases,
}));
void vi.mock('../contexts/OAuthControlContext.js', () => ({
  useOAuthControl: () => oauthControl,
}));
import type { SlashCommand } from '../commands/types.js';
import { CommandKind } from '../commands/types.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { Config } from '@vybestack/llxprt-code-core';

const actualCore = { ...(await import('@vybestack/llxprt-code-core')) };
const coreMocks = (() => {
  const logSlashCommand = vi.fn();
  class StubLogger {
    debug = vi.fn();
  }
  return {
    Config: actualCore.Config,
    GitService: vi.fn(),
    Logger: StubLogger,
    logSlashCommand,
    SlashCommandEvent: class {
      name: string;
      subcommand?: string;

      constructor(name: string, subcommand?: string) {
        this.name = name;
        this.subcommand = subcommand;
      }
    },
    ToolConfirmationOutcome: {
      Cancel: 'cancel',
      ProceedAlways: 'proceedAlways',
    },
    Storage: class {},
    ProfileManager: class {},
    SubagentManager: class {},
    SessionMetrics: class {},
    ModelMetrics: class {},
    DebugLogger: class {
      static enabled = false;
      log = vi.fn();
      debug = vi.fn();
      error = vi.fn();
    },
    IdeClient: {
      getInstance: vi.fn().mockResolvedValue({
        addStatusChangeListener: vi.fn(),
        removeStatusChangeListener: vi.fn(),
      }),
    },
    coreEvents: {
      on: vi.fn(),
      off: vi.fn(),
    },
    CoreEvent: {
      FolderTrustChanged: 'folder-trust-changed',
    },
  };
})();

void vi.mock('@vybestack/llxprt-code-core', () => coreMocks);

const sessionStatsMock = {
  stats: {},
  updateHistoryTokenCount: vi.fn(),
};

const actualActual = { ...(await import('../contexts/SessionContext.js')) };
void vi.mock('../contexts/SessionContext.js', () => ({
  ...actualActual,
  useSessionStats: vi.fn(() => sessionStatsMock),
}));

const loaderMocks = (() => {
  const builtinLoaderInstance = { loadCommands: vi.fn() };
  const fileLoaderInstance = { loadCommands: vi.fn() };
  const mcpLoaderInstance = { loadCommands: vi.fn() };
  return {
    builtinLoaderInstance,
    fileLoaderInstance,
    mcpLoaderInstance,
    BuiltinCommandLoader: vi
      .fn()
      .mockImplementation(() => builtinLoaderInstance),
    FileCommandLoader: vi.fn().mockImplementation(() => fileLoaderInstance),
    McpPromptLoader: vi.fn().mockImplementation(() => mcpLoaderInstance),
  };
})();

void vi.mock('../../services/BuiltinCommandLoader.js', () => ({
  BuiltinCommandLoader: loaderMocks.BuiltinCommandLoader,
}));

void vi.mock('../../services/FileCommandLoader.js', () => ({
  FileCommandLoader: loaderMocks.FileCommandLoader,
}));

void vi.mock('../../services/McpPromptLoader.js', () => ({
  McpPromptLoader: loaderMocks.McpPromptLoader,
}));

function createTestCommand(overrides: Partial<SlashCommand>): SlashCommand {
  return {
    name: overrides.name ?? 'testcmd',
    description: overrides.description ?? 'A test command',
    kind: overrides.kind ?? CommandKind.BUILT_IN,
    action: overrides.action ?? vi.fn(),
    subCommands: overrides.subCommands,
  };
}

describe('useSlashCommandProcessor', () => {
  let mockConfig: Config;
  const mockSettings = {
    merged: { ui: {} },
    getProviderKeyfile: unavailableSettings,
    setProviderKeyfile: unavailableSettings,
    removeProviderKeyfile: unavailableSettings,
  } as LoadedSettings;
  let addItem: ReturnType<typeof vi.fn>;
  let clearItems: ReturnType<typeof vi.fn>;
  let loadHistory: ReturnType<typeof vi.fn>;
  let refreshStatic: ReturnType<typeof vi.fn>;
  let onDebugMessage: ReturnType<typeof vi.fn>;
  let openThemeDialog: ReturnType<typeof vi.fn>;
  let openAuthDialog: ReturnType<typeof vi.fn>;
  let openEditorDialog: ReturnType<typeof vi.fn>;
  let openProviderDialog: ReturnType<typeof vi.fn>;
  let openLoadProfileDialog: ReturnType<typeof vi.fn>;
  let toggleCorgiMode: ReturnType<typeof vi.fn>;
  let setQuittingMessages: ReturnType<typeof vi.fn>;
  let openPrivacyNotice: ReturnType<typeof vi.fn>;
  let openSettingsDialog: ReturnType<typeof vi.fn>;
  let toggleVimEnabled: ReturnType<typeof vi.fn>;
  let setIsProcessing: ReturnType<typeof vi.fn>;
  let setLlxprtMdFileCount: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    loaderMocks.builtinLoaderInstance.loadCommands.mockReset();
    loaderMocks.fileLoaderInstance.loadCommands.mockReset();
    loaderMocks.mcpLoaderInstance.loadCommands.mockReset();
    loaderMocks.builtinLoaderInstance.loadCommands.mockResolvedValue([]);
    loaderMocks.fileLoaderInstance.loadCommands.mockResolvedValue([]);
    loaderMocks.mcpLoaderInstance.loadCommands.mockResolvedValue([]);

    sessionStatsMock.updateHistoryTokenCount.mockReset();

    const mockIdeClient = {
      addStatusChangeListener: vi.fn(),
      removeStatusChangeListener: vi.fn(),
    };

    mockConfig = {
      getMcpServers: () => undefined,
      getIdeClient: vi.fn().mockReturnValue(mockIdeClient),
      getProjectRoot: vi.fn().mockReturnValue('/test/project'),
      getSessionId: vi.fn().mockReturnValue('test-session-id'),
      getDebugMode: vi.fn().mockReturnValue(false),
      getTargetDir: vi.fn().mockReturnValue('/test/project'),
      getWorkingDir: () => '/test/project',
      getProxy: () => undefined,
      getProjectTempDir: () => '/test/project/tmp',
      getCheckpointingEnabled: () => false,
      getUserMemory: vi.fn().mockReturnValue(''),
      setUserMemory: vi.fn(),
      getApprovalMode: vi.fn().mockReturnValue('default'),
      setApprovalMode: vi.fn(),
      getAgentClient: vi.fn().mockReturnValue(undefined),
      storage: undefined,
    } as unknown as Config;

    addItem = vi.fn();
    clearItems = vi.fn();
    loadHistory = vi.fn().mockResolvedValue(undefined);
    refreshStatic = vi.fn();
    onDebugMessage = vi.fn();
    openThemeDialog = vi.fn();
    openAuthDialog = vi.fn();
    openEditorDialog = vi.fn();
    openProviderDialog = vi.fn();
    openLoadProfileDialog = vi.fn();
    toggleCorgiMode = vi.fn();
    setQuittingMessages = vi.fn();
    openPrivacyNotice = vi.fn();
    openSettingsDialog = vi.fn();
    toggleVimEnabled = vi.fn().mockResolvedValue(true);
    setIsProcessing = vi.fn();
    setLlxprtMdFileCount = vi.fn();
  });

  it('loads slash commands via BuiltinCommandLoader', async () => {
    const testCommands = [
      createTestCommand({ name: 'subagent' }),
      createTestCommand({ name: 'about' }),
    ];
    loaderMocks.builtinLoaderInstance.loadCommands.mockResolvedValue(
      testCommands,
    );

    const config = composeFixtureRuntime(mockConfig);
    const dialogs = createDialogStore();
    const extensionUpdates = new Map();
    const { result, unmount } = renderHook(() =>
      useSlashCommandProcessor(
        config,
        null,
        mockSettings,
        addItem,
        clearItems,
        loadHistory,
        refreshStatic,
        toggleVimEnabled,
        setIsProcessing,
        setLlxprtMdFileCount,
        {
          openThemeDialog,
          openAuthDialog,
          openEditorDialog,
          openProviderDialog,
          openLoadProfileDialog,
          toggleCorgiMode,
          quit: setQuittingMessages,
          openPrivacyNotice,
          openSettingsDialog,
          setDebugMessage: onDebugMessage,
          openLoggingDialog: () => {},
          openSubagentDialog: () => {},
          openModelsDialog: () => {},
          openPermissionsDialog: () => {},
          openPoliciesDialog: () => {},
          openCreateProfileDialog: () => {},
          openProfileListDialog: () => {},
          viewProfileDetail: () => {},
          openProfileEditor: () => {},
          toggleDebugProfiler: () => {},
          dispatchExtensionStateUpdate: () => {},
          addConfirmUpdateExtensionRequest: () => {},
          openWelcomeDialog: () => {},
          openSessionBrowserDialog: () => {},
        },
        dialogs,
        extensionUpdates,
        true,
      ),
    );

    // The hook's contract here is forwarding the builtin loader's result to
    // the commands callback; assert a derived projection of behaviorally
    // relevant fields so a dropped field, misrouted load, or mutation
    // cannot pass by echoing a constant. The forwarded command names AND
    // kinds can only match if the loader was called and its complete
    // result was routed to the state setter.
    await waitFor(() =>
      expect(
        result.current.slashCommands?.map((command) => ({
          name: command.name,
          kind: command.kind,
        })),
      ).toStrictEqual([
        { name: 'subagent', kind: CommandKind.BUILT_IN },
        { name: 'about', kind: CommandKind.BUILT_IN },
      ]),
    );
    unmount();
  });
});
