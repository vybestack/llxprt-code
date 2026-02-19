import os from 'node:os';
import path from 'node:path';
import { ProfileManager } from '@vybestack/llxprt-code-core';
import type { ProviderKey, SessionConfig } from './llxprtAdapter';
import type { ConfigSessionOptions } from './configSession';

export interface ConfigCommandResult {
  readonly handled: boolean;
  readonly nextConfig: SessionConfig;
  readonly messages: string[];
}

export interface ConfigCommandResultWithSession extends ConfigCommandResult {
  readonly sessionOptions?: ConfigSessionOptions;
  readonly profileName?: string;
}

interface ApplyOptions {
  readonly profileDir?: string;
  readonly profileManager?: Pick<
    ProfileManager,
    'loadProfile' | 'listProfiles'
  >;
}

const SYNTHETIC_PROFILE_DEFAULT = path.join(
  os.homedir(),
  '.llxprt/profiles/synthetic.json',
);

export async function applyConfigCommand(
  rawInput: string,
  current: SessionConfig,
  options?: ApplyOptions,
): Promise<ConfigCommandResult> {
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith('/')) {
    return Promise.resolve({
      handled: false,
      nextConfig: current,
      messages: [],
    });
  }

  const body = trimmed.slice(1).trim();
  if (!body) {
    return Promise.resolve({
      handled: false,
      nextConfig: current,
      messages: [],
    });
  }

  const tokens = body.split(/\s+/).filter((token) => token.length > 0);
  const [rawCommand, ...rest] = tokens;
  const command = rawCommand.toLowerCase();
  const argument = rest.join(' ').trim();

  if (command === 'provider') {
    if (!argument) {
      return Promise.resolve({
        handled: false,
        nextConfig: current,
        messages: [],
      });
    }
    return Promise.resolve(applyProvider(argument, current));
  }
  if (command === 'baseurl' || command === 'base-url' || command === 'basurl') {
    return Promise.resolve(applyBaseUrl(argument, current));
  }
  if (command === 'keyfile') {
    return Promise.resolve(applyKeyFile(argument, current));
  }
  if (command === 'key') {
    return Promise.resolve(applyKey(argument, current));
  }
  if (command === 'model') {
    if (!argument) {
      return Promise.resolve({
        handled: false,
        nextConfig: current,
        messages: [],
      });
    }
    return Promise.resolve(applyModel(argument, current));
  }
  if (command === 'profile') {
    return applyProfile(rest, current, options);
  }

  return Promise.resolve({ handled: false, nextConfig: current, messages: [] });
}

function applyProvider(
  argument: string,
  current: SessionConfig,
): ConfigCommandResult {
  if (!argument) {
    return {
      handled: true,
      nextConfig: current,
      messages: [
        'Provider is required. Usage: /provider <openai|gemini|anthropic>',
      ],
    };
  }
  const provider = normalizeProvider(argument);
  if (!provider) {
    return {
      handled: true,
      nextConfig: current,
      messages: [`Unknown provider: ${argument}`],
    };
  }
  return {
    handled: true,
    nextConfig: { ...current, provider },
    messages: [`Provider set to ${provider}`],
  };
}

function applyBaseUrl(
  argument: string,
  current: SessionConfig,
): ConfigCommandResult {
  if (!argument) {
    return {
      handled: true,
      nextConfig: current,
      messages: ['Base URL is required. Usage: /baseurl <url>'],
    };
  }
  return {
    handled: true,
    nextConfig: { ...current, 'base-url': argument },
    messages: [`Base URL set to ${argument}`],
  };
}

function applyKeyFile(
  argument: string,
  current: SessionConfig,
): ConfigCommandResult {
  if (!argument) {
    return {
      handled: true,
      nextConfig: current,
      messages: ['Keyfile path is required. Usage: /keyfile <path>'],
    };
  }
  return {
    handled: true,
    nextConfig: { ...current, keyFilePath: argument, apiKey: undefined },
    messages: ['Keyfile configured'],
  };
}

function applyKey(
  argument: string,
  current: SessionConfig,
): ConfigCommandResult {
  if (!argument) {
    return {
      handled: true,
      nextConfig: current,
      messages: ['API key is required. Usage: /key <token>'],
    };
  }
  return {
    handled: true,
    nextConfig: { ...current, apiKey: argument, keyFilePath: undefined },
    messages: ['API key configured'],
  };
}

function applyModel(
  argument: string,
  current: SessionConfig,
): ConfigCommandResult {
  if (!argument) {
    return {
      handled: true,
      nextConfig: current,
      messages: ['Model is required. Usage: /model <id>'],
    };
  }
  return {
    handled: true,
    nextConfig: { ...current, model: argument },
    messages: [`Model set to ${argument}`],
  };
}

interface ParsedProfileArgs {
  readonly action: string;
  readonly name: string;
}

interface ProfileValidationError {
  readonly error: string;
}

type ProfileArgResult = ParsedProfileArgs | ProfileValidationError;

function parseProfileArgs(args: string[]): ProfileArgResult {
  if (args.length === 0) {
    return { error: 'Profile name is required. Usage: /profile load <name>' };
  }
  const [action, name] =
    args.length === 1 ? ['load', args[0]] : [args[0], args[1]];
  if (action.toLowerCase() !== 'load') {
    return { error: 'Usage: /profile load <name>' };
  }
  if (!name) {
    return { error: 'Profile name is required. Usage: /profile load <name>' };
  }
  return { action, name };
}

export interface ProfileData {
  readonly provider?: string;
  readonly model?: string;
  readonly authKeyfile?: string;
  readonly ephemeralSettings?: Record<string, unknown>;
}

function mapProfileToSessionConfig(
  profile: ProfileData,
): Partial<SessionConfig> | null {
  const ephemeral = profile.ephemeralSettings ?? {};
  const provider = normalizeProvider(profile.provider);
  const baseUrl = ephemeral['base-url'] as string | undefined;
  const keyFilePath = (ephemeral['auth-keyfile'] ??
    ephemeral.authKeyfile ??
    profile.authKeyfile) as string | undefined;
  const model = (ephemeral.model ?? profile.model) as string | undefined;

  if (!provider || !baseUrl || !keyFilePath || !model) {
    return null;
  }

  // Pass through all ephemeral settings to the session config
  return {
    provider,
    'base-url': baseUrl,
    keyFilePath,
    model,
    apiKey: undefined,
    ephemeralSettings: ephemeral,
  };
}

function validateProfileConfig(
  config: Partial<SessionConfig> | null,
  profileName: string,
): string | null {
  if (config === null) {
    return `Profile "${profileName}" is incomplete; need provider, base-url, auth-keyfile, and model.`;
  }
  return null;
}

async function applyProfile(
  args: string[],
  current: SessionConfig,
  options?: ApplyOptions,
): Promise<ConfigCommandResult> {
  const parsed = parseProfileArgs(args);
  if ('error' in parsed) {
    return { handled: true, nextConfig: current, messages: [parsed.error] };
  }

  const profileDir =
    options?.profileDir ?? path.dirname(SYNTHETIC_PROFILE_DEFAULT);
  const manager = options?.profileManager ?? new ProfileManager(profileDir);

  try {
    const profile = await manager.loadProfile(parsed.name);
    const config = mapProfileToSessionConfig(profile as unknown as ProfileData);
    const error = validateProfileConfig(config, parsed.name);

    if (error !== null) {
      return { handled: true, nextConfig: current, messages: [error] };
    }

    return {
      handled: true,
      nextConfig: { ...current, ...config },
      messages: [`Loaded profile: ${parsed.name}`],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      handled: true,
      nextConfig: current,
      messages: [`Failed to load profile "${parsed.name}": ${message}`],
    };
  }
}

function normalizeProvider(input: string | undefined): ProviderKey | null {
  if (!input) {
    return null;
  }
  const lowered = input.trim().toLowerCase();
  if (lowered === 'openai' || lowered === 'gemini' || lowered === 'anthropic') {
    return lowered;
  }
  return null;
}

export function validateSessionConfig(
  config: SessionConfig,
  options?: { requireModel?: boolean },
): string[] {
  const messages: string[] = [];
  if (!config['base-url']?.trim()) {
    messages.push('Base URL not set. Use /baseurl <url>.');
  }
  if (options?.requireModel !== false) {
    if (!config.model?.trim()) {
      messages.push('Model not set. Use /model <id>.');
    }
  }
  const hasKey = Boolean(config.apiKey?.trim() ?? config.keyFilePath?.trim());
  if (!hasKey) {
    messages.push(
      'API key or keyfile not set. Use /key <token> or /keyfile <path>.',
    );
  }
  return messages;
}

export async function listAvailableProfiles(
  options?: ApplyOptions,
): Promise<string[]> {
  const profileDir =
    options?.profileDir ?? path.dirname(SYNTHETIC_PROFILE_DEFAULT);
  const manager = options?.profileManager ?? new ProfileManager(profileDir);
  try {
    return await manager.listProfiles();
  } catch {
    return [];
  }
}

export function profileToConfigOptions(
  profile: ProfileData,
  workingDir: string,
): ConfigSessionOptions {
  const ephemeral = profile.ephemeralSettings ?? {};

  return {
    model: ((ephemeral.model ?? profile.model) as string) || 'gemini-2.5-flash',
    provider: profile.provider,
    workingDir,
    'base-url': ephemeral['base-url'] as string | undefined,
    authKeyfile: (ephemeral['auth-keyfile'] ??
      ephemeral.authKeyfile ??
      profile.authKeyfile) as string | undefined,
    apiKey: ephemeral['auth-key'] as string | undefined,
  };
}

interface ApplyWithSessionOptions extends ApplyOptions {
  readonly workingDir: string;
}

export async function applyProfileWithSession(
  rawInput: string,
  current: SessionConfig,
  options: ApplyWithSessionOptions,
): Promise<ConfigCommandResultWithSession> {
  const result = await applyConfigCommand(rawInput, current, options);

  // Check if this was a profile load command
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith('/')) {
    return { ...result, sessionOptions: undefined };
  }

  const body = trimmed.slice(1).trim();
  const tokens = body.split(/\s+/).filter((token) => token.length > 0);
  const command = tokens.at(0)?.toLowerCase() ?? '';

  // Only generate session options for profile commands
  if (command !== 'profile') {
    return { ...result, sessionOptions: undefined };
  }

  // Extract profile name from command tokens (e.g., "/profile load <name>")
  const profileArg = parseProfileArgs(tokens.slice(1));
  const loadedProfileName = 'error' in profileArg ? undefined : profileArg.name;

  // Check if the profile was actually loaded by comparing references.
  // applyProfile returns `current` by reference on failure and a new spread
  // object on success, so !== is a reliable guard.
  const profileActuallyLoaded = result.nextConfig !== current;

  // If profile load failed or config is incomplete, don't return options
  if (
    !result.handled ||
    !profileActuallyLoaded ||
    !result.nextConfig.model ||
    !result.nextConfig['base-url']
  ) {
    return { ...result, sessionOptions: undefined };
  }

  // Convert the new config to session options
  const sessionOptions = profileToConfigOptions(
    {
      provider: result.nextConfig.provider,
      model: result.nextConfig.model,
      authKeyfile: result.nextConfig.keyFilePath,
      ephemeralSettings: result.nextConfig.ephemeralSettings,
    },
    options.workingDir,
  );

  return { ...result, sessionOptions, profileName: loadedProfileName };
}
