/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import type {
  jsonSchemaValidator,
  JsonSchemaType,
  JsonSchemaValidator,
} from '@modelcontextprotocol/sdk/validation/types.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

/**
 * A tolerant JSON Schema validator for MCP tool output schemas.
 *
 * Some MCP servers (e.g. third-party extensions) return complex schemas that
 * include `$defs` / `$ref` chains which can occasionally trip AJV's resolver,
 * causing discovery to fail. This wrapper keeps the default AJV validator for
 * normal operation but falls back to a no-op validator any time schema
 * compilation throws, so we can still list and use the tool while emitting a
 * debug log.
 */
export class LenientJsonSchemaValidator implements jsonSchemaValidator {
  private readonly ajvValidator = new AjvJsonSchemaValidator();
  private readonly debugLogger = new DebugLogger('llxprt:mcp:schema');

  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    try {
      return this.ajvValidator.getValidator<T>(schema);
    } catch (error) {
      this.debugLogger.warn(
        `Failed to compile MCP tool output schema (${
          (schema as Record<string, unknown>)['$id'] ?? '<no $id>'
        }): ${error instanceof Error ? error.message : String(error)}. ` +
          'Skipping output validation for this tool.',
      );
      return (input: unknown) => ({
        valid: true as const,
        data: input as T,
        errorMessage: undefined,
      });
    }
  }
}
