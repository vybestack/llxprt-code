/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ACTIVATE_SKILL_TOOL_NAME } from '@vybestack/llxprt-code-tools';
import { z } from 'zod';
import type { RecordedRequest } from './recording-provider.js';

const skillNameSchema = z.object({
  properties: z
    .object({
      name: z.object({ enum: z.array(z.string()).optional() }).optional(),
    })
    .optional(),
});

/**
 * The skill names the model may pass to `activate_skill`, read from the tool
 * declarations the recording provider received with its latest request. Throws
 * rather than returning empty when no request or no tool list was recorded, so
 * a change to the request shape cannot turn a test green by accident.
 */
export function recordedModelVisibleSkillNames(
  requests: readonly RecordedRequest[],
): string[] {
  if (requests.length === 0) {
    throw new Error('The provider received no request');
  }
  const declarations = requests[requests.length - 1].tools;
  if (declarations === undefined || declarations.length === 0) {
    throw new Error(
      'The provider request carries no tool declarations; the request shape may have changed',
    );
  }
  const declaration = declarations.find(
    (candidate) => candidate.name === ACTIVATE_SKILL_TOOL_NAME,
  );
  if (declaration === undefined) {
    return [];
  }
  return (
    skillNameSchema.parse(declaration.parametersJsonSchema).properties?.name
      ?.enum ?? []
  );
}
