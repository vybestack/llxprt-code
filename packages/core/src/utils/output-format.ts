/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Output format for CLI responses
 */
export enum OutputFormat {
  TEXT = 'text',
  JSON = 'json',
}

/**
 * Formats errors as JSON for programmatic consumption
 */
export class JsonFormatter {
  /**
   * Formats an error object as JSON
   * @param error - The error to format
   * @param code - Optional error code
   * @returns JSON string representation of the error
   */
  formatError(error: Error, code?: string | number): string {
    return JSON.stringify(
      {
        error: {
          type: error.constructor.name,
          message: error.message,
          ...(code !== undefined && { code }),
        },
      },
      null,
      2,
    );
  }
}
