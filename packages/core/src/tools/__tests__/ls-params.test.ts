/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach } from 'vitest';
import { LSTool } from '../ls.js';
import { Config } from '../../config/config.js';
import { WorkspaceContext } from '../../utils/workspaceContext.js';
import { StandardFileSystemService } from '../../services/fileSystemService.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

/**
 * Phase 2 TEST for Consistent Params - ls (list_directory) tool
 *
 * REQUIREMENT: Verify that dir_path is the PRIMARY parameter (not path).
 * UPSTREAM PATTERN: For directory parameters: path → dir_path (from commit f05d937f39)
 *
 * These tests MUST FAIL initially because ls currently uses path as primary.
 */

describe('list_directory parameter consistency', () => {
  let config: Config;
  let testDir: string;

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ls-params-test-'));

    // Create a test file to list
    await fs.writeFile(path.join(testDir, 'test.txt'), 'content');

    // Setup config with test directory as workspace
    const workspaceContext = new WorkspaceContext([testDir]);
    config = new Config({
      workspaceContext,
      fileSystemService: new StandardFileSystemService(),
      targetDir: testDir,
    });
  });

  it('should accept dir_path as primary parameter', async () => {
    // Arrange
    const tool = new LSTool(config);
    const params = {
      dir_path: testDir, // Using PRIMARY parameter
      // NOT providing path
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

  it('should accept path as legacy alias', async () => {
    // Arrange
    const tool = new LSTool(config);
    const params = {
      path: testDir, // Using LEGACY parameter
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

  it('should prefer dir_path over path when both provided', async () => {
    // Arrange
    const tool = new LSTool(config);
    const subDir = path.join(testDir, 'subdir');
    await fs.mkdir(subDir);
    const params = {
      dir_path: testDir, // Primary parameter
      path: subDir, // Legacy parameter (different path)
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

  it('should normalize path to dir_path internally', async () => {
    // Arrange
    const tool = new LSTool(config);
    const params = {
      path: testDir, // Only providing legacy parameter
    };

    // Act
    const invocation = (tool as any).createInvocation(params);

    // Assert
    expect(invocation).toBeDefined();
    // CRITICAL: After normalization, dir_path should be populated
    expect((invocation as any).params.dir_path).toBe(testDir);
    // Original path should still be present
    expect((invocation as any).params.path).toBe(testDir);
  });

  it('should reject when neither dir_path nor path provided', async () => {
    // Arrange
    const tool = new LSTool(config);
    const params = {
      // NOT providing dir_path
      // NOT providing path
      // (REQUIRED for ls - must provide a directory)
    };

    // Act
    const validation = (tool as any).validateToolParamValues(params);

    // Assert
    // Should fail validation with clear error message
    expect(validation).not.toBeNull();
    expect(validation?.toLowerCase()).toContain('dir_path');
    expect(validation?.toLowerCase()).toContain('path');
  });

  it('should validate dir_path is absolute', async () => {
    // Arrange
    const tool = new LSTool(config);
    const relativePath = 'relative/path';
    const params = {
      dir_path: relativePath, // Invalid: relative path
    };

    // Act
    const validation = (tool as any).validateToolParamValues(params);

    // Assert
    // Should fail validation because path is not absolute
    expect(validation).not.toBeNull();
    expect(validation?.toLowerCase()).toContain('absolute');
  });

  it('should have dir_path as first property in schema', () => {
    // Arrange
    const tool = new LSTool(config);

    // Act
    const schema = tool.schema.parametersJsonSchema;
    const properties = schema.properties;
    const propertyKeys = Object.keys(properties);

    // Assert
    // dir_path should be listed first (primary directory parameter)
    expect(propertyKeys[0]).toBe('dir_path');
    // path should be listed as secondary (for backward compat)
    expect(propertyKeys).toContain('path');
  });

  it('should describe dir_path as primary in schema description', () => {
    // Arrange
    const tool = new LSTool(config);

    // Act
    const schema = tool.schema.parametersJsonSchema;
    const dirPathDesc = schema.properties.dir_path?.description;
    const pathDesc = schema.properties.path?.description;

    // Assert
    // dir_path description should mention it's the path to the directory
    expect(dirPathDesc).toBeDefined();
    expect(dirPathDesc?.toLowerCase()).toContain('path to the directory');
    expect(dirPathDesc?.toLowerCase()).not.toContain('alternative');
    expect(dirPathDesc?.toLowerCase()).not.toContain('compatibility');

    // path description SHOULD mention it's for backward compatibility
    expect(pathDesc).toBeDefined();
    expect(pathDesc?.toLowerCase()).toContain('alternative');
    expect(pathDesc?.toLowerCase()).toContain('compatibility');
  });
});
