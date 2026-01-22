/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getPackageJson,
  type SandboxConfig,
  FatalSandboxError,
} from '@vybestack/llxprt-code-core';
import commandExists from 'command-exists';
import * as os from 'node:os';
import { Settings } from './settings.js';
import { resolvePath } from '../utils/resolvePath.js';
import {
  ensureDefaultSandboxProfiles,
  loadSandboxProfile,
  type SandboxProfile,
  type SandboxProfileEngine,
  type SandboxProfileMount,
} from './sandboxProfiles.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This is a stripped-down version of the CliArgs interface from config.ts
// to avoid circular dependencies.
interface SandboxCliArgs {
  sandbox?: boolean | string;
  sandboxImage?: string;
  sandboxEngine?: string;
  sandboxProfileLoad?: string;
}
const VALID_SANDBOX_COMMANDS: ReadonlyArray<SandboxConfig['command']> = [
  'docker',
  'podman',
  'sandbox-exec',
];

const VALID_ENGINE_CHOICES: readonly SandboxProfileEngine[] = [
  'auto',
  'docker',
  'podman',
  'sandbox-exec',
  'none',
];

const VALID_NETWORK_CHOICES = ['on', 'off', 'proxied'] as const;
const VALID_SSH_AGENT_CHOICES = ['auto', 'on', 'off'] as const;

function isSandboxCommand(value: string): value is SandboxConfig['command'] {
  return (VALID_SANDBOX_COMMANDS as readonly string[]).includes(value);
}

function isEngineChoice(value: string): value is SandboxProfileEngine {
  return (VALID_ENGINE_CHOICES as readonly string[]).includes(value);
}

function normalizeEngineInput(
  value: string | undefined,
): SandboxProfileEngine | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (!isEngineChoice(trimmed)) {
    throw new FatalSandboxError(
      `Invalid sandbox engine '${value}'. Must be one of ${VALID_ENGINE_CHOICES.join(
        ', ',
      )}`,
    );
  }
  return trimmed;
}

function parseMemoryLimit(memory: string): string {
  const trimmed = memory.trim();
  if (trimmed.length === 0) {
    throw new FatalSandboxError('Sandbox memory value cannot be empty');
  }
  const match = trimmed.match(/^(\d+)([kKmMgG])?$/);
  if (!match) {
    throw new FatalSandboxError(
      `Invalid sandbox memory value '${memory}'. Expected values like 512m or 2g.`,
    );
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new FatalSandboxError(
      `Sandbox memory value must be positive, got '${memory}'.`,
    );
  }
  const unit = match[2]?.toLowerCase() ?? 'm';
  return `${value}${unit}`;
}

function parseCpuLimit(value: number | string): number {
  const cpuValue = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(cpuValue) || cpuValue <= 0) {
    throw new FatalSandboxError(
      `Sandbox CPU value must be greater than zero, got '${value}'.`,
    );
  }
  return cpuValue;
}

function parsePidsLimit(value: number | string): number {
  const pidsValue = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(pidsValue) || pidsValue <= 0) {
    throw new FatalSandboxError(
      `Sandbox pids value must be greater than zero, got '${value}'.`,
    );
  }
  if (!Number.isInteger(pidsValue)) {
    throw new FatalSandboxError(
      `Sandbox pids value must be an integer, got '${value}'.`,
    );
  }
  return pidsValue;
}

function resolveMountPath(input: string): string {
  const resolved = resolvePath(input);
  if (!resolved) {
    throw new FatalSandboxError(`Mount path cannot be empty.`);
  }
  return resolved;
}

function normalizeEnvEntries(
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') {
      throw new FatalSandboxError(
        `Sandbox env value for '${key}' must be a string.`,
      );
    }
    const trimmedValue = value.trim();
    if (
      trimmedValue.startsWith('~') ||
      trimmedValue.toLowerCase().startsWith('%userprofile%')
    ) {
      entries[key] = resolvePath(trimmedValue);
    } else {
      entries[key] = value;
    }
  }
  return entries;
}

function normalizeMounts(
  mounts: SandboxProfileMount[] | undefined,
): SandboxProfileMount[] | undefined {
  if (!mounts) {
    return undefined;
  }
  return mounts.map((mount) => {
    if (!mount.from || mount.from.trim().length === 0) {
      throw new FatalSandboxError('Sandbox mount requires a "from" path.');
    }
    const from = resolveMountPath(mount.from);
    const to = mount.to ? resolveMountPath(mount.to) : undefined;
    const mode = mount.mode ?? 'ro';
    if (mode !== 'ro' && mode !== 'rw') {
      throw new FatalSandboxError(
        `Sandbox mount mode must be 'ro' or 'rw', got '${mode}'.`,
      );
    }
    return { from, to, mode };
  });
}

function normalizeSandboxProfile(profile: SandboxProfile): SandboxProfile {
  const normalized: SandboxProfile = { ...profile };

  if (profile.engine) {
    const engine = normalizeEngineInput(profile.engine);
    normalized.engine = engine;
  }

  if (profile.network) {
    const normalizedNetwork = profile.network.trim().toLowerCase();
    if (!VALID_NETWORK_CHOICES.includes(normalizedNetwork as never)) {
      throw new FatalSandboxError(
        `Invalid sandbox network '${profile.network}'. Must be one of ${VALID_NETWORK_CHOICES.join(
          ', ',
        )}`,
      );
    }
    normalized.network =
      normalizedNetwork as (typeof VALID_NETWORK_CHOICES)[number];
  }

  if (profile.sshAgent) {
    const normalizedSsh = profile.sshAgent.trim().toLowerCase();
    if (!VALID_SSH_AGENT_CHOICES.includes(normalizedSsh as never)) {
      throw new FatalSandboxError(
        `Invalid sandbox sshAgent '${profile.sshAgent}'. Must be one of ${VALID_SSH_AGENT_CHOICES.join(
          ', ',
        )}`,
      );
    }
    normalized.sshAgent =
      normalizedSsh as (typeof VALID_SSH_AGENT_CHOICES)[number];
  }

  if (profile.resources) {
    normalized.resources = {
      ...profile.resources,
      cpus:
        profile.resources.cpus !== undefined
          ? parseCpuLimit(profile.resources.cpus)
          : undefined,
      memory:
        profile.resources.memory !== undefined
          ? parseMemoryLimit(profile.resources.memory)
          : undefined,
      pids:
        profile.resources.pids !== undefined
          ? parsePidsLimit(profile.resources.pids)
          : undefined,
    };
  }

  normalized.mounts = normalizeMounts(profile.mounts);
  normalized.env = normalizeEnvEntries(profile.env);

  return normalized;
}

function getSandboxCommand(
  sandbox?: boolean | string,
): SandboxConfig['command'] | '' {
  // If the SANDBOX env var is set, we're already inside the sandbox.
  if (process.env.SANDBOX) {
    return '';
  }

  // note environment variable takes precedence over argument (from command line or settings)
  const environmentConfiguredSandbox =
    process.env.LLXPRT_SANDBOX?.toLowerCase().trim() ?? '';
  sandbox =
    environmentConfiguredSandbox?.length > 0
      ? environmentConfiguredSandbox
      : sandbox;
  if (sandbox === '1' || sandbox === 'true') sandbox = true;
  else if (sandbox === '0' || sandbox === 'false' || !sandbox) sandbox = false;

  if (sandbox === false) {
    return '';
  }

  if (typeof sandbox === 'string' && sandbox) {
    if (!isSandboxCommand(sandbox)) {
      throw new FatalSandboxError(
        `Invalid sandbox command '${sandbox}'. Must be one of ${VALID_SANDBOX_COMMANDS.join(
          ', ',
        )}`,
      );
    }
    // confirm that specified command exists
    if (commandExists.sync(sandbox)) {
      return sandbox;
    }
    throw new FatalSandboxError(
      `Missing sandbox command '${sandbox}' (from LLXPRT_SANDBOX)`,
    );
  }

  // All sandbox types require explicit opt-in (sandbox === true)
  if (
    sandbox === true &&
    os.platform() === 'darwin' &&
    commandExists.sync('sandbox-exec')
  ) {
    return 'sandbox-exec';
  } else if (commandExists.sync('docker') && sandbox === true) {
    return 'docker';
  } else if (commandExists.sync('podman') && sandbox === true) {
    return 'podman';
  }

  // throw an error if user requested sandbox but no command was found
  if (sandbox === true) {
    throw new FatalSandboxError(
      'LLXPRT_SANDBOX is true but failed to determine command for sandbox; ' +
        'install docker or podman or specify command in LLXPRT_SANDBOX',
    );
  }

  return '';
}

function resolveSandboxEngine(
  engine: SandboxProfileEngine | undefined,
  baseCommand: SandboxConfig['command'] | '',
): SandboxConfig['command'] | '' {
  if (engine === 'none') {
    return '';
  }

  const pickFallback = (): SandboxConfig['command'] | '' => {
    if (commandExists.sync('docker')) {
      return 'docker';
    }
    if (commandExists.sync('podman')) {
      return 'podman';
    }
    if (os.platform() === 'darwin' && commandExists.sync('sandbox-exec')) {
      return 'sandbox-exec';
    }
    return '';
  };

  if (engine && engine !== 'auto') {
    if (engine === 'sandbox-exec') {
      if (os.platform() === 'darwin' && commandExists.sync('sandbox-exec')) {
        return 'sandbox-exec';
      }
      return pickFallback();
    }
    if (engine === 'docker' || engine === 'podman') {
      if (commandExists.sync(engine)) {
        return engine;
      }
      return pickFallback();
    }
  }

  if (baseCommand) {
    return baseCommand;
  }

  // Don't auto-enable sandbox - require explicit opt-in
  return '';
}

function applyProfileEnvironment(
  profile: SandboxProfile,
): Record<string, string> {
  const env: Record<string, string> = {};

  if (profile.env) {
    for (const [key, value] of Object.entries(profile.env)) {
      env[key] = value;
    }
  }

  if (profile.network) {
    env.LLXPRT_SANDBOX_NETWORK = profile.network;
  }

  if (profile.sshAgent) {
    env.LLXPRT_SANDBOX_SSH_AGENT = profile.sshAgent;
  }

  if (profile.resources?.cpus !== undefined) {
    env.LLXPRT_SANDBOX_CPUS = String(profile.resources.cpus);
  }

  if (profile.resources?.memory !== undefined) {
    env.LLXPRT_SANDBOX_MEMORY = profile.resources.memory;
  }

  if (profile.resources?.pids !== undefined) {
    env.LLXPRT_SANDBOX_PIDS = String(profile.resources.pids);
  }

  if (profile.mounts && profile.mounts.length > 0) {
    const mountsValue = profile.mounts
      .map((mount) => {
        const target = mount.to ?? mount.from;
        const mode = mount.mode ?? 'ro';
        return `${mount.from}:${target}:${mode}`;
      })
      .join(',');
    env.SANDBOX_MOUNTS = mountsValue;
    env.LLXPRT_SANDBOX_MOUNTS = mountsValue;
  }

  return env;
}

function applySandboxProfileEnv(profile: SandboxProfile | undefined): void {
  if (!profile) {
    return;
  }
  const env = applyProfileEnvironment(profile);
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  // Preserve backward-compatible env vars used by the sandbox launcher while
  // ensuring the profile's explicit choices win over ambient env.
  if (profile.network) {
    process.env.SANDBOX_NETWORK = profile.network;
  }

  if (profile.sshAgent) {
    process.env.SANDBOX_SSH_AGENT = profile.sshAgent;
  }

  if (profile.resources?.cpus !== undefined) {
    process.env.SANDBOX_CPUS = String(profile.resources.cpus);
  }

  if (profile.resources?.memory !== undefined) {
    process.env.SANDBOX_MEMORY = profile.resources.memory;
  }

  if (profile.resources?.pids !== undefined) {
    process.env.SANDBOX_PIDS = String(profile.resources.pids);
  }
}

function resolveSandboxImage(
  packageImage: string | undefined,
  profile: SandboxProfile | undefined,
  argvImage?: string,
): string | undefined {
  return (
    argvImage ??
    profile?.image ??
    process.env.LLXPRT_SANDBOX_IMAGE ??
    packageImage
  );
}

function resolveSandboxProfileName(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeProfileName(profileName: string): string {
  return profileName.replace(/\.json$/i, '');
}

export async function loadSandboxConfig(
  settings: Settings,
  argv: SandboxCliArgs,
): Promise<SandboxConfig | undefined> {
  const cliEngine = normalizeEngineInput(argv.sandboxEngine);
  if (cliEngine === 'none') {
    return undefined;
  }

  const packageJson = await getPackageJson(__dirname);
  const packageImage = packageJson?.config?.sandboxImageUri;

  let sandboxProfile: SandboxProfile | undefined;
  const profileName = resolveSandboxProfileName(argv.sandboxProfileLoad);
  if (profileName) {
    await ensureDefaultSandboxProfiles(packageImage);
    try {
      sandboxProfile = normalizeSandboxProfile(
        await loadSandboxProfile(normalizeProfileName(profileName)),
      );
    } catch (error) {
      throw new FatalSandboxError(
        `Failed to load sandbox profile '${profileName}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const sandboxOption = argv.sandbox ?? settings.sandbox;
  let baseCommand: SandboxConfig['command'] | '' = '';
  try {
    baseCommand = getSandboxCommand(sandboxOption);
  } catch (error) {
    // If the user is driving sandbox selection via --sandbox-engine or a profile engine,
    // allow sandboxOption parsing to fail without aborting.
    if (!cliEngine && !sandboxProfile?.engine) {
      throw error;
    }
  }

  // Loading a sandbox profile implies sandboxing intent, even if --sandbox isn't set.
  if (!baseCommand && sandboxProfile) {
    baseCommand = commandExists.sync('docker')
      ? 'docker'
      : commandExists.sync('podman')
        ? 'podman'
        : os.platform() === 'darwin' && commandExists.sync('sandbox-exec')
          ? 'sandbox-exec'
          : '';
  }

  const command = resolveSandboxEngine(
    cliEngine ?? sandboxProfile?.engine,
    baseCommand,
  );

  if (!command) {
    return undefined;
  }

  const image = resolveSandboxImage(
    packageImage,
    sandboxProfile,
    argv.sandboxImage,
  );

  if (!image) {
    return undefined;
  }

  applySandboxProfileEnv(sandboxProfile);

  return { command, image };
}
