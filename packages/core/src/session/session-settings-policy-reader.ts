/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  resolveTokenUsageLogLevel,
  type SettingsService,
} from '@vybestack/llxprt-code-settings';
import {
  buildToolGovernance,
  type RegistryPolicy,
  type ToolExecutionPolicy,
  type ToolGovernance,
} from '@vybestack/llxprt-code-tools';
import { assembleTaskSchemaPolicy } from '../config/task-schema-policy-assembly.js';
import type { LoopDetectionPolicy } from '../services/loopDetectionService.js';
import type { ReadonlySettingsSnapshot } from '../runtime/AgentRuntimeContext.js';
import { z } from 'zod';

const runtimePolicySchema = z.object({
  compressionThreshold: z.number().finite().optional().catch(undefined),
  contextLimit: z.number().positive().optional(),
  preserveThreshold: z.number().finite().optional().catch(undefined),
  topPreserveThreshold: z.number().finite().optional().catch(undefined),
  toolFormatOverride: z.string().optional(),
  compressionStrategy: z.string().optional(),
  compressionProfile: z.string().optional(),
  compressionVerification: z.boolean().optional().catch(undefined),
  'media.semantic-purge': z.enum(['off', 'remove', 'summary']).optional(),
  'refusal.retries': z.number().optional().catch(undefined),
  'refusal.backoff-ms': z.number().optional().catch(undefined),
  'refusal.rewrite': z.boolean().optional().catch(undefined),
  'refusal.review-profile': z.string().optional().catch(undefined),
  'refusal.max-rewrites': z.number().optional().catch(undefined),
  'compression.density.readWritePruning': z.boolean().optional(),
  'compression.density.fileDedupe': z.boolean().optional(),
  'compression.density.recencyPruning': z.boolean().optional(),
  'compression.density.recencyRetention': z.number().optional(),
  'compression.density.compressHeadroom': z.number().optional(),
  'compression.density.optimizeThreshold': z.number().optional(),
  'reasoning.enabled': z.boolean().optional(),
  'reasoning.includeInContext': z.boolean().optional(),
  'reasoning.includeInResponse': z.boolean().optional(),
  'reasoning.format': z.enum(['native', 'field']).optional(),
  'reasoning.stripFromContext': z
    .enum(['all', 'allButLast', 'none'])
    .optional(),
  'reasoning.fieldName': z.string().optional(),
  'reasoning.effort': z
    .enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    .optional(),
  'reasoning.maxTokens': z.number().optional(),
  'reasoning.adaptiveThinking': z.boolean().optional(),
});

export function readRuntimePolicy(
  settings: SettingsService,
  readNamedParameter: (key: string) => unknown,
  readToolExecutionPolicy: () => ToolExecutionPolicy,
  readLoopDetectionPolicy: () => LoopDetectionPolicy,
): ReadonlySettingsSnapshot {
  const values = Object.fromEntries(
    Object.keys(runtimePolicySchema.shape).map((key) => [
      key,
      settings.get(key),
    ]),
  );
  const semanticPurge = readNamedParameter('media.semantic-purge');
  if (
    semanticPurge !== undefined &&
    semanticPurge !== 'off' &&
    semanticPurge !== 'remove' &&
    semanticPurge !== 'summary'
  )
    throw new Error(
      "Invalid media.semantic-purge setting: expected 'off', 'remove', or 'summary'",
    );
  return Object.freeze({
    tools: readClientToolPolicy(settings),
    ...runtimePolicySchema.parse({
      ...values,
      compressionThreshold: readNamedParameter('compression-threshold'),
      contextLimit: readNamedParameter('context-limit'),
      preserveThreshold: readNamedParameter('compression-preserve-threshold'),
      topPreserveThreshold: readNamedParameter(
        'compression-top-preserve-threshold',
      ),
      toolFormatOverride: readNamedParameter('toolFormat'),
      compressionStrategy: readNamedParameter('compression.strategy'),
      compressionProfile: readNamedParameter('compression.profile'),
    }),
    toolExecutionPolicy: readToolExecutionPolicy(),
    maxOutputTokens: settings.get('maxOutputTokens'),
    promptCaching: settings.get('prompt-caching'),
    streamTimeoutPolicy: Object.freeze({
      'stream-idle-timeout-ms': settings.get('stream-idle-timeout-ms'),
      'stream-first-response-timeout-ms': settings.get(
        'stream-first-response-timeout-ms',
      ),
      'stream-timeout-retries': settings.get('stream-timeout-retries'),
      'refusal.backoff-ms': settings.get('refusal.backoff-ms'),
    }),
    showCitations: settings.get('ui.showCitations') === true,
    loopDetection: readLoopDetectionPolicy(),
    tokenUsageLogLevel: resolveTokenUsageLogLevel(
      settings.get('token-usage-log'),
    ),
    promptPolicy: Object.freeze({
      enableToolPrompts: settings.get('enable-tool-prompts') === true,
      allMemoriesAreCore: settings.get('model.allMemoriesAreCore') === true,
      asyncSubagentsEnabled: settings.get('subagents.asyncEnabled') !== false,
      profileAsyncEnabled: settings.get('subagents.async.enabled') !== false,
    }),
  });
}

export function readToolExecutionPolicy(
  settings: SettingsService,
): ToolExecutionPolicy {
  return Object.freeze({
    'shell-replacement': settings.get('shell-replacement'),
    'shell-output-retention-max-bytes': settings.get(
      'shell-output-retention-max-bytes',
    ),
    'shell-inactivity-timeout-seconds': settings.get(
      'shell-inactivity-timeout-seconds',
    ),
    emojifilter: settings.get('emojifilter'),
    'file-read-max-lines': settings.get('file-read-max-lines'),
    'tool-output-max-items': settings.get('tool-output-max-items'),
    'tool-output-max-tokens': settings.get('tool-output-max-tokens'),
    'tool-output-truncate-mode': settings.get('tool-output-truncate-mode'),
    'tool-output-item-size-limit': settings.get('tool-output-item-size-limit'),
    'max-image-dimension': settings.get('max-image-dimension'),
    'max-image-pixels': settings.get('max-image-pixels'),
    'image-resize.enabled': settings.get('image-resize.enabled'),
    'image-resize.maxLongEdge': settings.get('image-resize.maxLongEdge'),
    'image-resize.maxShortEdge': settings.get('image-resize.maxShortEdge'),
    'image-resize.maxPixels': settings.get('image-resize.maxPixels'),
    'shell-default-timeout-seconds': settings.get(
      'shell-default-timeout-seconds',
    ),
    'shell-max-timeout-seconds': settings.get('shell-max-timeout-seconds'),
    'model.canSaveCore': settings.get('model.canSaveCore'),
  });
}

export function readLoopDetectionPolicy(
  settings: SettingsService,
): LoopDetectionPolicy {
  const number = (key: string): number | undefined => {
    const value = settings.get(key);
    return typeof value === 'number' ? value : undefined;
  };
  const enabled = settings.get('loopDetectionEnabled');
  return Object.freeze({
    loopDetectionEnabled: typeof enabled === 'boolean' ? enabled : undefined,
    maxTurnsPerPrompt: number('maxTurnsPerPrompt'),
    toolCallLoopThreshold: number('toolCallLoopThreshold'),
    contentLoopThreshold: number('contentLoopThreshold'),
  });
}

export function readRegistryPolicy(
  settings: SettingsService,
  excluded: readonly string[],
): RegistryPolicy {
  return assembleTaskSchemaPolicy(settings, excluded)();
}

function readClientToolPolicy(
  settings: SettingsService,
): Readonly<{ allowed?: string[]; disabled?: string[] }> {
  const list = (value: unknown): string[] | undefined =>
    Array.isArray(value)
      ? value
          .filter(
            (entry): entry is string =>
              typeof entry === 'string' && entry.trim().length > 0,
          )
          .map((entry) => entry.trim())
      : undefined;
  return Object.freeze({
    allowed: list(settings.get('tools.allowed')),
    disabled: list(settings.get('tools.disabled')),
  });
}

export function readToolGovernance(
  settings: SettingsService,
  excluded: readonly string[],
): ToolGovernance {
  return buildToolGovernance({
    getEphemeralSettings: () => ({
      'tools.allowed': settings.get('tools.allowed'),
      'tools.disabled': settings.get('tools.disabled'),
    }),
    getExcludeTools: () => [...excluded],
  });
}
