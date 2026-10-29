import { createCapturedSessionOwner } from './session-client-capture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  Config,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { createRuntimeTokenizerFactory } from '../../../../../providers/src/composition/runtimeTokenizerFactory.js';
import { ProviderContentGenerator } from '@vybestack/llxprt-code-providers';
import type {
  RuntimeContentGeneratorFactory,
  ContentGenerator,
} from '@vybestack/llxprt-code-core';
import type { SessionClientOwner } from '../../../session/session-client-owner.js';
import { injectConfirmationForcingPolicy } from '../../confirmationForcing.js';
import { releaseAdoptedFileScope } from '../../adoption-release.js';

export function useConsumerPromptDirectory(): void {
  let directory: string;
  const previous = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'consumer-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = directory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });
}

export function acquireConsumerPolicy(config: Config): RuntimePolicyOwner {
  const policy = new RuntimePolicyOwner(config);
  injectConfirmationForcingPolicy(policy.session.confirmation);
  return policy;
}

export function acquireConsumerRelease(
  settings: SessionSettingsOwner,
  files: ProviderFileLifecycle,
  runtimeId: string,
  sessionId: string,
): AcquisitionRelease {
  const release = new AcquisitionRelease();
  release.acquire('settings', () => settings.dispose());
  for (const scope of [runtimeId, sessionId])
    release.acquire('files', () => releaseAdoptedFileScope(files, scope));
  return release;
}

export function acquireConsumerMedia(
  config: Config,
  maxBytes: number,
): SessionMediaOwner {
  return new SessionMediaOwner(config.projectTempDir, maxBytes);
}

export function selectConsumerTokenizer(
  manager: RuntimeProviderManager,
): ReturnType<typeof createRuntimeTokenizerFactory> {
  const installed = manager.getTokenizerFactory?.();
  const selected = installed ?? createRuntimeTokenizerFactory();
  if (selected !== installed) manager.setTokenizerFactory?.(selected);
  return selected;
}

export function createConsumerContentGenerator(): RuntimeContentGeneratorFactory<ContentGenerator> {
  return { createContentGenerator: () => new ProviderContentGenerator() };
}

export function createConsumerSessionClient(
  config: Config,
  settings: SettingsService,
  manager: Parameters<typeof SessionClientOwner.create>[1]['manager'],
  clientFactory: Parameters<typeof SessionClientOwner.create>[1]['factory'],
  media: Parameters<typeof SessionClientOwner.create>[0]['mediaStore'],
  instructions: Parameters<
    typeof SessionClientOwner.create
  >[0]['readMcpInstructions'],
  workspacePaths: Parameters<
    typeof SessionClientOwner.create
  >[0]['workspacePaths'],
  settingsOwner: SessionSettingsOwner,
  contentGenerator: Parameters<
    typeof SessionClientOwner.create
  >[1]['contentGeneratorFactory'],
  tokenizer: Parameters<
    typeof SessionClientOwner.create
  >[1]['tokenizerFactory'],
): Promise<SessionClientOwner> {
  return createCapturedSessionOwner(
    config,
    assembleTaskSchemaPolicy(settings),
    manager,
    clientFactory,
    media,
    instructions,
    workspacePaths,
    settingsOwner,
    contentGenerator,
    tokenizer,
  );
}
