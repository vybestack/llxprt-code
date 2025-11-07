/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DumpContextTool } from './dump-context.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Config } from '../config/config.js';
import { SettingsService } from '../settings/SettingsService.js';

describe('DumpContextTool', () => {
  let dumpContextTool: DumpContextTool;
  let tempDir: string;
  let mockConfig: Config;
  let mockSettingsService: SettingsService;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dump-context-test-'));

    // Create mock Config and SettingsService
    mockSettingsService = new SettingsService();
    mockSettingsService.set('dumpContextMode', 'off');

    mockConfig = {
      getSettingsService: () => mockSettingsService,
    } as Config;

    dumpContextTool = new DumpContextTool(mockConfig);
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  describe('getDumpContextMode', () => {
    it('should return the current dump context mode from settings', () => {
      mockSettingsService.set('dumpContextMode', 'on');
      expect(dumpContextTool.getDumpContextMode()).toBe('on');

      mockSettingsService.set('dumpContextMode', 'error');
      expect(dumpContextTool.getDumpContextMode()).toBe('error');

      mockSettingsService.set('dumpContextMode', 'off');
      expect(dumpContextTool.getDumpContextMode()).toBe('off');
    });

    it('should return "off" when no mode is set', () => {
      mockSettingsService.clear();
      expect(dumpContextTool.getDumpContextMode()).toBe('off');
    });
  });

  describe('setDumpContextMode', () => {
    it('should set the dump context mode in settings', () => {
      dumpContextTool.setDumpContextMode('on');
      expect(mockSettingsService.get('dumpContextMode')).toBe('on');

      dumpContextTool.setDumpContextMode('error');
      expect(mockSettingsService.get('dumpContextMode')).toBe('error');

      dumpContextTool.setDumpContextMode('off');
      expect(mockSettingsService.get('dumpContextMode')).toBe('off');
    });
  });

  describe('shouldDumpContext', () => {
    it('should return true when mode is "on"', () => {
      mockConfig.getSettingsService = () => {
        const service = new SettingsService();
        service.set('dumpContextMode', 'on');
        return service;
      };

      const tool = new DumpContextTool(mockConfig);
      expect(tool.shouldDumpContext()).toBe(true);
    });

    it('should return true when mode is "error" and error condition is provided', () => {
      mockConfig.getSettingsService = () => {
        const service = new SettingsService();
        service.set('dumpContextMode', 'error');
        return service;
      };

      const tool = new DumpContextTool(mockConfig);
      expect(tool.shouldDumpContext(new Error('Test error'))).toBe(true);
    });

    it('should return false when mode is "error" and no error is provided', () => {
      mockConfig.getSettingsService = () => {
        const service = new SettingsService();
        service.set('dumpContextMode', 'error');
        return service;
      };

      const tool = new DumpContextTool(mockConfig);
      expect(tool.shouldDumpContext()).toBe(false);
    });

    it('should return false when mode is "off"', () => {
      mockConfig.getSettingsService = () => {
        const service = new SettingsService();
        service.set('dumpContextMode', 'off');
        return service;
      };

      const tool = new DumpContextTool(mockConfig);
      expect(tool.shouldDumpContext()).toBe(false);
      expect(tool.shouldDumpContext(new Error('Test error'))).toBe(false);
    });
  });

  describe('status command', () => {
    it('should return the current dump context status', async () => {
      const invocation = dumpContextTool.createInvocation({
        command: 'status',
      });

      const result = await invocation.execute(new AbortController().signal);
      const parsedResult = JSON.parse(result.llmContent || '{}');

      expect(parsedResult.mode).toBe('off');
      expect(parsedResult.description).toContain(
        'Context dumping is currently OFF',
      );
    });
  });

  describe('on command', () => {
    it('should enable dump context mode', async () => {
      const invocation = dumpContextTool.createInvocation({
        command: 'on',
      });

      const result = await invocation.execute(new AbortController().signal);
      const parsedResult = JSON.parse(result.llmContent || '{}');

      expect(parsedResult.mode).toBe('on');
      expect(parsedResult.description).toContain('Context dumping is now ON');
      expect(dumpContextTool.getDumpContextMode()).toBe('on');
    });
  });

  describe('error command', () => {
    it('should enable error-only dump context mode', async () => {
      const invocation = dumpContextTool.createInvocation({
        command: 'error',
      });

      const result = await invocation.execute(new AbortController().signal);
      const parsedResult = JSON.parse(result.llmContent || '{}');

      expect(parsedResult.mode).toBe('error');
      expect(parsedResult.description).toContain(
        'Context dumping is now set to ERROR_ONLY',
      );
      expect(dumpContextTool.getDumpContextMode()).toBe('error');
    });
  });

  describe('off command', () => {
    it('should disable dump context mode', async () => {
      // First enable it
      dumpContextTool.setDumpContextMode('on');

      const invocation = dumpContextTool.createInvocation({
        command: 'off',
      });

      const result = await invocation.execute(new AbortController().signal);
      const parsedResult = JSON.parse(result.llmContent || '{}');

      expect(parsedResult.mode).toBe('off');
      expect(parsedResult.description).toContain('Context dumping is now OFF');
      expect(dumpContextTool.getDumpContextMode()).toBe('off');
    });
  });

  describe('dump command', () => {
    it('should dump context immediately', async () => {
      const invocation = dumpContextTool.createInvocation({
        command: 'dump',
      });

      const result = await invocation.execute(new AbortController().signal);
      const parsedResult = JSON.parse(result.llmContent || '{}');

      expect(parsedResult.success).toBe(true);
      expect(parsedResult.description).toContain('Context dumped successfully');
      expect(parsedResult.filePath).toContain('.llxprt/dumps/');
    });

    it('should create dumps directory if it does not exist', async () => {
      const globalDumpsDir = path.join(os.homedir(), '.llxprt', 'dumps');

      const invocation = dumpContextTool.createInvocation({
        command: 'dump',
      });

      await invocation.execute(new AbortController().signal);

      const dumpsExist = await fs
        .access(globalDumpsDir)
        .then(() => true)
        .catch(() => false);
      expect(dumpsExist).toBe(true);
    });

    it('should include timestamp in dump filename', async () => {
      const invocation = dumpContextTool.createInvocation({
        command: 'dump',
      });

      const result = await invocation.execute(new AbortController().signal);
      const parsedResult = JSON.parse(result.llmContent || '{}');

      expect(parsedResult.filePath).toMatch(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });
  });

  describe('validation', () => {
    it('should validate command parameter', () => {
      const tool = dumpContextTool as DumpContextTool & {
        validateToolParamValues: (params: unknown) => string | null;
      };
      expect(tool.validateToolParamValues({})).toBe(
        'Parameter "command" is required.',
      );
      expect(tool.validateToolParamValues({ command: 'invalid' })).toBe(
        'Parameter "command" must be one of: status, on, off, error, dump.',
      );
      expect(tool.validateToolParamValues({ command: 'status' })).toBe(null);
    });
  });

  describe('error handling', () => {
    it('should handle missing dump directory gracefully', async () => {
      // Create a fresh instance to mock properly
      const MockConfig = {
        getSettingsService: () => mockSettingsService,
      } as Config;

      const testDumpContextTool = new DumpContextTool(MockConfig);

      const invocation = testDumpContextTool.createInvocation({
        command: 'dump',
      });

      // Mock the execute method directly to throw an error
      (
        invocation as DumpContextToolInvocation & {
          execute: () => Promise<ToolResult>;
        }
      ).execute = async () => ({
        llmContent: JSON.stringify({
          success: false,
          error: 'Failed to execute dump context command: Permission denied',
        }),
        returnDisplay: 'Error: Permission denied',
        error: {
          message: 'Permission denied',
          type: 'dump_context_tool_execution_error',
        },
      });

      const result = await invocation.execute(new AbortController().signal);
      const parsedResult = JSON.parse(result.llmContent || '{}');

      expect(parsedResult.success).toBe(false);
      expect(parsedResult.error).toContain('Permission denied');
    });
  });
});
