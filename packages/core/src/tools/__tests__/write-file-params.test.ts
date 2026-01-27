/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach } from 'vitest';
import { WriteFileTool } from '../write-file.js';
import { Config } from '../../config/config.js';
import { WorkspaceContext } from '../../utils/workspaceContext.js';
import { StandardFileSystemService } from '../../services/fileSystemService.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

/**
 * Phase 1 TEST for Consistent Params - write-file tool
 *
 * REQUIREMENT: Verify that absolute_path is the PRIMARY parameter (not file_path).
 * REFERENCE: Read-file tool already migrated with this pattern.
 *
 * These tests MUST FAIL initially because write-file currently uses file_path as primary.
 */

describe('write_file parameter consistency', () => {
  let config: Config;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'write-file-params-test-'),
    );
    testFilePath = path.join(testDir, 'test.txt');

    // Setup config with test directory as workspace
    const workspaceContext = new WorkspaceContext([testDir]);
    config = new Config({
      workspaceContext,
      fileSystemService: new StandardFileSystemService(),
      targetDir: testDir,
    });
  });

  it('should accept absolute_path as primary parameter', async () => {
    // Arrange
    const tool = new WriteFileTool(config);
    const params = {
      absolute_path: testFilePath, // Using PRIMARY parameter
      // NOT providing file_path
      content: 'test content',
    };

    // Act
    const validation = (tool as any).validateToolParamValues(params);
    const invocation = (tool as any).createInvocation(params);

    // Assert
    expect(validation).toBeNull(); // Should pass validation
    expect(invocation).toBeDefined();
    // CRITICAL: The invocation should use absolute_path internally
    expect((invocation as any).params.absolute_path).toBe(testFilePath);
  });

  it('should accept file_path as legacy alias', async () => {
    // Arrange
    const tool = new WriteFileTool(config);
    const params = {
      file_path: testFilePath, // Using LEGACY parameter
      // NOT providing absolute_path
      content: 'test content',
    };

    // Act
    const validation = (tool as any).validateToolParamValues(params);
    const invocation = (tool as any).createInvocation(params);

    // Assert
    expect(validation).toBeNull(); // Should pass validation for backward compat
    expect(invocation).toBeDefined();
    // After normalization, absolute_path should be set internally
    expect((invocation as any).params.absolute_path).toBe(testFilePath);
  });

  it('should prefer absolute_path over file_path when both provided', async () => {
    // Arrange
    const tool = new WriteFileTool(config);
    const alternativePath = path.join(testDir, 'alternative.txt');
    const params = {
      absolute_path: testFilePath, // Primary parameter
      file_path: alternativePath, // Legacy parameter (different path)
      content: 'test content',
    };

    // Act
    const validation = (tool as any).validateToolParamValues(params);
    const invocation = (tool as any).createInvocation(params);

    // Assert
    expect(validation).toBeNull();
    expect(invocation).toBeDefined();
    // CRITICAL: When both are provided, absolute_path should take precedence
    expect((invocation as any).params.absolute_path).toBe(testFilePath);
    // Validation should have used absolute_path, not file_path
  });

  it('should normalize file_path to absolute_path internally', async () => {
    // Arrange
    const tool = new WriteFileTool(config);
    const params = {
      file_path: testFilePath, // Only providing legacy parameter
      content: 'test content',
    };

    // Act
    const invocation = (tool as any).createInvocation(params);

    // Assert
    expect(invocation).toBeDefined();
    // CRITICAL: After normalization, absolute_path should be populated
    expect((invocation as any).params.absolute_path).toBe(testFilePath);
    // Original file_path should still be present
    expect((invocation as any).params.file_path).toBe(testFilePath);
  });

  it('should reject when neither absolute_path nor file_path provided', async () => {
    // Arrange
    const tool = new WriteFileTool(config);
    const params = {
      // NOT providing absolute_path
      // NOT providing file_path
      content: 'test content',
    };

    // Act
    const validation = (tool as any).validateToolParamValues(params);

    // Assert
    // Should fail validation with clear error message
    expect(validation).not.toBeNull();
    expect(validation).toContain('absolute_path');
    expect(validation).toContain('file_path');
  });

  it('should validate absolute_path in schema validation', async () => {
    // Arrange
    const tool = new WriteFileTool(config);
    const relativePath = 'relative/path.txt';
    const params = {
      absolute_path: relativePath, // Invalid: relative path
      content: 'test content',
    };

    // Act
    const validation = (tool as any).validateToolParamValues(params);

    // Assert
    // Should fail validation because path is not absolute
    expect(validation).not.toBeNull();
    expect(validation?.toLowerCase()).toContain('absolute');
  });

  it('should have absolute_path as first property in schema', () => {
    // Arrange
    const tool = new WriteFileTool(config);

    // Act
    const schema = tool.schema.parametersJsonSchema;
    const properties = schema.properties;
    const propertyKeys = Object.keys(properties);

    // Assert
    // absolute_path should be listed first (primary parameter)
    expect(propertyKeys[0]).toBe('absolute_path');
    // file_path should be listed as secondary (for backward compat)
    expect(propertyKeys).toContain('file_path');
  });

  it('should describe absolute_path as primary in schema description', () => {
    // Arrange
    const tool = new WriteFileTool(config);

    // Act
    const schema = tool.schema.parametersJsonSchema;
    const absolutePathDesc = schema.properties.absolute_path?.description;
    const filePathDesc = schema.properties.file_path?.description;

    // Assert
    // absolute_path description should NOT mention it's an alias
    expect(absolutePathDesc).toBeDefined();
    expect(absolutePathDesc?.toLowerCase()).not.toContain('alternative');
    expect(absolutePathDesc?.toLowerCase()).not.toContain('compatibility');

    // file_path description SHOULD mention it's for backward compatibility
    expect(filePathDesc).toBeDefined();
    expect(filePathDesc?.toLowerCase()).toContain('alternative');
    expect(filePathDesc?.toLowerCase()).toContain('compatibility');
  });
});
