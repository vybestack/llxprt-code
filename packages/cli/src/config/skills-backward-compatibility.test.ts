/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { loadCliConfig } from './config.js';
import { parseArguments } from './cliArgParser.js';
import { isWorkspaceTrusted } from './trustedFolders.js';
import { loadServerHierarchicalMemory } from '@vybestack/llxprt-code-core';
import { type Settings, createTestMergedSettings } from './settings.js';
import { ExtensionStorage } from './extension.js';
import { ExtensionEnablementManager } from './extensions/extensionEnablement.js';

const actual = { ...(await import('./trustedFolders.js')) };
vi.mock('./trustedFolders.js', () => {
  return {
    ...actual,
    isWorkspaceTrusted: vi.fn().mockReturnValue(true),
    isFolderTrustEnabled: vi.fn().mockReturnValue(false),
  };
});

const actualActual = { ...(await import('@vybestack/llxprt-code-core')) };
vi.mock('@vybestack/llxprt-code-core', () => {
  return {
    ...actualActual,
    loadServerHierarchicalMemory: vi.fn(),
  };
});

async function buildConfig(
  settings: ReturnType<typeof createTestMergedSettings>,
) {
  process.argv = ['node', 'llxprt'];
  const argv = await parseArguments(settings);
  return loadCliConfig(
    settings,
    [],
    new ExtensionEnablementManager(
      ExtensionStorage.getUserExtensionsDir(),
      argv.extensions,
    ),
    'test-session',
    argv,
  );
}

describe('Agent Skills Backward Compatibility', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    (
      loadServerHierarchicalMemory as Mock<typeof loadServerHierarchicalMemory>
    ).mockResolvedValue({
      memoryContent: '',
      fileCount: 0,
      filePaths: [],
    });
    (isWorkspaceTrusted as Mock<typeof isWorkspaceTrusted>).mockReturnValue(
      true,
    );
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('should default skillsSupport to true when no settings are present', async () => {
    const settings = createTestMergedSettings({});
    const config = await buildConfig(settings);
    expect(
      (
        config as unknown as { isSkillsSupportEnabled: () => boolean }
      ).isSkillsSupportEnabled(),
    ).toBe(true);
  });

  it('should prioritize skills.enabled=false from settings', async () => {
    const settings = createTestMergedSettings({
      skills: { enabled: false },
    } as unknown as Settings);
    const config = await buildConfig(settings);
    expect(
      (
        config as unknown as { isSkillsSupportEnabled: () => boolean }
      ).isSkillsSupportEnabled(),
    ).toBe(false);
  });

  it('should support legacy experimental.skills=true from settings', async () => {
    const settings = createTestMergedSettings({
      experimental: { skills: true },
    } as unknown as Settings);
    const config = await buildConfig(settings);
    expect(
      (
        config as unknown as { isSkillsSupportEnabled: () => boolean }
      ).isSkillsSupportEnabled(),
    ).toBe(true);
  });

  it('should prioritize legacy experimental.skills=true over new skills.enabled=false', async () => {
    const settings = createTestMergedSettings({
      skills: { enabled: false },
      experimental: { skills: true },
    } as unknown as Settings);
    const config = await buildConfig(settings);
    expect(
      (
        config as unknown as { isSkillsSupportEnabled: () => boolean }
      ).isSkillsSupportEnabled(),
    ).toBe(true);
  });

  it('should still be enabled by default if legacy experimental.skills is false (since new default is true)', async () => {
    const settings = createTestMergedSettings({
      experimental: { skills: false },
    } as unknown as Settings);
    const config = await buildConfig(settings);
    expect(
      (
        config as unknown as { isSkillsSupportEnabled: () => boolean }
      ).isSkillsSupportEnabled(),
    ).toBe(true);
  });
});
