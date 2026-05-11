/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @fix issue1861
 * OnAuthErrorHandler config integration tests
 *
 * These behavioral tests verify:
 * 1. OnAuthErrorHandler interface is properly defined
 * 2. Config can set and get OnAuthErrorHandler
 * 3. ConfigBaseCore follows the same pattern as BucketFailoverHandler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigBaseCore } from './configBaseCore.js';
import type { OnAuthErrorHandler } from './configTypes.js';

// Create a minimal concrete class extending ConfigBaseCore for testing
class TestConfig extends ConfigBaseCore {
  constructor() {
    // Initialize required fields with minimal values
    super();
    (this as unknown as Record<string, unknown>).sessionId = 'test-session';
    (this as unknown as Record<string, unknown>).targetDir = '/test/dir';
    (this as unknown as Record<string, unknown>).debugMode = false;
    (this as unknown as Record<string, unknown>).cwd = '/test/dir';
    (this as unknown as Record<string, unknown>).approvalMode = 'default';
    (this as unknown as Record<string, unknown>).showMemoryUsage = false;
    (this as unknown as Record<string, unknown>).llxprtMdFileCount = 0;
    (this as unknown as Record<string, unknown>).llxprtMdFilePaths = [];
    (this as unknown as Record<string, unknown>).userMemory = '';
    (this as unknown as Record<string, unknown>).maxSessionTurns = 50;
    (this as unknown as Record<string, unknown>).listExtensions = false;
    (this as unknown as Record<string, unknown>)._extensionLoader = {
      getExtensions: vi.fn().mockReturnValue([]),
    };
    (this as unknown as Record<string, unknown>)._activeExtensions = [];
    (this as unknown as Record<string, unknown>).enableExtensionReloading =
      false;
    (this as unknown as Record<string, unknown>).noBrowser = false;
    (this as unknown as Record<string, unknown>).folderTrust = false;
    (this as unknown as Record<string, unknown>).ideMode = false;
    (this as unknown as Record<string, unknown>).originalModel = 'test-model';
    (this as unknown as Record<string, unknown>).extensionContextFilePaths = [];
    (this as unknown as Record<string, unknown>).complexityAnalyzerSettings =
      {};
    (
      this as unknown as Record<string, unknown>
    ).loadMemoryFromIncludeDirectories = false;
    (this as unknown as Record<string, unknown>).interactive = false;
    (this as unknown as Record<string, unknown>).useRipgrep = true;
    (this as unknown as Record<string, unknown>).shouldUseNodePtyShell = false;
    (this as unknown as Record<string, unknown>).allowPtyThemeOverride = false;
    (this as unknown as Record<string, unknown>).ptyScrollbackLimit = 1000;
    (this as unknown as Record<string, unknown>).skipNextSpeakerCheck = false;
    (this as unknown as Record<string, unknown>).extensionManagement = false;
    (this as unknown as Record<string, unknown>).checkpointing = false;
    (this as unknown as Record<string, unknown>).dumpOnError = false;
    (this as unknown as Record<string, unknown>).usageStatisticsEnabled = false;
    (this as unknown as Record<string, unknown>).fileFiltering = {
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
      enableRecursiveFileSearch: true,
      disableFuzzySearch: false,
    };
    (this as unknown as Record<string, unknown>).continueOnFailedApiCall =
      false;
    (this as unknown as Record<string, unknown>).enableShellOutputEfficiency =
      false;
    (this as unknown as Record<string, unknown>).continueSession = false;
    (this as unknown as Record<string, unknown>).disableYoloMode = false;
    (this as unknown as Record<string, unknown>).enableHooks = false;
    (this as unknown as Record<string, unknown>).skillsSupport = false;
    (this as unknown as Record<string, unknown>).enableHooksUI = false;
    (this as unknown as Record<string, unknown>).outputSettings = {};
    (this as unknown as Record<string, unknown>).introspectionAgentSettings =
      {};
    (this as unknown as Record<string, unknown>).useWriteTodos = false;
    (this as unknown as Record<string, unknown>).accessibility = {};
    (this as unknown as Record<string, unknown>).telemetrySettings = {};
    (this as unknown as Record<string, unknown>).policyEngine = {};
    (this as unknown as Record<string, unknown>).fileExclusions = {};
    (this as unknown as Record<string, unknown>).storage = {
      getProjectTempDir: vi.fn().mockReturnValue('/tmp'),
    };
    (this as unknown as Record<string, unknown>).workspaceContext = {};
    (this as unknown as Record<string, unknown>).promptRegistry = {};
    (this as unknown as Record<string, unknown>).resourceRegistry = {};
    (this as unknown as Record<string, unknown>).toolRegistry = {};
    (this as unknown as Record<string, unknown>).skillManager = {};
    (this as unknown as Record<string, unknown>).settingsService = {};
    (this as unknown as Record<string, unknown>).fileSystemService = {};
    (this as unknown as Record<string, unknown>).geminiClient = {};
    (this as unknown as Record<string, unknown>).runtimeState = {};
    (this as unknown as Record<string, unknown>).outputFormat = {};
  }
}

describe('OnAuthErrorHandler config integration', () => {
  let config: TestConfig;

  beforeEach(() => {
    config = new TestConfig();
  });

  /**
   * @fix issue1861
   * Test that OnAuthErrorHandler interface can be implemented
   */
  it('should allow implementing OnAuthErrorHandler interface', async () => {
    const mockHandler: OnAuthErrorHandler = {
      handleAuthError: vi.fn().mockResolvedValue(undefined),
    };

    // Should be able to call the handler
    await mockHandler.handleAuthError({
      failedAccessToken: 'failed-token-123',
      providerId: 'anthropic',
      errorStatus: 401,
    });

    expect(mockHandler.handleAuthError).toHaveBeenCalledWith({
      failedAccessToken: 'failed-token-123',
      providerId: 'anthropic',
      errorStatus: 401,
    });
  });

  /**
   * @fix issue1861
   * Test that handler can include optional profileId
   */
  it('should support optional profileId in auth error context', async () => {
    const mockHandler: OnAuthErrorHandler = {
      handleAuthError: vi.fn().mockResolvedValue(undefined),
    };

    await mockHandler.handleAuthError({
      failedAccessToken: 'failed-token-123',
      providerId: 'anthropic',
      profileId: 'profile-1',
      errorStatus: 403,
    });

    expect(mockHandler.handleAuthError).toHaveBeenCalledWith(
      expect.objectContaining({
        failedAccessToken: 'failed-token-123',
        providerId: 'anthropic',
        profileId: 'profile-1',
        errorStatus: 403,
      }),
    );
  });

  /**
   * @fix issue1861
   * Test that ConfigBaseCore can set and get OnAuthErrorHandler
   * Following the same pattern as BucketFailoverHandler
   */
  it('should set and get OnAuthErrorHandler following BucketFailoverHandler pattern', () => {
    const mockHandler: OnAuthErrorHandler = {
      handleAuthError: vi.fn().mockResolvedValue(undefined),
    };

    // Initially should be undefined
    const initialHandler = config.getOnAuthErrorHandler();
    expect(initialHandler).toBeUndefined();

    // Set the handler
    config.setOnAuthErrorHandler(mockHandler);

    // Get should return the same handler
    const retrievedHandler = config.getOnAuthErrorHandler();
    expect(retrievedHandler).toBe(mockHandler);
  });

  /**
   * @fix issue1861
   * Test that setOnAuthErrorHandler can set undefined to clear handler
   */
  it('should allow clearing OnAuthErrorHandler by setting undefined', () => {
    const mockHandler: OnAuthErrorHandler = {
      handleAuthError: vi.fn().mockResolvedValue(undefined),
    };

    // Set the handler
    config.setOnAuthErrorHandler(mockHandler);
    expect(config.getOnAuthErrorHandler()).toBe(mockHandler);

    // Clear the handler
    config.setOnAuthErrorHandler(undefined);
    expect(config.getOnAuthErrorHandler()).toBeUndefined();
  });

  /**
   * @fix issue1861
   * Test that multiple handlers can be set (last one wins)
   */
  it('should use the most recently set handler', () => {
    const firstHandler: OnAuthErrorHandler = {
      handleAuthError: vi.fn().mockResolvedValue(undefined),
    };

    const secondHandler: OnAuthErrorHandler = {
      handleAuthError: vi.fn().mockResolvedValue(undefined),
    };

    config.setOnAuthErrorHandler(firstHandler);
    expect(config.getOnAuthErrorHandler()).toBe(firstHandler);

    config.setOnAuthErrorHandler(secondHandler);
    expect(config.getOnAuthErrorHandler()).toBe(secondHandler);
  });
});
