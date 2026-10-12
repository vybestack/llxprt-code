/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { FunctionDeclaration } from '../types/wire-types.js';

export function applyTaskSchemaPolicy(
  declaration: FunctionDeclaration,
  policy: Readonly<{ hideTaskAsync: boolean }>,
): FunctionDeclaration {
  if (declaration.name !== 'task' || !policy.hideTaskAsync) return declaration;
  const parameters = declaration.parametersJsonSchema;
  if (
    typeof parameters !== 'object' ||
    parameters === null ||
    !('properties' in parameters)
  )
    return declaration;
  const properties = parameters.properties;
  if (typeof properties !== 'object' || properties === null) return declaration;
  return {
    ...declaration,
    parametersJsonSchema: {
      ...parameters,
      properties: Object.fromEntries(
        Object.entries(properties).filter(([name]) => name !== 'async'),
      ),
      ...('required' in parameters && Array.isArray(parameters.required)
        ? {
            required: parameters.required.filter(
              (name: unknown) => name !== 'async',
            ),
          }
        : {}),
    },
  };
}
