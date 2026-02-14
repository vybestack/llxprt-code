/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SettingsService,
  type ProviderRuntimeContext,
  type ProviderManager,
} from '@vybestack/llxprt-code-core';
import { createProviderManager } from '../providers/providerManagerInstance.js';
import { registerCliProviderInfrastructure } from '../runtime/runtimeSettings.js';
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
  metadata?: Record<string, unknown>;
}

export interface ParsedBootstrapArgs {
  bootstrapArgs: BootstrapProfileArgs;
  runtimeMetadata: RuntimeBootstrapMetadata;
}

export interface BootstrapRuntimeState {
  runtime: ProviderRuntimeContext;
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
  const argv = process.argv.slice(2);
  const bootstrapArgs: BootstrapProfileArgs = {
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

  /**
   * @plan PLAN-20251118-ISSUE533.P05
   * @requirement REQ-INT-001.2
   * @pseudocode parse-bootstrap-args.md lines 013-014
   */
  let profileLoadUsed = false; // Track if --profile-load was used
  let profileUsed = false; // Track if --profile was used

  const runtimeMetadata: RuntimeBootstrapMetadata = {
    runtimeId: process.env.LLXPRT_RUNTIME_ID ?? DEFAULT_RUNTIME_ID,
    metadata: {
      source: 'cli.bootstrap',
      argv: argv.slice(),
      timestamp: Date.now(),
    },
  };

  // Debug: log what we're parsing
  const logger = new DebugLogger('llxprt:bootstrap');
  logger.debug(
    () => `parseBootstrapArgs called with argv: ${JSON.stringify(argv)}`,
  );

  const consumeValue = (
    tokens: string[],
    currentIndex: number,
    inlineValue: string | undefined,
  ): { value: string | null; nextIndex: number } => {
    if (inlineValue !== undefined) {
      return { value: normaliseArgValue(inlineValue), nextIndex: currentIndex };
    }
    const nextToken = tokens[currentIndex + 1];
    // Check for next token - empty string is valid, undefined means no value
    if (nextToken !== undefined && !nextToken.startsWith('-')) {
      return {
        value: normaliseArgValue(nextToken),
        nextIndex: currentIndex + 1,
      };
    }
    return { value: null, nextIndex: currentIndex };
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('-')) {
      continue;
    }

    let flag = token;
    let inline: string | undefined;
    const equalsIndex = token.indexOf('=');
    if (equalsIndex !== -1) {
      flag = token.slice(0, equalsIndex);
      inline = token.slice(equalsIndex + 1);
    }

    switch (flag) {
      case '--profile-load': {
        /**
         * @plan PLAN-20251118-ISSUE533.P05
         * @requirement REQ-INT-001.2
         * @pseudocode parse-bootstrap-args.md lines 042-048
         */
        const { value, nextIndex } = consumeValue(argv, index, inline);
        bootstrapArgs.profileName = value;
        profileLoadUsed = true; // Track usage
        index = nextIndex;
        break;
      }
      case '--profile': {
        /**
         * @plan PLAN-20251118-ISSUE533.P05
         * @requirement REQ-PROF-001.1
         * @pseudocode parse-bootstrap-args.md lines 031-040
         */
        const { value, nextIndex } = consumeValue(argv, index, inline);

        // Verify value exists (null means no value provided)
        // Note: empty string "" is a valid value - validation happens later
        if (value === null) {
          throw new Error('--profile requires a value');
        }

        // Store JSON string (empty string "" is allowed after normalization)
        bootstrapArgs.profileJson = value;

        // Track usage for mutual exclusivity
        profileUsed = true;

        // Update index
        index = nextIndex;
        break;
      }
      case '--provider': {
        const { value, nextIndex } = consumeValue(argv, index, inline);
        bootstrapArgs.providerOverride = value;
        index = nextIndex;
        break;
      }
      case '--model':
      case '-m': {
        const { value, nextIndex } = consumeValue(argv, index, inline);
        bootstrapArgs.modelOverride = value;
        index = nextIndex;
        break;
      }
      case '--key': {
        const { value, nextIndex } = consumeValue(argv, index, inline);
        bootstrapArgs.keyOverride = value;
        index = nextIndex;
        break;
      }
      case '--keyfile': {
        const { value, nextIndex } = consumeValue(argv, index, inline);
        bootstrapArgs.keyfileOverride = value;
        index = nextIndex;
        break;
      }
      /**
       * @plan PLAN-20260211-SECURESTORE.P16
       * @requirement R22.2
       */
      case '--key-name': {
        const { value, nextIndex } = consumeValue(argv, index, inline);
        if (value === null) {
          throw new Error('--key-name requires a value');
        }
        bootstrapArgs.keyNameOverride = value;
        index = nextIndex;
        break;
      }
      case '--baseurl': {
        const { value, nextIndex } = consumeValue(argv, index, inline);
        bootstrapArgs.baseurlOverride = value;
        index = nextIndex;
        break;
      }
      case '--set': {
        const setValues: string[] = [];
        let currentIndex = index;

        if (inline !== undefined) {
          const value = normaliseArgValue(inline);
          if (value) {
            setValues.push(value);
          }
        }

        if (inline === undefined) {
          while (currentIndex < argv.length) {
            const nextToken = argv[currentIndex + 1];
            if (nextToken && !nextToken.startsWith('-')) {
              const value = normaliseArgValue(nextToken);
              if (value) {
                setValues.push(value);
              }
              currentIndex++;
            } else {
              break;
            }
          }
        }

        if (setValues.length > 0) {
          if (!bootstrapArgs.setOverrides) {
            bootstrapArgs.setOverrides = [];
          }
          bootstrapArgs.setOverrides.push(...setValues);
        }

        if (inline === undefined) {
          index = currentIndex;
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * @plan PLAN-20251118-ISSUE533.P05
   * @requirement REQ-INT-001.2
   * @pseudocode parse-bootstrap-args.md lines 060-067
   */
  if (profileUsed && profileLoadUsed) {
    throw new Error(
      'Cannot use both --profile and --profile-load. Use one at a time.',
    );
  }

  /**
   * @plan PLAN-20251118-ISSUE533.P05
   * @requirement REQ-PROF-003.3
   * @pseudocode parse-bootstrap-args.md lines 070-074
   */
  if (bootstrapArgs.profileJson !== null) {
    if (bootstrapArgs.profileJson.length > 10240) {
      throw new Error('Profile JSON exceeds maximum size of 10KB');
    }
  }

  // Debug: log what we parsed
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

  return { bootstrapArgs, runtimeMetadata };
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

  const runtime = {
    settingsService,
    config: runtimeInit.config,
    runtimeId,
    metadata,
  } as ProviderRuntimeContext;

  const { manager: providerManager, oauthManager } = createProviderManager(
    {
      settingsService: runtime.settingsService,
      config: runtime.config,
      runtimeId: runtime.runtimeId,
      metadata: runtime.metadata,
    },
    {
      config: runtime.config,
    },
  );

  // Register CLI infrastructure AFTER provider manager creation
  // This ensures tests that call prepareRuntimeForProfile directly still work.
  // loadCliConfig will call this again but it's idempotent.
  registerCliProviderInfrastructure(providerManager, oauthManager);

  return {
    runtime,
    providerManager,
    oauthManager,
  };
}

/**
 * @plan PLAN-20251118-ISSUE533.P07
 * @requirement REQ-PROF-002.1
 */
export function parseInlineProfile(
  jsonString: string,
): ProfileApplicationResult {
  // Step 1: Check for empty/whitespace-only string
  if (!jsonString || jsonString.trim() === '') {
    return {
      providerName: '',
      modelName: '',
      warnings: [],
      error: 'Profile JSON cannot be empty',
    };
  }

  // Step 2: Parse JSON and catch syntax errors
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    return {
      providerName: '',
      modelName: '',
      warnings: [],
      error: `Invalid JSON in --profile: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Step 3: Verify result is an object (not array or primitive)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      providerName: '',
      modelName: '',
      warnings: [],
      error: 'Profile must be a JSON object, not an array or primitive value',
    };
  }

  // Cast to a record type for type safety
  const obj = parsed as Record<string, unknown>;

  // Step 4: Validate required fields (provider and model must be strings)
  if (!obj.provider || typeof obj.provider !== 'string') {
    return {
      providerName: '',
      modelName: '',
      warnings: [],
      error: "'provider' is required and must be a string",
    };
  }

  if (!obj.model || typeof obj.model !== 'string') {
    return {
      providerName: '',
      modelName: '',
      warnings: [],
      error: "'model' is required and must be a string",
    };
  }

  // Step 5: Provider value validation removed - accept any provider name
  // Provider existence is validated later when the profile is applied via
  // selectAvailableProvider() and setActiveProvider(). This allows:
  // - Custom provider aliases (e.g., "Synthetic", "Fireworks", "OpenRouter")
  // - Future providers without code changes
  // - Proper fallback behavior with warnings if provider unavailable

  // Step 6: Optional validation - temperature range
  if (obj.temperature !== undefined) {
    if (typeof obj.temperature !== 'number') {
      return {
        providerName: '',
        modelName: '',
        warnings: [],
        error: "'temperature' must be a number between 0 and 2",
      };
    }
    if (obj.temperature < 0 || obj.temperature > 2) {
      return {
        providerName: '',
        modelName: '',
        warnings: [],
        error: "'temperature' must be a number between 0 and 2",
      };
    }
  }

  // Step 7: Check nesting depth (max 5 levels)
  const depth = getMaxNestingDepth(parsed);
  if (depth > 5) {
    return {
      providerName: '',
      modelName: '',
      warnings: [],
      error: `Profile nesting depth exceeds maximum of 5 levels (found ${depth} levels). Simplify your profile structure.`,
    };
  }

  // Step 8: Check for dangerous fields
  const dangerousFields = ['__proto__', 'constructor', 'prototype'];
  if (hasDangerousField(parsed, dangerousFields)) {
    return {
      providerName: '',
      modelName: '',
      warnings: [],
      error:
        'Profile contains dangerous fields (__proto__, constructor, or prototype)',
    };
  }

  // Step 9: Validate and extract baseUrl if present
  let baseUrl: string | undefined;
  if (obj.baseUrl !== undefined) {
    if (typeof obj.baseUrl !== 'string' || obj.baseUrl.trim() === '') {
      return {
        providerName: '',
        modelName: '',
        warnings: [],
        error: "'baseUrl' must be a non-empty string when provided",
      };
    }
    baseUrl = obj.baseUrl;
  }

  // Step 10: Return successful result
  return {
    providerName: obj.provider,
    modelName: obj.model,
    baseUrl,
    warnings: [],
  };
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
    if (typeof value === 'object' && value !== null) {
      if (hasDangerousField(value, dangerousFields)) {
        return true;
      }
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
export function createBootstrapResult(input: {
  runtime: BootstrapRuntimeState['runtime'];
  providerManager: BootstrapRuntimeState['providerManager'];
  oauthManager?: BootstrapRuntimeState['oauthManager'];
  bootstrapArgs: BootstrapProfileArgs;
  profileApplication: ProfileApplicationResult;
}): BootstrapResult;
export function createBootstrapResult(
  inputOrBootstrapArgs:
    | {
        runtime: BootstrapRuntimeState['runtime'];
        providerManager: BootstrapRuntimeState['providerManager'];
        oauthManager?: BootstrapRuntimeState['oauthManager'];
        bootstrapArgs: BootstrapProfileArgs;
        profileApplication: ProfileApplicationResult;
      }
    | BootstrapProfileArgs,
  runtimeMetadata?: RuntimeBootstrapMetadata,
): BootstrapResult | ProfileApplicationResult {
  // Handle simplified two-argument call for testing
  if (
    runtimeMetadata !== undefined &&
    typeof inputOrBootstrapArgs === 'object' &&
    'profileName' in inputOrBootstrapArgs
  ) {
    const bootstrapArgs = inputOrBootstrapArgs as BootstrapProfileArgs;

    // Apply profile from profileJson if present
    if (bootstrapArgs.profileJson !== null) {
      const baseProfile = parseInlineProfile(bootstrapArgs.profileJson);
      // If parseInlineProfile returned an error, throw it
      if (baseProfile.error) {
        throw new Error(`Failed to apply inline profile from --profile:
${baseProfile.error}`);
      }
      return applyOverridesToProfile(baseProfile, bootstrapArgs);
    }

    // Handle profileName (from --profile-load)
    if (bootstrapArgs.profileName !== null) {
      const settingsService = runtimeMetadata.settingsService;
      if (settingsService) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const profile = (settingsService as any).getProfile(
          bootstrapArgs.profileName,
        );
        if (profile) {
          const baseProfile: ProfileApplicationResult = {
            providerName: profile.provider || '',
            modelName: profile.model || '',
            baseUrl: profile.baseUrl,
            warnings: [],
          };
          return applyOverridesToProfile(baseProfile, bootstrapArgs);
        }
      }
      // Profile not found
      return {
        providerName: '',
        modelName: '',
        warnings: [`Profile '${bootstrapArgs.profileName}' not found`],
      };
    }

    // Handle command-line overrides without profile
    if (
      bootstrapArgs.providerOverride !== null ||
      bootstrapArgs.modelOverride !== null
    ) {
      const baseProfile: ProfileApplicationResult = {
        providerName: bootstrapArgs.providerOverride || '',
        modelName: bootstrapArgs.modelOverride || '',
        baseUrl: bootstrapArgs.baseurlOverride || undefined,
        warnings: [],
      };
      // Don't call applyOverridesToProfile since we're using them directly
      return baseProfile;
    }

    // Otherwise return null profile application result (no profile specified)
    // Otherwise return null profile application result (no profile specified)
    return {
      providerName: null as unknown as string,
      modelName: null as unknown as string,
      warnings: [],
    };
  }

  // Handle full input object call (production)
  const input = inputOrBootstrapArgs as {
    runtime: BootstrapRuntimeState['runtime'];
    providerManager: BootstrapRuntimeState['providerManager'];
    oauthManager?: BootstrapRuntimeState['oauthManager'];
    bootstrapArgs: BootstrapProfileArgs;
    profileApplication: ProfileApplicationResult;
  };

  const runtimeMeta = {
    ...(input.runtime.metadata ?? {}),
    stage: 'bootstrap-complete',
  };

  const runtime: ProviderRuntimeContext = {
    ...input.runtime,
    metadata: runtimeMeta,
  };

  return {
    runtime,
    providerManager: input.providerManager,
    oauthManager: input.oauthManager,
    bootstrapArgs: input.bootstrapArgs,
    profile: input.profileApplication,
  };
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
