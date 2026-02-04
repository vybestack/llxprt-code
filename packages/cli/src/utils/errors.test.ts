/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, type MockInstance } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core';
import { FatalInputError } from '@vybestack/llxprt-code-core';
import {
  getErrorMessage,
  handleError,
  handleToolError,
  handleCancellationError,
  handleMaxTurnsExceededError,
} from './errors.js';

// Mock the core modules
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();

  return {
    ...original,
    parseAndFormatApiError: vi.fn((error: unknown) => {
      if (error instanceof Error) {
        return `API Error: ${error.message}`;
      }
      return `API Error: ${String(error)}`;
    }),
    FatalToolExecutionError: class extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'FatalToolExecutionError';
        this.exitCode = 54;
      }
      exitCode: number;
    },
    FatalCancellationError: class extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'FatalCancellationError';
        this.exitCode = 130;
      }
      exitCode: number;
    },
  };
});

describe('errors', () => {
  let mockConfig: Config;
  let processExitSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Mock console.error
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock process.exit to throw instead of actually exiting
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit called with code: ${code}`);
    });

    // Create mock config
    mockConfig = {
      getGeminiClient: vi.fn(() => ({
        getContentGenerator: vi.fn(() => ({})),
      })),
    } as unknown as Config;
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('getErrorMessage', () => {
    it('should return error message for Error instances', () => {
      const error = new Error('Test error message');
      expect(getErrorMessage(error)).toBe('Test error message');
    });

    it('should convert non-Error values to strings', () => {
      expect(getErrorMessage('string error')).toBe('string error');
      expect(getErrorMessage(123)).toBe('123');
      expect(getErrorMessage(null)).toBe('null');
      expect(getErrorMessage(undefined)).toBe('undefined');
    });

    it('should handle objects', () => {
      const obj = { message: 'test' };
      expect(getErrorMessage(obj)).toBe('[object Object]');
    });
  });

  describe('handleError', () => {
    it('should log error message and exit with default code 1', () => {
      const testError = new Error('Test error');

      expect(() => {
        handleError(testError, mockConfig);
      }).toThrow('process.exit called with code: 1');

      expect(consoleErrorSpy).toHaveBeenCalledWith('API Error: Test error');
    });

    it('should handle non-Error objects and exit with default code 1', () => {
      const testError = 'String error';

      expect(() => {
        handleError(testError, mockConfig);
      }).toThrow('process.exit called with code: 1');

      expect(consoleErrorSpy).toHaveBeenCalledWith('API Error: String error');
    });

    it('should use custom error code when provided', () => {
      const testError = new Error('Test error');

      expect(() => {
        handleError(testError, mockConfig, 42);
      }).toThrow('process.exit called with code: 42');

      expect(consoleErrorSpy).toHaveBeenCalledWith('API Error: Test error');
    });

    it('should extract exitCode from FatalError instances', () => {
      const fatalError = new FatalInputError('Fatal error');

      expect(() => {
        handleError(fatalError, mockConfig);
      }).toThrow('process.exit called with code: 42');

      expect(consoleErrorSpy).toHaveBeenCalledWith('API Error: Fatal error');
    });

    it('should handle error with code property', () => {
      const errorWithCode = new Error('Error with code') as Error & {
        code: number;
      };
      errorWithCode.code = 404;

      expect(() => {
        handleError(errorWithCode, mockConfig);
      }).toThrow('process.exit called with code: 404');
    });
  });

  describe('handleToolError', () => {
    const toolName = 'test-tool';
    const toolError = new Error('Tool failed');

    it('should log error message to stderr', () => {
      handleToolError(toolName, toolError, mockConfig);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error executing tool test-tool: Tool failed',
      );
    });

    it('should use resultDisplay when provided', () => {
      handleToolError(
        toolName,
        toolError,
        mockConfig,
        'CUSTOM_ERROR',
        'Custom display message',
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error executing tool test-tool: Custom display message',
      );
    });

    describe('non-fatal errors', () => {
      it('should log error message to stderr without exiting for recoverable errors', () => {
        handleToolError(toolName, toolError, mockConfig, 'invalid_tool_params');

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error executing tool test-tool: Tool failed',
        );
        // Should not exit for non-fatal errors
        expect(processExitSpy).not.toHaveBeenCalled();
      });

      it('should not exit for file not found errors', () => {
        handleToolError(toolName, toolError, mockConfig, 'file_not_found');

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error executing tool test-tool: Tool failed',
        );
        expect(processExitSpy).not.toHaveBeenCalled();
      });

      it('should not exit for permission denied errors', () => {
        handleToolError(toolName, toolError, mockConfig, 'permission_denied');

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error executing tool test-tool: Tool failed',
        );
        expect(processExitSpy).not.toHaveBeenCalled();
      });

      it('should not exit for path not in workspace errors', () => {
        handleToolError(
          toolName,
          toolError,
          mockConfig,
          'path_not_in_workspace',
        );

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error executing tool test-tool: Tool failed',
        );
        expect(processExitSpy).not.toHaveBeenCalled();
      });

      it('should prefer resultDisplay over error message', () => {
        handleToolError(
          toolName,
          toolError,
          mockConfig,
          'invalid_tool_params',
          'Display message',
        );

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error executing tool test-tool: Display message',
        );
        expect(processExitSpy).not.toHaveBeenCalled();
      });
    });

    describe('fatal errors', () => {
      it('should exit immediately for NO_SPACE_LEFT errors', () => {
        expect(() => {
          handleToolError(toolName, toolError, mockConfig, 'no_space_left');
        }).toThrow('process.exit called with code: 54');

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error executing tool test-tool: Tool failed',
        );
      });
    });
  });

  describe('handleCancellationError', () => {
    it('should log cancellation message and exit with 130', () => {
      expect(() => {
        handleCancellationError(mockConfig);
      }).toThrow('process.exit called with code: 130');

      expect(consoleErrorSpy).toHaveBeenCalledWith('Operation cancelled.');
    });
  });

  describe('handleMaxTurnsExceededError', () => {
    it('should log max turns message and exit with 53', () => {
      expect(() => {
        handleMaxTurnsExceededError(mockConfig);
      }).toThrow('process.exit called with code: 53');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
      );
    });
  });
});
