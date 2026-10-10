/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Config } from './config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '../session/session-settings-owner.js';
import { WorkspaceFilesystemOwner } from '../services/workspace-filesystem-owner.js';
import { CoreShellToolHostAdapter } from '../tools-adapters/CoreShellToolHostAdapter.js';

describe('Session-owned ephemeral settings', () => {
  let settings: SettingsService;
  let owner: SessionSettingsOwner;
  let shell: CoreShellToolHostAdapter;

  beforeEach(() => {
    settings = new SettingsService();
    owner = new SessionSettingsOwner(settings);
    const config = new Config({
      model: 'test-model',
      question: 'test question',
      embeddingModel: 'test-embedding',
      targetDir: '.',
      usageStatisticsEnabled: false,
      sessionId: 'test-session',
      debugMode: false,
      cwd: '.',
    });
    const workspace = new WorkspaceFilesystemOwner({
      targetDir: config.getTargetDir(),
      isTrusted: () => true,
    });
    shell = new CoreShellToolHostAdapter(config, workspace.paths, () =>
      owner.readToolExecutionPolicy(),
    );
  });

  describe('task-continuation setting', () => {
    /**
     * @requirement REQ-004.2
     * @scenario Setting defaults to true when unset
     * @given No task-continuation setting configured
     * @when getEphemeralSetting('task-continuation') called
     * @then Returns undefined (not true) - services handle the default logic
     */
    it('should return undefined for unset task-continuation setting', () => {
      // When no setting is configured
      const result = owner.readNamedParameter('todo-continuation');

      // Then it returns undefined (services handle default logic)
      expect(result).toBeUndefined();
    });

    /**
     * @requirement REQ-004.1
     * @scenario Explicit true value preserved
     * @given task-continuation set to true
     * @when getEphemeralSetting('task-continuation') called
     * @then Returns true
     */
    it('should return true when explicitly set to true', () => {
      // Given setting is explicitly set to true
      owner.writeUserParameter('todo-continuation', true);

      // When getting the setting
      const result = owner.readNamedParameter('todo-continuation');

      // Then it returns true
      expect(result).toBe(true);
    });

    /**
     * @requirement REQ-004.1
     * @scenario Explicit false value preserved
     * @given task-continuation set to false
     * @when getEphemeralSetting('task-continuation') called
     * @then Returns false
     */
    it('should return false when explicitly set to false', () => {
      // Given setting is explicitly set to false
      owner.writeUserParameter('todo-continuation', false);

      // When getting the setting
      const result = owner.readNamedParameter('todo-continuation');

      // Then it returns false
      expect(result).toBe(false);
    });

    /**
     * @requirement REQ-004.2
     * @scenario Service treats undefined as true
     * @given No setting configured
     * @when taskContinuationService checks setting
     * @then Continuation is enabled
     */
    it('should demonstrate service behavior with undefined setting', () => {
      // Given no setting configured
      const ephemeralSetting = owner.readNamedParameter('todo-continuation');

      // When service checks the setting (simulating service logic)
      const continuationEnabled = ephemeralSetting !== false; // This is how the service treats undefined

      // Then continuation is enabled (undefined !== false is true)
      expect(ephemeralSetting).toBeUndefined();
      expect(continuationEnabled).toBe(true);
    });

    it('should demonstrate service behavior with explicit false', () => {
      // Given setting is explicitly set to false
      owner.writeUserParameter('todo-continuation', false);
      const ephemeralSetting = owner.readNamedParameter('todo-continuation');

      // When service checks the setting (simulating service logic)
      const continuationEnabled = ephemeralSetting !== false; // This is how the service treats false

      // Then continuation is disabled (false !== false is false)
      expect(ephemeralSetting).toBe(false);
      expect(continuationEnabled).toBe(false);
    });

    it('should demonstrate service behavior with explicit true', () => {
      // Given setting is explicitly set to true
      owner.writeUserParameter('todo-continuation', true);
      const ephemeralSetting = owner.readNamedParameter('todo-continuation');

      // When service checks the setting (simulating service logic)
      const continuationEnabled = ephemeralSetting !== false; // This is how the service treats true

      // Then continuation is enabled (true !== false is true)
      expect(ephemeralSetting).toBe(true);
      expect(continuationEnabled).toBe(true);
    });
  });

  describe('shell acquisition setting', () => {
    it('preserves an absent retention limit for downstream default resolution', () => {
      expect(
        shell.getShellExecutionConfig().executionOptions
          .outputRetentionMaxBytes,
      ).toBeUndefined();

      owner.writeUserParameter('shell-output-retention-max-bytes', -1);

      expect(
        shell.getShellExecutionConfig().executionOptions
          .outputRetentionMaxBytes,
      ).toBe(-1);
    });
  });

  describe('ephemeral settings persistence', () => {
    it('should persist ephemeral setting values across get/set operations', () => {
      // Given multiple ephemeral settings
      owner.writeUserParameter('todo-continuation', false);
      owner.writeUserParameter('shell-replacement', true);
      owner.writeUserParameter('tool-output-max-items', 100);

      // When getting the settings
      const todoContinuation = owner.readNamedParameter('todo-continuation');
      const shellReplacement = owner.readNamedParameter('shell-replacement');
      const maxItems = owner.readNamedParameter('tool-output-max-items');

      // Then all values are preserved
      expect(todoContinuation).toBe(false);
      expect(shellReplacement).toBe(true);
      expect(maxItems).toBe(100);
    });

    it('should normalize legacy boolean streaming values when reading settings', () => {
      const settingsService = settings;

      settingsService.set('streaming', false);

      expect(owner.readNamedParameter('streaming')).toBe('disabled');
      expect(owner.captureNamedParameters().streaming).toBe('disabled');

      settingsService.set('streaming', true);

      expect(owner.readNamedParameter('streaming')).toBe('enabled');
      expect(owner.captureNamedParameters().streaming).toBe('enabled');
    });

    it('should return copy of all ephemeral settings', () => {
      // Given multiple ephemeral settings
      owner.writeUserParameter('todo-continuation', true);
      owner.writeUserParameter('custom-setting', 'test-value');

      // When getting all settings
      const allSettings = { ...owner.captureNamedParameters() };

      // Then it returns a copy with all settings
      expect(allSettings).toStrictEqual({
        'todo-continuation': true,
        'custom-setting': 'test-value',
      });

      // And modifying the returned object doesn't affect the config
      allSettings['new-setting'] = 'should-not-affect-config';
      expect(owner.readNamedParameter('new-setting')).toBeUndefined();
    });
  });

  describe('type safety', () => {
    it('should handle different value types for ephemeral settings', () => {
      // Boolean values
      owner.writeUserParameter('todo-continuation', false);
      expect(owner.readNamedParameter('todo-continuation')).toBe(false);

      // Number values
      owner.writeUserParameter('tool-output-max-items', 50);
      expect(owner.readNamedParameter('tool-output-max-items')).toBe(50);

      // String values
      owner.writeUserParameter('auth-key', 'test-key');
      expect(owner.readNamedParameter('auth-key')).toBe('test-key');

      // Object values
      const headers = { 'Content-Type': 'application/json' };
      owner.writeUserParameter('custom-headers', headers);
      expect(owner.readNamedParameter('custom-headers')).toStrictEqual(headers);
    });
  });
});
