/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Narrow capability contract for reading a tool's JSON-schema description.
 * Some tool objects expose a `schema` descriptor at runtime; this interface
 * captures only the fields core consumes without coupling to the full tool type.
 */
export interface ToolSchemaDescriptor {
  readonly description?: string;
  readonly parametersJsonSchema?: Record<string, unknown>;
}

/**
 * Capability interface for tools that expose a schema descriptor.
 */
export interface ToolSchemaHolder {
  readonly schema?: ToolSchemaDescriptor;
}

/**
 * Type guard: does the given tool object expose a schema descriptor?
 *
 * Validates that `schema` is either absent or a non-null object, so callers
 * can safely treat it as a `ToolSchemaDescriptor` after the guard passes.
 */
export function hasToolSchema(tool: object): tool is ToolSchemaHolder {
  if (!('schema' in tool)) {
    return false;
  }
  const schema = (tool as { schema?: unknown }).schema;
  return (
    schema === undefined || (typeof schema === 'object' && schema !== null)
  );
}

/**
 * Resolves the most specific description available for a tool, preferring
 * the schema descriptor's description and falling back to the tool's own
 * description, then an empty string.
 */
export function resolveToolDescription(
  schema: ToolSchemaDescriptor | undefined,
  fallbackDescription: unknown,
): string {
  if (typeof schema?.description === 'string') {
    return schema.description;
  }
  if (typeof fallbackDescription === 'string') {
    return fallbackDescription;
  }
  return '';
}
