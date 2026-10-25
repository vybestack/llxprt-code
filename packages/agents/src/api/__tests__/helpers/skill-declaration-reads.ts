/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { ACTIVATE_SKILL_TOOL_NAME } from '@vybestack/llxprt-code-tools';
import { z } from 'zod';
import type { Agent } from '../../agent.js';
import type { RecordingProvider } from './recording-provider.js';

const declarationSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parametersJsonSchema: z.unknown().optional(),
});

const declarationsSchema = z.array(declarationSchema).optional();

const chatSchema = z.object({
  generationConfig: z.object({ tools: declarationsSchema }),
});

const skillNameSchema = z.object({
  properties: z
    .object({
      name: z.object({ enum: z.array(z.string()).optional() }).optional(),
    })
    .optional(),
});

type ProviderToolDeclaration = z.infer<typeof declarationSchema>;

function skillDeclaration(
  declarations: ProviderToolDeclaration[] | undefined,
): ProviderToolDeclaration | undefined {
  return declarations?.find(
    (declaration) => declaration.name === ACTIVATE_SKILL_TOOL_NAME,
  );
}

function skillNames(
  declaration: ProviderToolDeclaration | undefined,
): string[] {
  if (declaration === undefined) return [];
  return (
    skillNameSchema.parse(declaration.parametersJsonSchema).properties?.name
      ?.enum ?? []
  );
}

/**
 * Drives one turn so the chat session exists with its tool list and the
 * recording provider receives the declarations the model sees on that request.
 */
export async function settleTurn(agent: Agent): Promise<void> {
  for await (const _event of agent.stream('hello')) {
    // Drain the turn.
  }
}

function lastRequestDeclarations(
  recording: RecordingProvider,
): ProviderToolDeclaration[] | undefined {
  if (recording.requests.length === 0)
    throw new Error('The recording provider received no request');
  const request = recording.requests[recording.requests.length - 1];
  return declarationsSchema.parse(request.tools);
}

/** The `activate_skill` declaration on the recording provider's latest request. */
export function recordedSkillDeclaration(
  recording: RecordingProvider,
): ProviderToolDeclaration | undefined {
  return skillDeclaration(lastRequestDeclarations(recording));
}

/** The skill names the model may pass to `activate_skill` on the latest request. */
export function recordedSkillNames(recording: RecordingProvider): string[] {
  return skillNames(recordedSkillDeclaration(recording));
}

/**
 * The skill names declared on a session client's live chat (domain-level
 * reads of a client the test's own `SessionClientOwner` built).
 */
export function clientSkillNames(client: AgentClientContract): string[] {
  const declarations = chatSchema.parse(client.getChat()).generationConfig
    .tools;
  return skillNames(skillDeclaration(declarations));
}
