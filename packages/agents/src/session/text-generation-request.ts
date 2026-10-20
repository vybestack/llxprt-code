/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import type { AgentClientGenerateConfig } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type {
  AdmittedModelParameters,
  AdmittedProviderRoute,
} from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import {
  ownModelParameters,
  applyAdmittedReasoning,
} from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import {
  createRuntimeInvocationContext,
  type RuntimeInvocationContext,
} from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';

const generationConfigSchema = z.object({
  temperature: z.number().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  topP: z.number().optional(),
  topK: z.number().int().optional(),
  thinkingConfig: z
    .object({
      thinkingBudget: z.number().int().nonnegative().optional(),
      includeThoughts: z.boolean().optional(),
    })
    .optional(),
  reasoning: z
    .object({
      budgetTokens: z.number().int().nonnegative().optional(),
      effort: z.enum(['low', 'medium', 'high']).optional(),
      includeInOutput: z.boolean().optional(),
    })
    .optional(),
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        parametersJsonSchema: z.union([z.boolean(), z.record(z.unknown())]),
      }),
    )
    .optional(),
  toolConfig: z.unknown().optional(),
  systemInstruction: z.unknown().optional(),
});

export function prepareTextGenerationRequest(
  provider: RuntimeProvider,
  model: string | undefined,
  captured: RuntimeInvocationContext,
  config: Readonly<Record<string, unknown>> | undefined,
  admitted: AdmittedModelParameters | undefined,
  selectedModel: string,
): {
  config: AgentClientGenerateConfig;
  modelParameters: AdmittedModelParameters & { route: AdmittedProviderRoute };
  invocation: RuntimeInvocationContext;
} {
  const supplied = generationConfigSchema.parse(config ?? {});
  const parameters = overrideGenerationParameters(
    admitted ?? {
      providerName: provider.name,
      modelParams: captured.modelParams,
    },
    supplied,
    model,
  );
  const ephemerals = applyAdmittedReasoning(
    captured.ephemerals,
    parameters.reasoning,
  );
  if (supplied.maxOutputTokens !== undefined)
    ephemerals.maxOutputTokens = supplied.maxOutputTokens;
  const modelParameters: AdmittedModelParameters & {
    route: AdmittedProviderRoute;
  } = {
    ...parameters,
    route: {
      ...(admitted?.route ?? {
        provider,
        profileName: null,
        hasInlineKey: typeof captured.ephemerals['auth-key'] === 'string',
      }),
      model: model ?? selectedModel,
      ...(typeof captured.ephemerals['base-url'] === 'string'
        ? { baseURL: captured.ephemerals['base-url'] }
        : {}),
    },
  };
  return {
    config: {
      ...supplied,
      ...(disablesGenerationTools(supplied) ? { tools: [] } : {}),
    },
    modelParameters,
    invocation: createRuntimeInvocationContext({
      providerName: provider.name,
      runtimeId: captured.runtimeId,
      sessionId: captured.sessionId,
      fetch: captured.fetch,
      runtimeMetadata: captured.metadata,
      providerDefaults: captured.providerDefaults,
      configuredHeaders: captured.customHeaders,
      modelParams: modelParameters.modelParams,
      modelParamsProviderName: provider.name,
      ephemeralsSnapshot: { ...ephemerals, model: model ?? selectedModel },
      telemetry: captured.telemetry,
      userMemory: captured.userMemory,
      redaction: captured.redaction,
    }),
  };
}

export function disablesGenerationTools(
  config: AgentClientGenerateConfig,
): boolean {
  return z
    .object({
      functionCallingConfig: z.object({ mode: z.literal('NONE') }),
    })
    .safeParse(config.toolConfig).success;
}

function overrideGenerationParameters(
  admitted: AdmittedModelParameters,
  supplied: z.infer<typeof generationConfigSchema>,
  model: string | undefined,
): AdmittedModelParameters {
  const parameters = { ...admitted.modelParams };
  if (supplied.temperature !== undefined)
    parameters.temperature = supplied.temperature;
  if (supplied.topP !== undefined) parameters.top_p = supplied.topP;
  if (supplied.topK !== undefined) parameters.top_k = supplied.topK;
  if (supplied.maxOutputTokens !== undefined) {
    delete parameters.max_tokens;
    delete parameters.max_completion_tokens;
    delete parameters.max_output_tokens;
  }
  return {
    ...admitted,
    ...(model === undefined ? {} : { modelOverride: model }),
    reasoning: {
      ...admitted.reasoning,
      ...supplied.reasoning,
      ...(supplied.thinkingConfig?.thinkingBudget === undefined
        ? {}
        : { budgetTokens: supplied.thinkingConfig.thinkingBudget }),
      ...(supplied.thinkingConfig?.includeThoughts === undefined
        ? {}
        : { includeInOutput: supplied.thinkingConfig.includeThoughts }),
    },
    modelParams: ownModelParameters(parameters),
    genericMaxOutputTokens:
      supplied.maxOutputTokens ?? admitted.genericMaxOutputTokens,
    ...(admitted.loadBalancer === undefined
      ? {}
      : {
          loadBalancer: {
            ...admitted.loadBalancer,
            members: admitted.loadBalancer.members.map((member) => ({
              ...member,
              parameters: overrideGenerationParameters(
                member.parameters,
                supplied,
                model,
              ),
            })),
          },
        }),
  };
}
