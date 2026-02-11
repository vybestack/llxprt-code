/**
 * @license
 * Copyright 2025 Vybestack LLC
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
  type MockInstance,
} from 'vitest';
import { handleList } from './list.js';
import type * as extensionModule from '../../config/extension.js';
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core';

const mockLoadUserExtensions: Mock<typeof extensionModule.loadUserExtensions> =
  vi.hoisted(() => vi.fn());
const mockToOutputString: Mock<typeof extensionModule.toOutputString> =
  vi.hoisted(() => vi.fn());

vi.mock('../../config/extension.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../config/extension.js')>();
  return {
    ...actual,
    loadUserExtensions: mockLoadUserExtensions,
    toOutputString: mockToOutputString,
  };
});

vi.mock('../../utils/errors.js', () => ({
  getErrorMessage: vi.fn((error: unknown) => {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return String(error);
  }),
}));

describe('handleList', () => {
  let consoleLogSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let processSpy: MockInstance;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    mockLoadUserExtensions.mockClear();
    mockToOutputString.mockClear();
    vi.clearAllMocks();
  });

  it('should display message when no extensions installed', async () => {
    mockLoadUserExtensions.mockReturnValue([]);

    await handleList();

    expect(mockLoadUserExtensions).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith('No extensions installed.');
    expect(mockToOutputString).not.toHaveBeenCalled();
    expect(processSpy).not.toHaveBeenCalled();
  });

  it('should list single extension', async () => {
    const extension = { name: 'test-extension' } as GeminiCLIExtension;
    mockLoadUserExtensions.mockReturnValue([extension]);
    mockToOutputString.mockReturnValue('test-extension output');

    await handleList();

    expect(mockLoadUserExtensions).toHaveBeenCalled();
    expect(mockToOutputString).toHaveBeenCalledWith(extension, process.cwd());
    expect(consoleLogSpy).toHaveBeenCalledWith('test-extension output');
    expect(processSpy).not.toHaveBeenCalled();
  });

  it('should list multiple extensions with double newline separator', async () => {
    const extensions = [
      { name: 'extension-1' } as GeminiCLIExtension,
      { name: 'extension-2' } as GeminiCLIExtension,
      { name: 'extension-3' } as GeminiCLIExtension,
    ];
    mockLoadUserExtensions.mockReturnValue(extensions);
    mockToOutputString
      .mockReturnValueOnce('extension-1 output')
      .mockReturnValueOnce('extension-2 output')
      .mockReturnValueOnce('extension-3 output');

    await handleList();

    expect(mockLoadUserExtensions).toHaveBeenCalled();
    expect(mockToOutputString).toHaveBeenCalledTimes(3);
    expect(mockToOutputString).toHaveBeenNthCalledWith(
      1,
      extensions[0],
      process.cwd(),
    );
    expect(mockToOutputString).toHaveBeenNthCalledWith(
      2,
      extensions[1],
      process.cwd(),
    );
    expect(mockToOutputString).toHaveBeenNthCalledWith(
      3,
      extensions[2],
      process.cwd(),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'extension-1 output\n\nextension-2 output\n\nextension-3 output',
    );
    expect(processSpy).not.toHaveBeenCalled();
  });

  it('should call toOutputString with process.cwd() for each extension', async () => {
    const extensions = [
      { name: 'ext-a' } as GeminiCLIExtension,
      { name: 'ext-b' } as GeminiCLIExtension,
    ];
    mockLoadUserExtensions.mockReturnValue(extensions);
    mockToOutputString.mockReturnValue('output');
    const cwd = process.cwd();

    await handleList();

    expect(mockToOutputString).toHaveBeenNthCalledWith(1, extensions[0], cwd);
    expect(mockToOutputString).toHaveBeenNthCalledWith(2, extensions[1], cwd);
  });

  it('should handle loadUserExtensions error', async () => {
    mockLoadUserExtensions.mockImplementation(() => {
      throw new Error('Failed to load extensions');
    });

    await handleList();

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to load extensions');
    expect(processSpy).toHaveBeenCalledWith(1);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('should handle toOutputString error', async () => {
    const extension = { name: 'test-extension' } as GeminiCLIExtension;
    mockLoadUserExtensions.mockReturnValue([extension]);
    mockToOutputString.mockImplementation(() => {
      throw new Error('Output generation failed');
    });

    await handleList();

    expect(consoleErrorSpy).toHaveBeenCalledWith('Output generation failed');
    expect(processSpy).toHaveBeenCalledWith(1);
  });

  it('should handle non-Error exceptions', async () => {
    mockLoadUserExtensions.mockImplementation(() => {
      // eslint-disable-next-line no-restricted-syntax
      throw 'String error';
    });

    await handleList();

    expect(consoleErrorSpy).toHaveBeenCalledWith('String error');
    expect(processSpy).toHaveBeenCalledWith(1);
  });
});
