/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
  setSystemTime,
} from 'bun:test';
import {
  getEnvironmentContext,
  getDirectoryContextString,
} from './environmentContext.js';
import type { Config } from '../config/config.js';
import { getFolderStructure } from './getFolderStructure.js';

vi.mock('../config/config.js');
vi.mock('./getFolderStructure.js', () => ({
  getFolderStructure: vi.fn(),
}));
vi.mock('@vybestack/llxprt-code-tools');

describe('getDirectoryContextString', () => {
  let mockConfig: Partial<Config>;

  beforeEach(() => {
    mockConfig = {
      getWorkspaceContext: vi.fn().mockReturnValue({
        getDirectories: vi.fn().mockReturnValue(['/test/dir']),
      }),
      getFileService: vi.fn(),
      getEnvironmentMemory: vi.fn().mockReturnValue(''),
    };
    (getFolderStructure as Mock<typeof getFolderStructure>).mockResolvedValue(
      'Mock<(...args: never[]) => unknown> Folder Structure',
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should return context string for a single directory', async () => {
    const contextString = await getDirectoryContextString(mockConfig as Config);
    expect(contextString).toContain(
      "I'm currently working in the directory: /test/dir",
    );
    expect(contextString).toContain(
      'Here is the folder structure of the current working directories:\n\nMock Folder Structure',
    );
  });

  it('should return context string for multiple directories', async () => {
    (
      (
        mockConfig.getWorkspaceContext! as Mock<
          typeof mockConfig.getWorkspaceContext
        >
      )().getDirectories as Mock<(...args: never[]) => unknown>
    ).mockReturnValue(['/test/dir1', '/test/dir2']);
    (getFolderStructure as Mock<typeof getFolderStructure>)
      .mockResolvedValueOnce('Structure 1')
      .mockResolvedValueOnce('Structure 2');

    const contextString = await getDirectoryContextString(mockConfig as Config);
    expect(contextString).toContain(
      "I'm currently working in the following directories:\n  - /test/dir1\n  - /test/dir2",
    );
    expect(contextString).toContain(
      'Here is the folder structure of the current working directories:\n\nStructure 1\nStructure 2',
    );
  });
});

describe('getEnvironmentContext', () => {
  let mockConfig: Partial<Config>;
  let mockToolRegistry: { getTool: Mock<(...args: never[]) => unknown> };

  beforeEach(() => {
    vi.useFakeTimers();
    setSystemTime(new Date('2025-08-05T12:00:00Z'));

    mockToolRegistry = {
      getTool: vi.fn(),
    };

    mockConfig = {
      getWorkspaceContext: vi.fn().mockReturnValue({
        getDirectories: vi.fn().mockReturnValue(['/test/dir']),
      }),
      getFileService: vi.fn(),
      getEnvironmentMemory: vi.fn().mockReturnValue(''),
      getToolRegistry: vi.fn().mockReturnValue(mockToolRegistry),
    };

    (getFolderStructure as Mock<typeof getFolderStructure>).mockResolvedValue(
      'Mock<(...args: never[]) => unknown> Folder Structure',
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('should return basic environment context for a single directory', async () => {
    const parts = await getEnvironmentContext(mockConfig as Config);

    expect(parts.length).toBe(1);
    const context = parts[0].text;

    expect(context).toContain("Today's date is");
    expect(context).toContain("(formatted according to the user's locale)");
    expect(context).toContain(`My operating system is: ${process.platform}`);
    expect(context).toContain(
      "I'm currently working in the directory: /test/dir",
    );
    expect(context).toContain(
      'Here is the folder structure of the current working directories:\n\nMock Folder Structure',
    );
    expect(getFolderStructure).toHaveBeenCalledWith('/test/dir', {
      fileService: undefined,
    });
  });

  it('should return basic environment context for multiple directories', async () => {
    (
      (
        mockConfig.getWorkspaceContext! as Mock<
          typeof mockConfig.getWorkspaceContext
        >
      )().getDirectories as Mock<(...args: never[]) => unknown>
    ).mockReturnValue(['/test/dir1', '/test/dir2']);
    (getFolderStructure as Mock<typeof getFolderStructure>)
      .mockResolvedValueOnce('Structure 1')
      .mockResolvedValueOnce('Structure 2');

    const parts = await getEnvironmentContext(mockConfig as Config);

    expect(parts.length).toBe(1);
    const context = parts[0].text;

    expect(context).toContain(
      "I'm currently working in the following directories:\n  - /test/dir1\n  - /test/dir2",
    );
    expect(context).toContain(
      'Here is the folder structure of the current working directories:\n\nStructure 1\nStructure 2',
    );
    expect(getFolderStructure).toHaveBeenCalledTimes(2);
  });

  it('should handle read_many_files returning no content', async () => {
    const mockReadManyFilesTool = {
      build: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue({ llmContent: '' }),
      }),
    };
    mockToolRegistry.getTool.mockReturnValue(mockReadManyFilesTool);

    const parts = await getEnvironmentContext(mockConfig as Config);

    expect(parts.length).toBe(1); // No extra part added
  });

  it('should handle read_many_files tool not being found', async () => {
    mockToolRegistry.getTool.mockReturnValue(null);

    const parts = await getEnvironmentContext(mockConfig as Config);

    expect(parts.length).toBe(1); // No extra part added
  });
});
