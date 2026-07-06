/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Neutral tool declaration types and legacy toolset conversion.
 *
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-003
 * @pseudocode lines 40-53
 */

import { isJsonSchema, type JsonSchema } from './jsonSchema.js';

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-003.1
 * @pseudocode line 40
 */
export interface ToolDeclaration {
  name: string;
  description?: string;
  parametersJsonSchema: JsonSchema;
}

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-003.3
 * @pseudocode line 41
 */
export interface ToolChoice {
  mode: 'auto' | 'required' | 'none';
  allowedToolNames?: string[];
}

/**
 * Structural shape matching legacy {@link ProviderToolset} and
 * {@link RuntimeProviderToolset} — accepts functionDeclarations with
 * optional parametersJsonSchema and legacy parameters fallback.
 *
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-003.2, REQ-003.4
 * @pseudocode lines 42-43
 */
export type LegacyToolsetLike = ReadonlyArray<{
  functionDeclarations: ReadonlyArray<{
    name: string;
    description?: string;
    parametersJsonSchema?: unknown;
    parameters?: unknown;
  }>;
}>;

/**
 * Convert legacy toolset shape to neutral {@link ToolDeclaration}[].
 *
 * Schema resolution order: parametersJsonSchema → parameters → {} (empty).
 * Non-schema values (string, null, number) are skipped to the next option.
 *
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-003.2
 * @pseudocode lines 44-53
 */
export function toolDeclarationsFromLegacyToolset(
  toolset: LegacyToolsetLike,
): ToolDeclaration[] {
  const result: ToolDeclaration[] = [];

  for (const group of toolset) {
    for (const decl of group.functionDeclarations) {
      const schema: JsonSchema = resolveSchema(
        decl.parametersJsonSchema,
        decl.parameters,
      );

      const entry: ToolDeclaration = {
        name: decl.name,
        parametersJsonSchema: schema,
      };
      if (decl.description != null) {
        entry.description = decl.description;
      }
      result.push(entry);
    }
  }

  return result;
}

function resolveSchema(primary: unknown, fallback: unknown): JsonSchema {
  if (isJsonSchema(primary)) {
    return primary;
  }
  if (isJsonSchema(fallback)) {
    return fallback;
  }
  return {};
}
