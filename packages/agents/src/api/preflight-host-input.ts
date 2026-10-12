/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { ProviderActivationIntentSchema } from './config-schema.js';

export type AgentPreflightData =
  | string
  | number
  | boolean
  | null
  | readonly AgentPreflightData[]
  | { readonly [key: string]: AgentPreflightData };

const dataSchema: z.ZodType<AgentPreflightData, z.ZodTypeDef, unknown> = z.lazy(
  () =>
    z.union([
      z.string(),
      z.number().finite(),
      z.boolean(),
      z.null(),
      z.array(dataSchema).readonly(),
      dataRecordSchema,
    ]),
);

const dataRecordSchema = z
  .unknown()
  .refine((value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  })
  .pipe(z.record(dataSchema).readonly());

const hostInputSchema = z
  .object({
    runtimeId: z.string().refine((value) => value.trim().length > 0),
    initialSettings: dataRecordSchema.optional(),
    metadata: dataRecordSchema.optional(),
    activation: ProviderActivationIntentSchema.extend({
      modelParams: dataRecordSchema.optional(),
    })
      .readonly()
      .optional(),
  })
  .strict()
  .readonly();

export type AgentPreflightHostInput = z.infer<typeof hostInputSchema>;

export function captureAgentPreflightHostInput(
  input: unknown,
): AgentPreflightHostInput {
  return hostInputSchema.parse(input);
}

export interface AgentPreflightOAuthRequest {
  readonly provider: string;
  readonly url: string;
  readonly message?: string;
}

export interface AgentPreflightOAuthHost {
  request(
    prompt: AgentPreflightOAuthRequest,
    signal: AbortSignal,
  ): Promise<boolean>;
}

export interface AgentPreflightBrowserHost {
  open(url: string, signal: AbortSignal): Promise<void>;
}

export async function requestAgentPreflightOAuth(
  host: AgentPreflightOAuthHost | undefined,
  prompt: AgentPreflightOAuthRequest,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  if (host === undefined)
    throw new Error('Preflight requires an OAuth request capability');
  const response = await host.request(Object.freeze({ ...prompt }), signal);
  signal.throwIfAborted();
  return response;
}

export async function openAgentPreflightBrowser(
  host: AgentPreflightBrowserHost | undefined,
  url: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (host === undefined)
    throw new Error('Preflight requires a browser request capability');
  await host.open(url, signal);
  signal.throwIfAborted();
}
