/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { z } from 'zod';
import {
  CompressionStatus,
  ConfigSource,
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core';
import type { HistoryItemWithoutId } from '../../types.js';

const skill = z.object({
  name: z.string(),
  description: z.string(),
  location: z.string(),
  body: z.string(),
  disabled: z.boolean().optional(),
  source: z.enum(['builtin', 'extension', 'user', 'project']).optional(),
});
const extension = z.object({
  name: z.string(),
  version: z.string(),
  isActive: z.boolean(),
  path: z.string(),
  contextFiles: z.array(z.string()),
  resolvedSettings: z.array(z.record(z.unknown())).optional(),
});
const hook = z.object({
  config: z.object({
    type: z.literal(HookType.Command),
    command: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    timeout: z.number().optional(),
    source: z.nativeEnum(ConfigSource).optional(),
  }),
  source: z.nativeEnum(ConfigSource),
  eventName: z.nativeEnum(HookEventName),
  matcher: z.string().optional(),
  sequential: z.boolean().optional(),
  enabled: z.boolean(),
});

/** Only serializable presentation data belongs here; execution callbacks never do. */
const uiItem = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('info'),
    text: z.string(),
    icon: z.string().optional(),
    color: z.string().optional(),
  }),
  z.object({ type: z.literal('warning'), text: z.string() }),
  z.object({ type: z.literal('error'), text: z.string() }),
  z.object({ type: z.literal('user_shell'), text: z.string() }),
  z.object({ type: z.literal('oauth_url'), text: z.string(), url: z.string() }),
  z.object({ type: z.literal('profile_change'), profileName: z.string() }),
  z.object({ type: z.literal('help'), timestamp: z.coerce.date() }),
  z.object({
    type: z.literal('about'),
    cliVersion: z.string(),
    osVersion: z.string(),
    sandboxEnv: z.string(),
    modelVersion: z.string(),
    keyfile: z.string(),
    key: z.string(),
    ideClient: z.string(),
    provider: z.string(),
    baseURL: z.string(),
  }),
  z.object({
    type: z.literal('stats'),
    duration: z.string(),
    quotaLines: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('model_stats') }),
  z.object({ type: z.literal('tool_stats') }),
  z.object({ type: z.literal('cache_stats') }),
  z.object({ type: z.literal('lb_stats') }),
  z.object({
    type: z.literal('quit'),
    duration: z.string(),
    totalApiRequests: z.number().optional(),
    totalTokens: z.number().optional(),
    completeTokensPerMinute: z.number().optional(),
    totalToolCalls: z.number().optional(),
  }),
  z.object({
    type: z.literal('compression'),
    compression: z.object({
      isPending: z.boolean(),
      originalTokenCount: z.number().nullable(),
      newTokenCount: z.number().nullable(),
      compressionStatus: z.nativeEnum(CompressionStatus).nullable(),
    }),
  }),
  z.object({
    type: z.literal('extensions_list'),
    extensions: z.array(extension),
  }),
  z.object({ type: z.literal('hooks_list'), hooks: z.array(hook) }),
  z.object({
    type: z.literal('skills_list'),
    skills: z.array(skill),
    showDescriptions: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('chat_list'),
    chats: z.array(z.object({ name: z.string(), mtime: z.string() })),
  }),
  z.object({
    type: z.literal('tools_list'),
    tools: z.array(
      z.object({
        name: z.string(),
        displayName: z.string(),
        description: z.string().optional(),
      }),
    ),
    showDescriptions: z.boolean(),
  }),
  z.object({
    type: z.literal('mcp_status'),
    servers: z.array(
      z.object({
        name: z.string(),
        connected: z.boolean(),
        description: z.string().optional(),
        environment: z.record(z.string()).optional(),
        error: z.string().optional(),
        tools: z.array(z.string()),
        prompts: z.array(z.string()),
        resources: z.array(z.string()),
      }),
    ),
  }),
]);

export function encodeJournalUiItem(item: HistoryItemWithoutId): string {
  return JSON.stringify(uiItem.parse(item));
}

export function decodeJournalUiItem(text: string): HistoryItemWithoutId {
  return uiItem.parse(JSON.parse(text));
}
