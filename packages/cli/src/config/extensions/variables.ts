/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type VariableSchema, VARIABLE_SCHEMA } from './variableSchema.js';

export const EXTENSION_SETTINGS_FILENAME = '.env';

export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonArray;

export type VariableContext = {
  [key in keyof typeof VARIABLE_SCHEMA]?: string;
};

export function validateVariables(
  variables: VariableContext,
  schema: VariableSchema,
) {
  for (const key in schema) {
    const definition = schema[key];
    const value = variables[key as keyof VariableContext];
    if (definition.required === true && (value === undefined || value === '')) {
      throw new Error(`Missing required variable: ${key}`);
    }
  }
}

export function hydrateString(str: string, context: VariableContext): string {
  validateVariables(context, VARIABLE_SCHEMA);
  // Static regex for ${var} template syntax - no dynamic parts
  // eslint-disable-next-line sonarjs/regular-expr
  const regex = /\${(.*?)}/g;
  return str.replace(regex, (match, key) =>
    context[key as keyof VariableContext] == null
      ? match
      : (context[key as keyof VariableContext] as string),
  );
}

export function recursivelyHydrateStrings(
  obj: JsonValue,
  values: VariableContext,
): JsonValue {
  if (typeof obj === 'string') {
    return hydrateString(obj, values);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => recursivelyHydrateStrings(item, values));
  }
  if (typeof obj === 'object' && obj !== null) {
    const newObj: JsonObject = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        newObj[key] = recursivelyHydrateStrings(obj[key], values);
      }
    }
    return newObj;
  }
  return obj;
}
