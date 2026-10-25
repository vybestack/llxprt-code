/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { installWorkspaceRuntimeFixture } from './workspace-runtime-fixture.js';
const composeFixtureRuntime = installWorkspaceRuntimeFixture();

import { vi } from 'bun:test';
import type { CommandContext } from '../ui/commands/types.js';
import type { RecordingSwapCallbacks } from '../services/performResume.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { CliUiRuntime } from '../ui/cliUiRuntime.js';
import type { RuntimeApi } from './runtime-context-fixture.js';
import type { ProviderAliasRefresh } from '../ui/contexts/ProviderAliasRefreshContext.js';
import type { OAuthControl } from '../ui/contexts/OAuthControlContext.js';
import type {
  RecordingIntegration,
  GitService,
  Config,
  Logger,
  WorkspaceCheckpointOperations,
  SubagentDefinitionReads,
  SubagentDefinitionWrites,
  ProfileDefinitionReads,
} from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../config/settings.js';
import type { SessionStatsState } from '../ui/contexts/SessionContext.js';
import { createMockRuntimeApi } from '../ui/components/__tests__/StatsDisplay.testHelpers.js';

export interface CommandOwnerFixture extends CommandContext {
  /** Explicitly selects Agent-owned recording; absent retains raw interactive wiring. */
  recordingOwner?: 'agent';
  // Recording integration for session recording
  recordingIntegration?: RecordingIntegration;
  /**
   * Callbacks for swapping recording infrastructure during session resume.
   * @plan PLAN-20260214-SESSIONBROWSER.P23
   */
  recordingSwapCallbacks?: RecordingSwapCallbacks;
  runtimeApi: RuntimeApi;
  refreshProviderAliases: ProviderAliasRefresh;
  oauthControl: OAuthControl;
  services: {
    // Follow-up (#1569, abhipatel12): Ensure that config is never null.
    config: CliUiRuntime | null;
    /**
     * The rich Agent facade adopted from the CLI runtime via fromConfig().
     * Provides auth, mcp, tools, hooks, policy, tasks, session, profiles
     * sub-surfaces so commands avoid deep runtime/core access.
     * Null until bootstrap constructs it (or in non-interactive/test paths).
     */
    agent: Agent | null;
    settings: LoadedSettings;
    git:
      | Pick<WorkspaceCheckpointOperations, 'restoreProjectFromSnapshot'>
      | undefined;
    logger: Logger;
    subagentManager?: SubagentDefinitionReads & SubagentDefinitionWrites;
    profileManager?: Pick<ProfileDefinitionReads, 'listProfiles'>;
  };
}

// A utility type to make all properties of an object, and its nested objects, partial.
function unavailableOAuth(): never {
  throw new Error('OAuth is unavailable in this command fixture');
}

function createUnavailableOAuthControl(): OAuthControl {
  return {
    isAvailable: () => false,
    attachInteractiveAuthMessages: unavailableOAuth,
    bindInteractiveAuthHost: unavailableOAuth,
    unbindInteractiveAuthHost: unavailableOAuth,
    cancelInteractiveAuth: unavailableOAuth,
    getInteractiveAuthSessions: unavailableOAuth,
    takeAuthOutcome: unavailableOAuth,
    getCodeRequest: unavailableOAuth,
    clearCodeRequest: unavailableOAuth,
    getDialog: unavailableOAuth,
    subscribeDialog: unavailableOAuth,
    dismissDialog: unavailableOAuth,
    getAuthStatus: unavailableOAuth,
    toggleOAuthEnabled: unavailableOAuth,
    authenticate: unavailableOAuth,
    getSupportedProviders: unavailableOAuth,
    listBuckets: unavailableOAuth,
    isOAuthEnabled: unavailableOAuth,
    isAuthenticated: unavailableOAuth,
    peekStoredToken: unavailableOAuth,
    getHigherPriorityAuth: unavailableOAuth,
    activateNamedLoginBucket: unavailableOAuth,
    logoutAllBuckets: unavailableOAuth,
    logout: unavailableOAuth,
    clearSessionBucket: unavailableOAuth,
    readFailoverBuckets: unavailableOAuth,
    resetBuckets: unavailableOAuth,
    ensureBucketsAuthenticated: unavailableOAuth,
    getAuthStatusWithBuckets: unavailableOAuth,
    setSessionBucket: unavailableOAuth,
    getSessionBucket: unavailableOAuth,
    inspectAuthLock: unavailableOAuth,
    forceRecoverAuthLock: unavailableOAuth,
    recoverAuthLock: unavailableOAuth,
    clearBrowserProfileAssociation: unavailableOAuth,
    setBrowserProfileAssociation: unavailableOAuth,
    getAllAnthropicUsageInfo: unavailableOAuth,
    getAllCodexUsageInfo: unavailableOAuth,
    getAllCodexRateLimitResetCredits: unavailableOAuth,
    hasCodexToken: unavailableOAuth,
    clearProviderClientCache: unavailableOAuth,
    discoverBuckets: unavailableOAuth,
    readStoredTokenSummary: unavailableOAuth,
    readCodexBucketToken: unavailableOAuth,
    attachProviderMessages: unavailableOAuth,
    submitCode: unavailableOAuth,
  };
}

type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

/**
 * Creates a deep, fully-typed mock of the CommandOwnerFixture for use in tests.
 * All functions are pre-mocked with `vi.fn()`.
 *
 * @param overrides - A deep partial object to override any default mock values.
 * @returns A complete, mocked CommandOwnerFixture object.
 */
const buildDefaultMocks = (): CommandOwnerFixture => ({
  runtimeApi: createMockRuntimeApi(),
  refreshProviderAliases: vi.fn(async () => {}),
  oauthControl: createUnavailableOAuthControl(),
  signal: new AbortController().signal,
  invocation: {
    raw: '',
    name: '',
    args: '',
  },
  services: {
    config: composeFixtureRuntime({
      getMcpServers: () => undefined,
      getMcpServerCommand: () => undefined,
      getBlockedMcpServers: () => undefined,
      getProvider: () => undefined,
      getModel: () => 'test-model',
      isInteractive: () => true,
      isExtensionEnabled: () => true,
      getWorkingDir: () => process.cwd(),
      getProjectRoot: () => process.cwd(),
      getCheckpointingEnabled: () => false,
      getEphemeralSettings: () => ({}),
      getEphemeralSetting: vi.fn(),
      setEphemeralSetting: vi.fn(),
    } as unknown as Config),
    agent: null,
    settings: { merged: {} } as LoadedSettings,
    git: undefined as GitService | undefined,
    logger: {
      logMessage: vi.fn(),
    } as unknown as Logger, // Cast because Logger is a class.
    // Follow-up (#1569): Add profileManager and subagentManager when CommandOwnerFixture interface is updated.
    // @plan:PLAN-20250117-SUBAGENTCONFIG.P07
  },
  ui: {
    addItem: vi.fn(),
    clear: vi.fn(),
    setDebugMessage: vi.fn(),
    pendingItem: null,
    setPendingItem: vi.fn(),
    loadHistory: vi.fn(),
    toggleCorgiMode: vi.fn(),
    toggleDebugProfiler: vi.fn(),
    toggleVimEnabled: vi.fn(),
    setLlxprtMdFileCount: vi.fn(),
    updateHistoryTokenCount: vi.fn(),
    reloadCommands: vi.fn(),
    extensionsUpdateState: new Map(),
    dispatchExtensionStateUpdate: vi.fn(),
    addConfirmUpdateExtensionRequest: vi.fn(),
    setExtensionsUpdateState: vi.fn(),
  } as unknown as CommandOwnerFixture['ui'],
  session: {
    sessionShellAllowlist: new Set<string>(),
    stats: {
      sessionStartTime: new Date(),
      lastPromptTokenCount: 0,
      metrics: {
        models: {},
        tools: {
          totalCalls: 0,
          totalSuccess: 0,
          totalFail: 0,
          totalDurationMs: 0,
          totalDecisions: { accept: 0, reject: 0, modify: 0 },
          byName: {},
        },
      },
    } as SessionStatsState,
  },
});

export const createMockCommandContext = (
  overrides: DeepPartial<CommandOwnerFixture> = {},
): CommandOwnerFixture => {
  const defaultMocks: CommandOwnerFixture = buildDefaultMocks();

  // Deep merge that preserves special objects (Dates, vitest mocks, etc.)
  const merge = (target: unknown, source: unknown): CommandOwnerFixture => {
    const output = { ...(target as Record<string, unknown>) };

    for (const key in source as Record<string, unknown>) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sourceValue = (source as Record<string, unknown>)[key];
        const targetValue = (output as Record<string, unknown>)[key];

        if (
          // We only want to recursively merge plain objects
          Object.prototype.toString.call(sourceValue) === '[object Object]' &&
          Object.getPrototypeOf(sourceValue) === Object.prototype &&
          Object.prototype.toString.call(targetValue) === '[object Object]'
        ) {
          (output as Record<string, unknown>)[key] = merge(
            targetValue,
            sourceValue,
          );
        } else {
          // If not, we do a direct assignment. This preserves Date objects, vitest mocks, and others.
          (output as Record<string, unknown>)[key] = sourceValue;
        }
      }
    }
    return output as unknown as CommandOwnerFixture;
  };

  return merge(defaultMocks, overrides);
};
