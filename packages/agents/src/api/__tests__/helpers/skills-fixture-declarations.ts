/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { ACTIVATE_SKILL_TOOL_NAME } from '@vybestack/llxprt-code-tools';
import { z } from 'zod';
import type { Agent } from '../../agent.js';
import { fixtureAgentResources } from './agent-resource-capture.js';

const declarationSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parametersJsonSchema: z.unknown().optional(),
});

const chatSchema = z.object({
  generationConfig: z.object({ tools: z.array(declarationSchema).optional() }),
});

const skillNameSchema = z.object({
  properties: z
    .object({
      name: z.object({ enum: z.array(z.string()).optional() }).optional(),
    })
    .optional(),
});

type ProviderToolDeclaration = z.infer<typeof declarationSchema>;

export function observedSkillClient(agent: Agent): AgentClientContract {
  return fixtureAgentResources(agent).publishedClient(agent);
}

function clientSkillDeclaration(
  client: AgentClientContract,
): ProviderToolDeclaration | undefined {
  return chatSchema
    .parse(client.getChat())
    .generationConfig.tools?.find(
      (declaration) => declaration.name === ACTIVATE_SKILL_TOOL_NAME,
    );
}

export function activateSkillDeclaration(
  agent: Agent,
): ProviderToolDeclaration | undefined {
  return clientSkillDeclaration(observedSkillClient(agent));
}

export function clientModelVisibleSkillNames(
  client: AgentClientContract,
): string[] {
  const declaration = clientSkillDeclaration(client);
  if (declaration === undefined) return [];
  return (
    skillNameSchema.parse(declaration.parametersJsonSchema).properties?.name
      ?.enum ?? []
  );
}

export function modelVisibleSkillNames(agent: Agent): string[] {
  return clientModelVisibleSkillNames(observedSkillClient(agent));
}
