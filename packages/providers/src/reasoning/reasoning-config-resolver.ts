/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ReasoningEffort,
  ReasoningEffortMap,
  ReasoningEffortWireFormat,
  ReasoningEnabledMap,
  ReasoningEnabledWireFormat,
} from '@vybestack/llxprt-code-settings';

export type NativeReasoningAdapter =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic'
  | 'gemini';

export type ResolvedReasoningEffortWireFormat = Exclude<
  ReasoningEffortWireFormat,
  'auto'
>;

export type ResolvedReasoningEnabledWireFormat = Exclude<
  ReasoningEnabledWireFormat,
  'auto'
>;

export interface GenericReasoningSettings {
  readonly enabled?: boolean;
  readonly effort?: ReasoningEffort;
  readonly budgetTokens?: number;
}

export interface ReasoningResolverInput {
  readonly nativeAdapter: NativeReasoningAdapter;
  readonly chatBaseUrl?: string;
  readonly reasoning: GenericReasoningSettings;
  readonly effortWireFormat: ReasoningEffortWireFormat;
  readonly enabledWireFormat: ReasoningEnabledWireFormat;
  readonly effortMap?: ReasoningEffortMap;
  readonly enabledMap?: ReasoningEnabledMap;
}

export type ReasoningResolution<T extends string | number | boolean> =
  | { readonly state: 'emitted'; readonly value: T }
  | { readonly state: 'represented'; readonly reason: 'effort-emitted' }
  | { readonly state: 'absent' }
  | {
      readonly state: 'suppressed';
      readonly reason:
        | 'reasoning-disabled'
        | 'effort-map-null'
        | 'enabled-map-null'
        | 'effort-format-none'
        | 'enabled-format-none';
    }
  | {
      readonly state: 'unrepresentable';
      readonly reason:
        | 'effort-format-undetected'
        | 'enabled-format-undetected'
        | 'numeric-effort-map-required'
        | 'enabled-map-required';
    };

export interface ResolvedReasoningConfiguration {
  readonly effortFormat: ResolvedReasoningEffortWireFormat;
  readonly enabledFormat: ResolvedReasoningEnabledWireFormat;
  readonly effort: ReasoningResolution<string | number>;
  readonly enabled: ReasoningResolution<string | boolean>;
}

const EFFORT_KEYS: readonly ReasoningEffort[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

const STRING_EFFORT_FORMATS: ReadonlySet<ResolvedReasoningEffortWireFormat> =
  new Set([
    'openai',
    'openai-responses',
    'anthropic',
    'openrouter',
    'gemini',
    'template-kwargs',
  ]);

const EFFORT_FORMATS_BY_ADAPTER: ReadonlyMap<
  NativeReasoningAdapter,
  ReadonlySet<ReasoningEffortWireFormat>
> = new Map<NativeReasoningAdapter, ReadonlySet<ReasoningEffortWireFormat>>([
  [
    'openai-chat',
    new Set([
      'auto',
      'openai',
      'openrouter',
      'anthropic-budget',
      'template-kwargs',
      'none',
    ]),
  ],
  ['openai-responses', new Set(['auto', 'openai-responses', 'none'])],
  ['anthropic', new Set(['auto', 'anthropic', 'anthropic-budget', 'none'])],
  ['gemini', new Set(['auto', 'gemini', 'none'])],
]);

const ENABLED_FORMATS_BY_ADAPTER: ReadonlyMap<
  NativeReasoningAdapter,
  ReadonlySet<ReasoningEnabledWireFormat>
> = new Map<NativeReasoningAdapter, ReadonlySet<ReasoningEnabledWireFormat>>([
  [
    'openai-chat',
    new Set([
      'auto',
      'openai',
      'openrouter',
      'thinking',
      'template-kwargs',
      'none',
    ]),
  ],
  ['openai-responses', new Set(['auto', 'openai-responses', 'none'])],
  ['anthropic', new Set(['auto', 'thinking', 'none'])],
  ['gemini', new Set(['auto', 'gemini', 'none'])],
]);

export function resolveReasoningConfiguration(
  input: ReasoningResolverInput,
): ResolvedReasoningConfiguration {
  validateSelectorCompatibility(input);

  const effortFormat = resolveEffortFormat(input);
  const enabledFormat = resolveEnabledFormat(input);

  validateEffortMap(effortFormat, input.effortMap);
  validateEnabledMap(enabledFormat, input.enabledMap);

  const effort = resolveEffort(input, effortFormat);
  const enabled = resolveEnabled(input, enabledFormat, effort);
  validateEmittedChatFormatPair(
    input,
    effortFormat,
    enabledFormat,
    effort,
    enabled,
  );
  return { effortFormat, enabledFormat, effort, enabled };
}

/**
 * Format pairs whose simultaneous emission is a coordinated wire form: one
 * control per request body, with both dimensions landing in it together
 * (Z.AI/DeepSeek effort + thinking type, vLLM template kwargs, OpenRouter
 * siblings). Any other pair that emits both dimensions would fan out into
 * two unrelated reasoning controls and is rejected before request
 * construction (issue #3255).
 */
const COORDINATED_CHAT_FORMAT_PAIRS: ReadonlySet<string> = new Set([
  'openai|openai',
  'openai|thinking',
  'anthropic-budget|thinking',
  'openrouter|openrouter',
  'template-kwargs|template-kwargs',
]);

function validateEmittedChatFormatPair(
  input: ReasoningResolverInput,
  effortFormat: ResolvedReasoningEffortWireFormat,
  enabledFormat: ResolvedReasoningEnabledWireFormat,
  effort: ReasoningResolution<string | number>,
  enabled: ReasoningResolution<string | boolean>,
): void {
  if (input.nativeAdapter !== 'openai-chat') {
    return;
  }
  if (effort.state !== 'emitted' || enabled.state !== 'emitted') {
    return;
  }
  if (!COORDINATED_CHAT_FORMAT_PAIRS.has(`${effortFormat}|${enabledFormat}`)) {
    throw new Error(
      `effort format '${effortFormat}' and enabled format '${enabledFormat}' emit conflicting OpenAI Chat reasoning representations`,
    );
  }
}

function validateSelectorCompatibility(input: ReasoningResolverInput): void {
  if (
    !adapterFormats(EFFORT_FORMATS_BY_ADAPTER, input.nativeAdapter).has(
      input.effortWireFormat,
    )
  ) {
    throw new Error(
      `effort wire format '${input.effortWireFormat}' is incompatible with the ${input.nativeAdapter} adapter`,
    );
  }

  if (
    !adapterFormats(ENABLED_FORMATS_BY_ADAPTER, input.nativeAdapter).has(
      input.enabledWireFormat,
    )
  ) {
    throw new Error(
      `enabled wire format '${input.enabledWireFormat}' is incompatible with the ${input.nativeAdapter} adapter`,
    );
  }
}

function adapterFormats<T extends string>(
  formats: ReadonlyMap<NativeReasoningAdapter, ReadonlySet<T>>,
  adapter: NativeReasoningAdapter,
): ReadonlySet<T> {
  const formatsForAdapter = formats.get(adapter);
  if (formatsForAdapter === undefined) {
    throw new Error('Unsupported native reasoning adapter');
  }
  return formatsForAdapter;
}

function resolveEffortFormat(
  input: ReasoningResolverInput,
): ResolvedReasoningEffortWireFormat {
  if (input.effortWireFormat !== 'auto') {
    return input.effortWireFormat;
  }

  switch (input.nativeAdapter) {
    case 'openai-chat':
      return resolveChatAutoFormats(input.chatBaseUrl).effortFormat;
    case 'openai-responses':
      return 'openai-responses';
    case 'anthropic':
      return 'anthropic';
    case 'gemini':
      return 'gemini';
    default:
      throw new Error('Unsupported native reasoning adapter');
  }
}

function resolveEnabledFormat(
  input: ReasoningResolverInput,
): ResolvedReasoningEnabledWireFormat {
  if (input.enabledWireFormat !== 'auto') {
    return input.enabledWireFormat;
  }

  switch (input.nativeAdapter) {
    case 'openai-chat':
      return resolveChatAutoFormats(input.chatBaseUrl).enabledFormat;
    case 'openai-responses':
      return 'none';
    case 'anthropic':
      return 'thinking';
    case 'gemini':
      return 'gemini';
    default:
      throw new Error('Unsupported native reasoning adapter');
  }
}

function resolveChatAutoFormats(baseUrl: string | undefined): {
  readonly effortFormat: ResolvedReasoningEffortWireFormat;
  readonly enabledFormat: ResolvedReasoningEnabledWireFormat;
} {
  const hostname = parseHostname(baseUrl);
  if (hostname === undefined) {
    return { effortFormat: 'none', enabledFormat: 'none' };
  }

  if (matchesHostSuffix(hostname, 'openrouter.ai')) {
    return { effortFormat: 'openrouter', enabledFormat: 'openrouter' };
  }

  if (
    matchesHostSuffix(hostname, 'z.ai') ||
    matchesHostSuffix(hostname, 'bigmodel.cn')
  ) {
    return { effortFormat: 'openai', enabledFormat: 'thinking' };
  }

  if (matchesHostSuffix(hostname, 'api.openai.com')) {
    return { effortFormat: 'openai', enabledFormat: 'none' };
  }

  return { effortFormat: 'none', enabledFormat: 'none' };
}

function parseHostname(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined || baseUrl.trim() === '') {
    return undefined;
  }

  try {
    const hostname = new URL(baseUrl.trim()).hostname.toLowerCase();
    return hostname === '' ? undefined : hostname;
  } catch {
    return undefined;
  }
}

function matchesHostSuffix(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

function validateEffortMap(
  format: ResolvedReasoningEffortWireFormat,
  effortMap: ReasoningEffortMap | undefined,
): void {
  if (effortMap === undefined || format === 'none') {
    return;
  }

  for (const effort of EFFORT_KEYS) {
    const mappedValue = effortMap[effort];
    if (mappedValue === undefined || mappedValue === null) {
      continue;
    }

    if (format === 'anthropic-budget' && typeof mappedValue !== 'number') {
      throw new Error(
        `reasoning.effortMap.${effort} must be a number for anthropic-budget`,
      );
    }

    if (STRING_EFFORT_FORMATS.has(format) && typeof mappedValue !== 'string') {
      throw new Error(
        `reasoning.effortMap.${effort} must be a string for ${format}`,
      );
    }
  }
}

function validateEnabledMap(
  format: ResolvedReasoningEnabledWireFormat,
  enabledMap: ReasoningEnabledMap | undefined,
): void {
  if (enabledMap === undefined || format === 'none') {
    return;
  }

  validateEnabledMapEntry(format, 'true', enabledMap.true);
  validateEnabledMapEntry(format, 'false', enabledMap.false);
}

function validateEnabledMapEntry(
  format: ResolvedReasoningEnabledWireFormat,
  key: 'true' | 'false',
  mappedValue: string | boolean | null | undefined,
): void {
  if (mappedValue === undefined || mappedValue === null) {
    return;
  }

  if (!isCompatibleEnabledMapValue(format, mappedValue)) {
    throw new Error(
      `reasoning.enabledMap.${key} has an incompatible value for ${format}`,
    );
  }
}

function isCompatibleEnabledMapValue(
  format: ResolvedReasoningEnabledWireFormat,
  mappedValue: string | boolean,
): boolean {
  switch (format) {
    case 'openai':
    case 'openai-responses':
    case 'thinking':
      return typeof mappedValue === 'string';
    case 'gemini':
      return isLevelLiteralOrBoolean(mappedValue);
    default:
      return typeof mappedValue === 'boolean';
  }
}

function isLevelLiteralOrBoolean(value: string | boolean): boolean {
  if (typeof value === 'boolean') {
    return true;
  }
  return value === 'LOW' || value === 'MEDIUM' || value === 'HIGH';
}

function resolveEffort(
  input: ReasoningResolverInput,
  format: ResolvedReasoningEffortWireFormat,
): ReasoningResolution<string | number> {
  const { effort, budgetTokens, enabled } = input.reasoning;
  const hasDirectBudget =
    format === 'anthropic-budget' && budgetTokens !== undefined;

  // A direct budget wins over any effort-derived value, but disablement
  // still suppresses it.
  if (hasDirectBudget) {
    if (enabled === false) {
      return { state: 'suppressed', reason: 'reasoning-disabled' };
    }
    return { state: 'emitted', value: budgetTokens };
  }

  if (effort === undefined) {
    return { state: 'absent' };
  }

  if (enabled === false) {
    return { state: 'suppressed', reason: 'reasoning-disabled' };
  }

  if (format === 'none') {
    return input.effortWireFormat === 'none'
      ? { state: 'suppressed', reason: 'effort-format-none' }
      : { state: 'unrepresentable', reason: 'effort-format-undetected' };
  }

  const mappedValue = input.effortMap?.[effort];
  if (mappedValue === null) {
    return { state: 'suppressed', reason: 'effort-map-null' };
  }

  if (format === 'anthropic-budget') {
    return typeof mappedValue === 'number'
      ? { state: 'emitted', value: mappedValue }
      : { state: 'unrepresentable', reason: 'numeric-effort-map-required' };
  }

  return {
    state: 'emitted',
    value: typeof mappedValue === 'string' ? mappedValue : effort,
  };
}

function resolveEnabled(
  input: ReasoningResolverInput,
  format: ResolvedReasoningEnabledWireFormat,
  effort: ReasoningResolution<string | number>,
): ReasoningResolution<string | boolean> {
  const { enabled } = input.reasoning;
  if (enabled === undefined) {
    return { state: 'absent' };
  }

  if (format === 'none') {
    if (enabled && effort.state === 'emitted') {
      return { state: 'represented', reason: 'effort-emitted' };
    }
    return input.enabledWireFormat === 'none'
      ? { state: 'suppressed', reason: 'enabled-format-none' }
      : { state: 'unrepresentable', reason: 'enabled-format-undetected' };
  }

  const mappedValue = input.enabledMap?.[enabled ? 'true' : 'false'];
  if (mappedValue === null) {
    return { state: 'suppressed', reason: 'enabled-map-null' };
  }

  // Enabled=true is represented by an emitted effort into the same
  // effective control (reasoning_effort / Responses reasoning.effort) even
  // when an enabled map entry exists: the explicit effort wins rather than
  // being overwritten by the map value (issue #3255).
  if (
    enabled &&
    (format === 'openai' || format === 'openai-responses') &&
    effort.state === 'emitted'
  ) {
    return { state: 'represented', reason: 'effort-emitted' };
  }

  if (mappedValue !== undefined) {
    return { state: 'emitted', value: mappedValue };
  }

  switch (format) {
    case 'openrouter':
      return enabled && effort.state === 'emitted'
        ? { state: 'represented', reason: 'effort-emitted' }
        : { state: 'emitted', value: enabled };
    case 'gemini':
    case 'template-kwargs':
      return { state: 'emitted', value: enabled };
    case 'thinking':
      return { state: 'emitted', value: enabled ? 'enabled' : 'disabled' };
    case 'openai':
    case 'openai-responses':
      return enabled && effort.state === 'emitted'
        ? { state: 'represented', reason: 'effort-emitted' }
        : { state: 'unrepresentable', reason: 'enabled-map-required' };
    default:
      throw new Error('Unsupported enabled reasoning format');
  }
}
