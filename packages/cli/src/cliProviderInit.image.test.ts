/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  MessageBus,
  CoreEvent,
  coreEvents,
} from '@vybestack/llxprt-code-core';
import {
  ImageProfileNotFoundError,
  ProfileManager,
  SettingsService,
  type StandardProfile,
} from '@vybestack/llxprt-code-settings';
import {
  ProviderManager,
  OpenAIProvider,
} from '@vybestack/llxprt-code-providers';
import {
  OAuthManager,
  createTokenStore,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  setCliRuntimeContext,
  registerCliProviderInfrastructure,
  resetCliProviderInfrastructure,
  getActiveImageProfile,
  loadImageProfileByName,
  applyProfileSnapshot,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import { reapplyBootstrapProfile } from './cliProviderInit.js';
import { applyProfileToRuntime } from './config/profileRuntimeApplication.js';
import type { CliArgs } from './config/cliArgParser.js';

const argv: CliArgs = {
  model: undefined,
  sandbox: undefined,
  sandboxImage: undefined,
  sandboxEngine: undefined,
  sandboxProfileLoad: undefined,
  debug: undefined,
  prompt: undefined,
  promptInteractive: undefined,
  outputFormat: undefined,
  quiet: undefined,
  showMemoryUsage: undefined,
  yolo: undefined,
  approvalMode: undefined,
  telemetry: undefined,
  checkpointing: undefined,
  telemetryLogPrompts: undefined,
  telemetryOutfile: undefined,
  allowedMcpServerNames: undefined,
  allowedTools: undefined,
  experimentalAcp: undefined,
  experimentalUi: undefined,
  extensions: undefined,
  listExtensions: undefined,
  provider: undefined,
  key: undefined,
  keyfile: undefined,
  baseurl: undefined,
  proxy: undefined,
  includeDirectories: undefined,
  profileLoad: 'conversation',
  loadMemoryFromIncludeDirectories: undefined,
  ideMode: undefined,
  screenReader: undefined,
  sessionSummary: undefined,
  dumponerror: undefined,
  promptWords: undefined,
  query: undefined,
  set: undefined,
  continue: undefined,
  nobrowser: undefined,
  listSessions: undefined,
  deleteSession: undefined,
  imageInput: undefined,
  imageOutput: undefined,
  imagePrompt: undefined,
};

function modelProfile(imageProfile?: string): StandardProfile {
  return {
    version: 1,
    type: 'model',
    provider: 'openai',
    model: 'next-model',
    modelParams: {},
    ephemeralSettings: { 'auth-key': 'test-key' },
    ...(imageProfile === undefined ? {} : { imageProfile }),
  };
}

function applyStartup(profile: StandardProfile, inline: boolean) {
  return applyProfileToRuntime({
    loadedProfile: profile,
    profileToLoad: inline ? undefined : 'conversation',
    bootstrapArgs: {
      profileName: null,
      profileJson: inline ? JSON.stringify(profile) : null,
      providerOverride: null,
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
      debug: null,
    },
    argv,
    finalModel: 'old-model',
    finalProvider: 'openai',
    profileWarnings: [],
  });
}

describe('startup image profile transitions', () => {
  let directory: string;
  let manager: ProfileManager;
  let settings: SettingsService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-startup-image-'));
    manager = new ProfileManager(directory);
    settings = new SettingsService();
    const config = new Config({
      sessionId: 'startup-image',
      targetDir: directory,
      cwd: directory,
      debugMode: false,
      model: 'old-model',
      settingsService: settings,
    });
    const providers = new ProviderManager({
      settingsService: settings,
      config,
    });
    providers.registerProvider(new OpenAIProvider('test-key'));
    const messageBus = new MessageBus(config.getPolicyEngine(), false);
    const oauth = new OAuthManager(createTokenStore(), undefined, {
      messageBus,
    });
    setCliRuntimeContext(settings, config, {
      runtimeId: 'startup-image',
      profileManager: manager,
    });
    registerCliProviderInfrastructure(providers, oauth, {
      runtimeId: 'startup-image',
      messageBus,
    });
    await manager.saveImageProfile('art', {
      version: 1,
      type: 'image',
      backend: 'openai-images',
      model: 'local-image',
      baseUrl: 'http://localhost:8321/v1',
      auth: { type: 'none' },
    });
    await manager.saveImageProfile(
      'old-art',
      await manager.loadImageProfile('art'),
    );
    await loadImageProfileByName('old-art');
  });

  afterEach(async () => {
    coreEvents.removeAllListeners(CoreEvent.ModelProfileChanged);
    vi.restoreAllMocks();
    resetCliProviderInfrastructure();
    await rm(directory, { recursive: true, force: true });
  });

  it('rethrows a dangling bootstrap image reference', async () => {
    await manager.saveProfile('conversation', modelProfile('missing-image'));
    await expect(
      reapplyBootstrapProfile(argv, settings),
    ).rejects.toBeInstanceOf(ImageProfileNotFoundError);
  });

  it('warns and continues for a non-image bootstrap failure', async () => {
    const warnings: string[] = [];
    vi.spyOn(debugLogger, 'warn').mockImplementation((message) => {
      warnings.push(String(message));
    });
    await reapplyBootstrapProfile(argv, settings);
    expect(warnings.join('\n')).toContain(
      "Failed to reapply profile 'conversation'",
    );
    expect(settings.getCurrentProfileName()).toBeNull();
  });

  for (const surface of ['file', 'inline', 'direct'] as const) {
    for (const image of ['art', undefined]) {
      it(`commits image selection before publishing on ${surface} (${image ?? 'reset'})`, async () => {
        const observations: Array<{
          model: string;
          image: string | undefined;
        }> = [];
        coreEvents.on(CoreEvent.ModelProfileChanged, (payload) => {
          observations.push({
            model: payload.model,
            image: getActiveImageProfile()?.name,
          });
        });
        const profile = modelProfile(image);
        if (surface === 'direct') await applyProfileSnapshot(profile);
        else await applyStartup(profile, surface === 'inline');
        expect(observations).toStrictEqual([{ model: 'next-model', image }]);
      });
    }

    it(`rejects a dangling reference before publication on ${surface}`, async () => {
      const publications: string[] = [];
      coreEvents.on(CoreEvent.ModelProfileChanged, (payload) => {
        publications.push(payload.model);
      });
      const profile = modelProfile('missing-image');
      const pending =
        surface === 'direct'
          ? applyProfileSnapshot(profile)
          : applyStartup(profile, surface === 'inline');
      await expect(pending).rejects.toBeInstanceOf(ImageProfileNotFoundError);
      expect(publications).toStrictEqual([]);
    });
  }
});
