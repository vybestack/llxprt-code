import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { WorkspaceContext } from '../workspaceContext.js';
import { resolveTextSearchTarget } from '../resolveTextSearchTarget.js';

describe('resolveTextSearchTarget', () => {
  let tempDir: string;
  let workspaceContext: WorkspaceContext;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'resolve-search-target-'),
    );
    await fs.mkdir(path.join(tempDir, 'sub'));
    await fs.writeFile(path.join(tempDir, 'file.txt'), 'content');
    await fs.writeFile(path.join(tempDir, 'sub', 'nested.txt'), 'nested');
    workspaceContext = new WorkspaceContext(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should return kind all-workspaces when no path provided', () => {
    const result = resolveTextSearchTarget(tempDir, workspaceContext);
    expect(result).toEqual({ kind: 'all-workspaces' });
  });

  it('should return kind all-workspaces when path is undefined', () => {
    const result = resolveTextSearchTarget(
      tempDir,
      workspaceContext,
      undefined,
    );
    expect(result).toEqual({ kind: 'all-workspaces' });
  });

  it('should return kind all-workspaces when path is empty string', () => {
    const result = resolveTextSearchTarget(tempDir, workspaceContext, '');
    expect(result).toEqual({ kind: 'all-workspaces' });
  });

  it('should return kind directory for valid directory path', () => {
    const result = resolveTextSearchTarget(tempDir, workspaceContext, 'sub');
    expect(result.kind).toBe('directory');
    if (result.kind === 'directory') {
      expect(result.searchDir).toBe(path.join(tempDir, 'sub'));
    }
  });

  it('should return kind file with filePath, parentDir, basename for valid file path', () => {
    const result = resolveTextSearchTarget(
      tempDir,
      workspaceContext,
      'file.txt',
    );
    expect(result.kind).toBe('file');
    if (result.kind === 'file') {
      expect(result.filePath).toBe(path.join(tempDir, 'file.txt'));
      expect(result.parentDir).toBe(tempDir);
      expect(result.basename).toBe('file.txt');
    }
  });

  it('should return kind file for nested file path', () => {
    const result = resolveTextSearchTarget(
      tempDir,
      workspaceContext,
      path.join('sub', 'nested.txt'),
    );
    expect(result.kind).toBe('file');
    if (result.kind === 'file') {
      expect(result.filePath).toBe(path.join(tempDir, 'sub', 'nested.txt'));
      expect(result.parentDir).toBe(path.join(tempDir, 'sub'));
      expect(result.basename).toBe('nested.txt');
    }
  });

  it('should throw for path outside workspace', () => {
    expect(() =>
      resolveTextSearchTarget(tempDir, workspaceContext, '../outside'),
    ).toThrow(/Path validation failed/);
  });

  it('should throw with clear message for non-existent path', () => {
    expect(() =>
      resolveTextSearchTarget(tempDir, workspaceContext, 'nonexistent'),
    ).toThrow(/Path does not exist/);
  });

  it('should handle absolute directory path', () => {
    const absPath = path.join(tempDir, 'sub');
    const result = resolveTextSearchTarget(tempDir, workspaceContext, absPath);
    expect(result.kind).toBe('directory');
    if (result.kind === 'directory') {
      expect(result.searchDir).toBe(absPath);
    }
  });

  it('should handle absolute file path', () => {
    const absPath = path.join(tempDir, 'file.txt');
    const result = resolveTextSearchTarget(tempDir, workspaceContext, absPath);
    expect(result.kind).toBe('file');
    if (result.kind === 'file') {
      expect(result.filePath).toBe(absPath);
      expect(result.parentDir).toBe(tempDir);
      expect(result.basename).toBe('file.txt');
    }
  });

  it('should handle relative path with dot prefix', () => {
    const result = resolveTextSearchTarget(tempDir, workspaceContext, './sub');
    expect(result.kind).toBe('directory');
    if (result.kind === 'directory') {
      expect(result.searchDir).toBe(path.join(tempDir, 'sub'));
    }
  });

  it('should handle dot path as directory', () => {
    const result = resolveTextSearchTarget(tempDir, workspaceContext, '.');
    expect(result.kind).toBe('directory');
    if (result.kind === 'directory') {
      expect(result.searchDir).toBe(tempDir);
    }
  });
});
