/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach } from 'vitest';
import { ShellTool } from '../shell.js';
import { Config } from '../../config/config.js';
import { WorkspaceContext } from '../../utils/workspaceContext.js';
import { StandardFileSystemService } from '../../services/fileSystemService.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

/**
 * Phase 3 TEST for Consistent Params - shell tool
 *
 * REQUIREMENT: Verify that dir_path is the PRIMARY parameter (not directory).
 * UPSTREAM PATTERN: For directory parameters: directory → dir_path (from commit f05d937f39)
 * This aligns with glob/grep/ls which also use dir_path.
 *
 * These tests MUST FAIL initially because shell currently uses directory as primary.
 */

describe('shell parameter consistency', () => {
  let config: Config;
  let testDir: string;

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shell-params-test-'));

    // Setup config with test directory as workspace
    const workspaceContext = new WorkspaceContext([testDir]);
    config = new Config({
      workspaceContext,
      fileSystemService: new StandardFileSystemService(),
      targetDir: testDir,
    });
  });

  it('should accept dir_path as primary parameter', () => {
    // Arrange
    const tool = new ShellTool(config);
    const params = {
      command: 'echo hello',
      dir_path: testDir, // Using PRIMARY parameter
      // NOT providing directory
    };

    // Act
    const validation = (tool as any).validateToolParamValues(params);
    const invocation = (tool as any).createInvocation(params);

    // Assert
    expect(validation).toBeNull(); // Should pass validation
    expect(invocation).toBeDefined();
    // CRITICAL: The invocation should use dir_path internally
    expect((invocation as any).params.dir_path).toBe(testDir);
  });

  it('should accept directory as legacy alias', () => {
    // Arrange
    const tool = new ShellTool(config);
    const params = {
      command: 'echo hello',
      directory: testDir, // Using LEGACY parameter
      // NOT providing dir_path
    };

    // Act
    const validation = (tool as any).validateToolParamValues(params);
    const invocation = (tool as any).createInvocation(params);

    // Assert
    expect(validation).toBeNull(); // Should pass validation for backward compat
    expect(invocation).toBeDefined();
    // After normalization, dir_path should be set internally
    expect((invocation as any).params.dir_path).toBe(testDir);
  });

  it('should prefer dir_path over directory when both provided', async () => {
    // Arrange
    const tool = new ShellTool(config);
    const subDir = path.join(testDir, 'subdir');
    await fs.mkdir(subDir);
    const params = {
      command: 'echo hello',
      dir_path: testDir, // Primary parameter
      directory: subDir, // Legacy parameter (different path)
    };

    // Act
    const validation = (tool as any).validateToolParamValues(params);
    const invocation = (tool as any).createInvocation(params);

    // Assert
    expect(validation).toBeNull();
    expect(invocation).toBeDefined();
    // CRITICAL: When both are provided, dir_path should take precedence
    expect((invocation as any).params.dir_path).toBe(testDir);
  });

  it('should normalize directory to dir_path internally', () => {
    // Arrange
    const tool = new ShellTool(config);
    const params = {
      command: 'echo hello',
      directory: testDir, // Only providing legacy parameter
    };

    // Act
    const invocation = (tool as any).createInvocation(params);

    // Assert
    expect(invocation).toBeDefined();
    // CRITICAL: After normalization, dir_path should be populated
    expect((invocation as any).params.dir_path).toBe(testDir);
    // Original directory should still be present
    expect((invocation as any).params.directory).toBe(testDir);
  });

  it('should use current directory when neither dir_path nor directory provided', () => {
    // Arrange
    const tool = new ShellTool(config);
    const params = {
      command: 'echo hello',
      // NOT providing dir_path
      // NOT providing directory
      // (Optional for shell - defaults to current directory)
    };

    // Act
    const validation = (tool as any).validateToolParamValues(params);
    const invocation = (tool as any).createInvocation(params);

    // Assert
    // Should pass validation (directory is optional for shell)
    expect(validation).toBeNull();
    expect(invocation).toBeDefined();
    // Should default to current directory behavior
  });

  it('should have dir_path as first directory parameter in schema', () => {
    // Arrange
    const tool = new ShellTool(config);

    // Act
    const schema = tool.schema.parametersJsonSchema;
    const properties = schema.properties;
    const propertyKeys = Object.keys(properties);

    // Assert
    // command is required and should be first
    expect(propertyKeys[0]).toBe('command');
    // description is second
    expect(propertyKeys[1]).toBe('description');
    // dir_path should be listed as the first directory parameter (third overall)
    expect(propertyKeys[2]).toBe('dir_path');
    // directory should be listed as secondary (for backward compat)
    expect(propertyKeys).toContain('directory');
    // dir_path should come before directory
    const dirPathIndex = propertyKeys.indexOf('dir_path');
    const directoryIndex = propertyKeys.indexOf('directory');
    expect(dirPathIndex).toBeLessThan(directoryIndex);
  });

  it('should describe dir_path appropriately in schema', () => {
    // Arrange
    const tool = new ShellTool(config);

    // Act
    const schema = tool.schema.parametersJsonSchema;
    const dirPathDesc = schema.properties.dir_path?.description;

    // Assert
    // dir_path description should mention it's the path to run the command in
    expect(dirPathDesc).toBeDefined();
    expect(dirPathDesc?.toLowerCase()).toContain('directory');
    expect(dirPathDesc?.toLowerCase()).not.toContain('alternative');
    expect(dirPathDesc?.toLowerCase()).not.toContain('backward');
  });

  it('should describe directory as legacy/alternative in schema', () => {
    // Arrange
    const tool = new ShellTool(config);

    // Act
    const schema = tool.schema.parametersJsonSchema;
    const directoryDesc = schema.properties.directory?.description;

    // Assert
    // directory description should mention it's for backward compatibility
    if (directoryDesc) {
      expect(directoryDesc.toLowerCase()).toMatch(
        /alternative|backward|legacy|compat/,
      );
    }
  });
});
