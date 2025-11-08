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
  providerOverride: string | null;
  modelOverride: string | null;
  keyOverride: string | null;
  keyfileOverride: string | null;
  baseurlOverride: string | null;
  setOverrides: string[] | null;
}

export interface RuntimeBootstrapMetadata {
  settingsService?: SettingsService;
  config?: ProviderRuntimeContext['config'];
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
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P06
 * @requirement REQ-SP3-001
 * @pseudocode bootstrap-order.md lines 1-9
 */
export function parseBootstrapArgs(): ParsedBootstrapArgs {
  const argv = process.argv.slice(2);
  const bootstrapArgs: BootstrapProfileArgs = {
    profileName: null,
    providerOverride: null,
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null,
  };

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
    if (nextToken && !nextToken.startsWith('-')) {
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
        const { value, nextIndex } = consumeValue(argv, index, inline);
        bootstrapArgs.profileName = value;
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

  // Debug: log what we parsed
  logger.debug(
    () =>
      `parseBootstrapArgs result: ${JSON.stringify({
        profileName: bootstrapArgs.profileName,
        providerOverride: bootstrapArgs.providerOverride,
        modelOverride: bootstrapArgs.modelOverride,
        keyOverride: bootstrapArgs.keyOverride ? '***' : null,
        keyfileOverride: bootstrapArgs.keyfileOverride,
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
 * @plan PLAN-20251020-STATELESSPROVIDER3.P06
 * @requirement REQ-SP3-001
 * @pseudocode bootstrap-order.md lines 1-9
 */
export function createBootstrapResult(input: {
  runtime: BootstrapRuntimeState['runtime'];
  providerManager: BootstrapRuntimeState['providerManager'];
  oauthManager?: BootstrapRuntimeState['oauthManager'];
  bootstrapArgs: BootstrapProfileArgs;
  profileApplication: ProfileApplicationResult;
}): BootstrapResult {
  const runtimeMetadata = {
    ...(input.runtime.metadata ?? {}),
    stage: 'bootstrap-complete',
  };

  const runtime: ProviderRuntimeContext = {
    ...input.runtime,
    metadata: runtimeMetadata,
  };

  return {
    runtime,
    providerManager: input.providerManager,
    oauthManager: input.oauthManager,
    bootstrapArgs: input.bootstrapArgs,
    profile: input.profileApplication,
  };
}
