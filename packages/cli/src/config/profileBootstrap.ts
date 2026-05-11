/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SettingsService,
  MessageBus,
  type ProviderRuntimeContext,
  type ProviderManager,
} from '@vybestack/llxprt-code-core';
import { createProviderManager } from '../providers/providerManagerInstance.js';
import { registerCliProviderInfrastructure } from '../runtime/runtimeLifecycle.js';
import type { OAuthManager } from '../auth/oauth-manager.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';

const DEFAULT_RUNTIME_ID = 'cli.runtime.bootstrap';

export interface BootstrapProfileArgs {
  profileName: string | null;
  profileJson: string | null; // @plan:PLAN-20251118-ISSUE533.P03 @requirement:REQ-PROF-001.1
  providerOverride: string | null;
  modelOverride: string | null;
  keyOverride: string | null;
  keyfileOverride: string | null;
  /**
   * @plan PLAN-20260211-SECURESTORE.P16
   * @requirement R22.2
   */
  keyNameOverride: string | null;
  baseurlOverride: string | null;
  setOverrides: string[] | null;
}

export interface RuntimeBootstrapMetadata {
  settingsService?: SettingsService;
  config?: ProviderRuntimeContext['config'];
  oauthManager?: OAuthManager;
  runtimeId?: string;
  messageBus?: MessageBus;
  metadata?: Record<string, unknown>;
}

export interface ParsedBootstrapArgs {
  bootstrapArgs: BootstrapProfileArgs;
  runtimeMetadata: RuntimeBootstrapMetadata;
}

export interface BootstrapRuntimeState {
  runtime: ProviderRuntimeContext;
  runtimeMessageBus: MessageBus;
  providerManager: ProviderManager;
  oauthManager?: OAuthManager;
}

export interface ProfileApplicationResult {
  providerName: string;
  modelName: string;
  baseUrl?: string;
  warnings: string[];
  error?: string;
}

export interface BootstrapResult {
  runtime: ProviderRuntimeContext;
  providerManager: ProviderManager;
  oauthManager?: OAuthManager;
  bootstrapArgs: BootstrapProfileArgs;
  profile: ProfileApplicationResult;
}

function normaliseArgValue(value: string | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  // For --profile, we need to distinguish between:
  // - no value provided (undefined/null -> return null)
  // - empty string provided ("" -> return "")
  // - whitespace-only string (" " -> return "")
  return value.trim();
}

interface BootstrapParseState {
  bootstrapArgs: BootstrapProfileArgs;
  profileLoadUsed: boolean;
  profileUsed: boolean;
}

interface ConsumedArgValue {
  value: string | null;
  nextIndex: number;
}

interface ParsedFlagToken {
  flag: string;
  inline: string | undefined;
}

function createEmptyBootstrapArgs(): BootstrapProfileArgs {
  return {
    profileName: null,
    profileJson: null,
    providerOverride: null,
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    keyNameOverride: null,
    baseurlOverride: null,
    setOverrides: null,
  };
}

function createRuntimeMetadata(argv: string[]): RuntimeBootstrapMetadata {
  return {
    runtimeId: process.env.LLXPRT_RUNTIME_ID ?? DEFAULT_RUNTIME_ID,
    metadata: {
      source: 'cli.bootstrap',
      argv: argv.slice(),
      timestamp: Date.now(),
    },
  };
}

function consumeBootstrapValue(
  tokens: string[],
  currentIndex: number,
  inlineValue: string | undefined,
): ConsumedArgValue {
  if (inlineValue !== undefined) {
    return { value: normaliseArgValue(inlineValue), nextIndex: currentIndex };
  }
  const nextIndex = currentIndex + 1;
  if (nextIndex < tokens.length) {
    const nextToken = tokens[nextIndex];
    if (!nextToken.startsWith('-')) {
      return { value: normaliseArgValue(nextToken), nextIndex };
    }
  }
  return { value: null, nextIndex: currentIndex };
}

function parseFlagToken(token: string): ParsedFlagToken {
  const equalsIndex = token.indexOf('=');
  if (equalsIndex === -1) {
    return { flag: token, inline: undefined };
  }
  return {
    flag: token.slice(0, equalsIndex),
    inline: token.slice(equalsIndex + 1),
  };
}

function applySimpleBootstrapFlag(
  flag: string,
  consumed: ConsumedArgValue,
  state: BootstrapParseState,
): boolean {
  switch (flag) {
    case '--profile-load':
      state.bootstrapArgs.profileName = consumed.value;
      state.profileLoadUsed = true;
      return true;
    case '--provider':
      state.bootstrapArgs.providerOverride = consumed.value;
      return true;
    case '--model':
    case '-m':
      state.bootstrapArgs.modelOverride = consumed.value;
      return true;
    case '--key':
      state.bootstrapArgs.keyOverride = consumed.value;
      return true;
    case '--keyfile':
      state.bootstrapArgs.keyfileOverride = consumed.value;
      return true;
    case '--baseurl':
      state.bootstrapArgs.baseurlOverride = consumed.value;
      return true;
    default:
      return false;
  }
}

function applyProfileJsonFlag(
  consumed: ConsumedArgValue,
  state: BootstrapParseState,
): void {
  if (consumed.value === null) {
    throw new Error('--profile requires a value');
  }
  state.bootstrapArgs.profileJson = consumed.value;
  state.profileUsed = true;
}

function applyKeyNameFlag(
  consumed: ConsumedArgValue,
  state: BootstrapParseState,
): void {
  if (consumed.value === null) {
    throw new Error('--key-name requires a value');
  }
  state.bootstrapArgs.keyNameOverride = consumed.value;
}

function collectSetOverrideValues(
  argv: string[],
  startIndex: number,
  inline: string | undefined,
): { values: string[]; nextIndex: number } {
  const values: string[] = [];
  if (inline !== undefined) {
    const value = normaliseArgValue(inline);
    if (value) {
      values.push(value);
    }
    return { values, nextIndex: startIndex };
  }

  let currentIndex = startIndex;
  while (currentIndex < argv.length) {
    const nextToken = argv[currentIndex + 1];
    if (!nextToken || nextToken.startsWith('-')) {
      break;
    }
    const value = normaliseArgValue(nextToken);
    if (value) {
      values.push(value);
    }
    currentIndex++;
  }
  return { values, nextIndex: currentIndex };
}

function applySetFlag(
  argv: string[],
  index: number,
  inline: string | undefined,
  state: BootstrapParseState,
): number {
  const { values, nextIndex } = collectSetOverrideValues(argv, index, inline);
  if (values.length > 0) {
    state.bootstrapArgs.setOverrides ??= [];
    state.bootstrapArgs.setOverrides.push(...values);
  }
  return nextIndex;
}

function applyBootstrapFlag(
  argv: string[],
  index: number,
  state: BootstrapParseState,
): number {
  const token = argv[index];
  if (!token.startsWith('-')) {
    return index;
  }
  const { flag, inline } = parseFlagToken(token);
  const consumed = consumeBootstrapValue(argv, index, inline);
  if (applySimpleBootstrapFlag(flag, consumed, state)) {
    return consumed.nextIndex;
  }
  if (flag === '--profile') {
    applyProfileJsonFlag(consumed, state);
    return consumed.nextIndex;
  }
  if (flag === '--key-name') {
    applyKeyNameFlag(consumed, state);
    return consumed.nextIndex;
  }
  if (flag === '--set') {
    return applySetFlag(argv, index, inline, state);
  }
  return index;
}

function validateBootstrapArgs(state: BootstrapParseState): void {
  if (state.profileUsed && state.profileLoadUsed) {
    throw new Error(
      'Cannot use both --profile and --profile-load. Use one at a time.',
    );
  }
  if (
    state.bootstrapArgs.profileJson !== null &&
    state.bootstrapArgs.profileJson.length > 10240
  ) {
    throw new Error('Profile JSON exceeds maximum size of 10KB');
  }
}

function logBootstrapArgs(
  logger: DebugLogger,
  bootstrapArgs: BootstrapProfileArgs,
): void {
  logger.debug(
    () =>
      `parseBootstrapArgs result: ${JSON.stringify({
        profileName: bootstrapArgs.profileName,
        providerOverride: bootstrapArgs.providerOverride,
        modelOverride: bootstrapArgs.modelOverride,
        keyOverride: bootstrapArgs.keyOverride ? '***' : null,
        keyfileOverride: bootstrapArgs.keyfileOverride,
        keyNameOverride: bootstrapArgs.keyNameOverride,
        baseurlOverride: bootstrapArgs.baseurlOverride,
        setOverrides: bootstrapArgs.setOverrides,
      })}`,
  );
}

function parseProcessBootstrapArgs(argv: string[]): ParsedBootstrapArgs {
  const state: BootstrapParseState = {
    bootstrapArgs: createEmptyBootstrapArgs(),
    profileLoadUsed: false,
    profileUsed: false,
  };
  const runtimeMetadata = createRuntimeMetadata(argv);
  const logger = new DebugLogger('llxprt:bootstrap');
  logger.debug(
    () => `parseBootstrapArgs called with argv: ${JSON.stringify(argv)}`,
  );
  for (let index = 0; index < argv.length; index += 1) {
    index = applyBootstrapFlag(argv, index, state);
  }
  validateBootstrapArgs(state);
  logBootstrapArgs(logger, state.bootstrapArgs);
  return { bootstrapArgs: state.bootstrapArgs, runtimeMetadata };
}

/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P06
 * @requirement REQ-SP3-001
 * @pseudocode bootstrap-order.md lines 1-9
 */
export function parseBootstrapArgs(): ParsedBootstrapArgs;
export function parseBootstrapArgs(
  args: BootstrapProfileArgs,
  metadata: RuntimeBootstrapMetadata,
): ParsedBootstrapArgs;
export function parseBootstrapArgs(
  args?: BootstrapProfileArgs,
  metadata?: RuntimeBootstrapMetadata,
): ParsedBootstrapArgs {
  if (args !== undefined && metadata !== undefined) {
    // Validate profileJson if present
    if (args.profileJson !== null) {
      const baseProfile = parseInlineProfile(args.profileJson);
      if (baseProfile.error) {
        throw new Error(`Failed to apply inline profile from --profile:
${baseProfile.error}`);
      }
    }
    return {
      bootstrapArgs: args,
      runtimeMetadata: metadata,
    };
  }
  return parseProcessBootstrapArgs(process.argv.slice(2));
}

/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P06
 * @requirement REQ-SP3-001
 * @pseudocode bootstrap-order.md lines 1-9
 */
export async function prepareRuntimeForProfile(
  parsed: ParsedBootstrapArgs,
): Promise<BootstrapRuntimeState> {
  const runtimeInit = parsed.runtimeMetadata;
  const providedService = runtimeInit.settingsService;
  const settingsService =
    providedService instanceof SettingsService
      ? providedService
      : new SettingsService();

  const runtimeId = runtimeInit.runtimeId ?? DEFAULT_RUNTIME_ID;
  const metadata = {
    ...(runtimeInit.metadata ?? {}),
    stage: 'prepareRuntimeForProfile',
  };

  // Config may not exist yet during early CLI bootstrap (chicken-and-egg:
  // Config is created later in loadCliConfig after profile resolution).
  // Both createProviderManager and registerCliProviderInfrastructure
  // already guard against undefined config.
  const runtimeConfig = runtimeInit.config;
  const runtime = {
    settingsService,
    config: runtimeConfig,
    runtimeId,
    metadata,
  } as ProviderRuntimeContext;
  const runtimeMessageBus =
    runtimeInit.messageBus ??
    (runtimeConfig
      ? new MessageBus(
          runtimeConfig.getPolicyEngine(),
          runtimeConfig.getDebugMode(),
        )
      : new MessageBus());

  const { manager: providerManager, oauthManager } = createProviderManager(
    {
      settingsService: runtime.settingsService,
      config: runtime.config,
      runtimeId: runtime.runtimeId,
      metadata: runtime.metadata,
    },
    {
      config: runtime.config,
      runtimeMessageBus,
    },
  );

  registerCliProviderInfrastructure(providerManager, oauthManager, {
    messageBus: runtimeMessageBus,
  });

  return {
    runtime,
    runtimeMessageBus,
    providerManager,
    oauthManager,
  };
}

function isProfileValidationResult(
  value: unknown,
): value is ProfileApplicationResult {
  return typeof value === 'object' && value !== null && 'error' in value;
}

function profileValidationError(error: string): ProfileApplicationResult {
  return { providerName: '', modelName: '', warnings: [], error };
}

function parseInlineProfileJson(
  jsonString: string,
): unknown | ProfileApplicationResult {
  if (!jsonString || jsonString.trim() === '') {
    return profileValidationError('Profile JSON cannot be empty');
  }
  try {
    return JSON.parse(jsonString) as unknown;
  } catch (err) {
    return profileValidationError(
      `Invalid JSON in --profile: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function validateInlineProfileObject(
  parsed: unknown,
): Record<string, unknown> | ProfileApplicationResult {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return profileValidationError(
      'Profile must be a JSON object, not an array or primitive value',
    );
  }
  return parsed as Record<string, unknown>;
}

function validateRequiredProfileString(
  obj: Record<string, unknown>,
  field: 'provider' | 'model',
): string | ProfileApplicationResult {
  const value = obj[field];
  if (value === undefined || value === null || typeof value !== 'string') {
    return profileValidationError(
      `'${field}' is required and must be a string`,
    );
  }
  return value;
}

function validateProfileTemperature(
  obj: Record<string, unknown>,
): ProfileApplicationResult | undefined {
  if (obj.temperature === undefined) {
    return undefined;
  }
  if (typeof obj.temperature !== 'number') {
    return profileValidationError(
      "'temperature' must be a number between 0 and 2",
    );
  }
  if (obj.temperature < 0 || obj.temperature > 2) {
    return profileValidationError(
      "'temperature' must be a number between 0 and 2",
    );
  }
  return undefined;
}

function validateProfileDepth(
  parsed: unknown,
): ProfileApplicationResult | undefined {
  const depth = getMaxNestingDepth(parsed);
  if (depth > 5) {
    return profileValidationError(
      `Profile nesting depth exceeds maximum of 5 levels (found ${depth} levels). Simplify your profile structure.`,
    );
  }
  return undefined;
}

function validateDangerousProfileFields(
  parsed: unknown,
): ProfileApplicationResult | undefined {
  if (hasDangerousField(parsed, ['__proto__', 'constructor', 'prototype'])) {
    return profileValidationError(
      'Profile contains dangerous fields (__proto__, constructor, or prototype)',
    );
  }
  return undefined;
}

/**
 * @plan PLAN-20251118-ISSUE533.P07
 * @requirement REQ-PROF-002.1
 */
export function parseInlineProfile(
  jsonString: string,
): ProfileApplicationResult {
  const parsed = parseInlineProfileJson(jsonString);
  if (isProfileValidationResult(parsed)) {
    return parsed;
  }
  const obj = validateInlineProfileObject(parsed);
  if (isProfileValidationResult(obj)) {
    return obj;
  }
  const providerName = validateRequiredProfileString(obj, 'provider');
  if (typeof providerName !== 'string') {
    return providerName;
  }
  const modelName = validateRequiredProfileString(obj, 'model');
  if (typeof modelName !== 'string') {
    return modelName;
  }
  const validationError =
    validateProfileTemperature(obj) ??
    validateProfileDepth(parsed) ??
    validateDangerousProfileFields(parsed);
  if (validationError !== undefined) {
    return validationError;
  }
  return { providerName, modelName, warnings: [] };
}

/**
 * @plan PLAN-20251118-ISSUE533.P08
 * @requirement REQ-PROF-003.2
 * @pseudocode parse-inline-profile.md lines 050-065
 *
 * Recursively checks if an object contains any dangerous field names
 * that could lead to prototype pollution.
 *
 * @param obj - The object to check
 * @param dangerousFields - Array of field names to check for
 * @returns true if any dangerous field is found
 */
function hasDangerousField(obj: unknown, dangerousFields: string[]): boolean {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return false;
  }

  const record = obj as Record<string, unknown>;

  // Check if object has any dangerous keys as own properties
  for (const key of dangerousFields) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return true;
    }
  }

  // Recursively check nested objects and arrays
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (
      typeof value === 'object' &&
      value !== null &&
      hasDangerousField(value, dangerousFields)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * @plan PLAN-20251118-ISSUE533.P08
 * @requirement REQ-PROF-003.3
 * @pseudocode parse-inline-profile.md lines 080-095
 *
 * Calculates the maximum nesting depth of an object or array structure.
 *
 * @param obj - The object/array to measure depth
 * @param currentDepth - The current depth level (default 0)
 * @returns The maximum nesting depth
 */
function getMaxNestingDepth(obj: unknown, currentDepth = 1): number {
  // Base case: null, undefined, or non-object types (primitives don't add depth)
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return currentDepth - 1;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      return currentDepth;
    }
    return Math.max(
      ...obj.map((item) => getMaxNestingDepth(item, currentDepth + 1)),
    );
  }

  // Handle objects
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return currentDepth;
  }
  const record = obj as Record<string, unknown>;
  return Math.max(
    ...keys.map((key) => getMaxNestingDepth(record[key], currentDepth + 1)),
  );
}

/**
 * @plan PLAN-20251118-ISSUE533.P06
 * @requirement REQ-PROF-003.2
 */
// @ts-expect-error - Stub function, will be implemented in later phase
function _formatValidationErrors(_errors: unknown[]): string {
  return '';
}
interface FullBootstrapResultInput {
  runtime: BootstrapRuntimeState['runtime'];
  providerManager: BootstrapRuntimeState['providerManager'];
  oauthManager?: BootstrapRuntimeState['oauthManager'];
  bootstrapArgs: BootstrapProfileArgs;
  profileApplication: ProfileApplicationResult;
}

function createInlineProfileBootstrapResult(
  bootstrapArgs: BootstrapProfileArgs,
): ProfileApplicationResult {
  const baseProfile = parseInlineProfile(bootstrapArgs.profileJson ?? '');
  if (baseProfile.error) {
    throw new Error(`Failed to apply inline profile from --profile:
${baseProfile.error}`);
  }
  return applyOverridesToProfile(baseProfile, bootstrapArgs);
}

function createLoadedProfileBootstrapResult(
  bootstrapArgs: BootstrapProfileArgs,
  runtimeMetadata: RuntimeBootstrapMetadata,
): ProfileApplicationResult {
  const settingsService = runtimeMetadata.settingsService;
  if (settingsService) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profile = (settingsService as any).getProfile(
      bootstrapArgs.profileName,
    );
    if (profile !== null && profile !== undefined) {
      return applyOverridesToProfile(
        {
          providerName: profile.provider ?? '',
          modelName: profile.model ?? '',
          warnings: [],
        },
        bootstrapArgs,
      );
    }
  }
  return {
    providerName: '',
    modelName: '',
    warnings: [`Profile '${bootstrapArgs.profileName}' not found`],
  };
}

function createOverrideOnlyBootstrapResult(
  bootstrapArgs: BootstrapProfileArgs,
): ProfileApplicationResult {
  return {
    providerName: bootstrapArgs.providerOverride ?? '',
    modelName: bootstrapArgs.modelOverride ?? '',
    baseUrl: bootstrapArgs.baseurlOverride ?? undefined,
    warnings: [],
  };
}

function createEmptyProfileBootstrapResult(): ProfileApplicationResult {
  return {
    providerName: null as unknown as string,
    modelName: null as unknown as string,
    warnings: [],
  };
}

function createTestingBootstrapResult(
  bootstrapArgs: BootstrapProfileArgs,
  runtimeMetadata: RuntimeBootstrapMetadata,
): ProfileApplicationResult {
  if (bootstrapArgs.profileJson !== null) {
    return createInlineProfileBootstrapResult(bootstrapArgs);
  }
  if (bootstrapArgs.profileName !== null) {
    return createLoadedProfileBootstrapResult(bootstrapArgs, runtimeMetadata);
  }
  if (
    bootstrapArgs.providerOverride !== null ||
    bootstrapArgs.modelOverride !== null
  ) {
    return createOverrideOnlyBootstrapResult(bootstrapArgs);
  }
  return createEmptyProfileBootstrapResult();
}

function createFullBootstrapResult(
  input: FullBootstrapResultInput,
): BootstrapResult {
  return {
    runtime: {
      ...input.runtime,
      metadata: {
        ...(input.runtime.metadata ?? {}),
        stage: 'bootstrap-complete',
      },
    },
    providerManager: input.providerManager,
    oauthManager: input.oauthManager,
    bootstrapArgs: input.bootstrapArgs,
    profile: input.profileApplication,
  };
}

/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P06
 * @plan PLAN-20251118-ISSUE533.P10
 * @requirement REQ-SP3-001
 * @requirement REQ-INT-001.1
 * @requirement REQ-INT-002.1
 * @pseudocode bootstrap-order.md lines 1-9
 */
export function createBootstrapResult(
  bootstrapArgs: BootstrapProfileArgs,
  runtimeMetadata: RuntimeBootstrapMetadata,
): ProfileApplicationResult;
export function createBootstrapResult(
  input: FullBootstrapResultInput,
): BootstrapResult;
export function createBootstrapResult(
  inputOrBootstrapArgs: FullBootstrapResultInput | BootstrapProfileArgs,
  runtimeMetadata?: RuntimeBootstrapMetadata,
): BootstrapResult | ProfileApplicationResult {
  if (
    runtimeMetadata !== undefined &&
    typeof inputOrBootstrapArgs === 'object' &&
    'profileName' in inputOrBootstrapArgs
  ) {
    return createTestingBootstrapResult(inputOrBootstrapArgs, runtimeMetadata);
  }
  return createFullBootstrapResult(
    inputOrBootstrapArgs as FullBootstrapResultInput,
  );
}

/**
 * @plan PLAN-20251118-ISSUE533.P10
 * @requirement REQ-INT-001.1
 * @requirement REQ-INT-002.1
 * Applies command-line overrides on top of a loaded profile
 */
function applyOverridesToProfile(
  baseProfile: ProfileApplicationResult,
  args: BootstrapProfileArgs,
): ProfileApplicationResult {
  const warnings: string[] = [...baseProfile.warnings];
  let providerName = baseProfile.providerName;
  let modelName = baseProfile.modelName;
  let baseUrl = baseProfile.baseUrl;

  // Apply provider override
  if (args.providerOverride !== null) {
    providerName = args.providerOverride;
    warnings.push(`Provider overridden to '${providerName}' via --provider`);
  }

  // Apply model override (no warning for model override per test expectations)
  if (args.modelOverride !== null) {
    modelName = args.modelOverride;
  }

  // Apply baseurl override
  if (args.baseurlOverride !== null) {
    baseUrl = args.baseurlOverride;
    warnings.push(`Base URL overridden to '${baseUrl}' via --baseurl`);
  }

  // Apply key override (warning only)
  if (args.keyOverride !== null) {
    warnings.push('API key overridden via --key');
  }

  // Apply keyfile override (warning only)
  if (args.keyfileOverride !== null) {
    warnings.push('API key file overridden via --keyfile');
  }

  return {
    providerName,
    modelName,
    baseUrl,
    warnings,
  };
}
