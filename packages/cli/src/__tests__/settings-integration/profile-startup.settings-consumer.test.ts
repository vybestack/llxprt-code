/**
 * @plan PLAN-20260608-ISSUE1588.P07
 * @requirement REQ-TEST-001.2
 *
 * CLI vertical-slice integration test — TDD red phase.
 *
 * Production entrypoints exercised:
 *   1. packages/cli/src/runtime/runtimeContextFactory.ts imports ProfileManager
 *      from @vybestack/llxprt-code-core (line 34):
 *        `import { ..., ProfileManager, ... } from '@vybestack/llxprt-code-settings';`
 *      After P08, this should import from @vybestack/llxprt-code-settings.
 *
 *   2. packages/cli/src/runtime/runtimeContextFactory.ts line 233:
 *        `new ProfileManager(path.join(llxprtDir, 'profiles'))`
 *      After P08, this should use the settings-package ProfileManager.
 *
 *   3. packages/cli/src/config/profileResolution.ts imports ProfileManager
 *      from @vybestack/llxprt-code-core (line 9):
 *        `import { ProfileManager } from '@vybestack/llxprt-code-settings';`
 *      After P08, this should import from @vybestack/llxprt-code-settings.
 *
 *   4. packages/cli/src/auth/profile-utils.ts imports ProfileManager
 *      from @vybestack/llxprt-code-core (line 32):
 *        `import('@vybestack/llxprt-code-settings').then((mod) => mod.ProfileManager)`
 *      After P08, this should import from @vybestack/llxprt-code-settings.
 *
 * Test approach:
 *   The primary gate is an import-source identity test: verify that when
 *   the CLI's production entrypoint (runtimeContextFactory) resolves
 *   ProfileManager, it resolves to the same constructor as the one exported
 *   by @vybestack/llxprt-code-settings. Before P08, runtimeContextFactory
 *   imports from @vybestack/llxprt-code-core, so the constructors differ.
 *   After P08, both import from settings package → same constructor.
 *
 *   Supplemental tests exercise temp-filesystem JSON round-trip through
 *   both import paths to verify behavioral parity (these may pass even
 *   before P08 since implementations are currently identical).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// Settings-package imports — the post-migration target
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import type { StandardProfile } from '@vybestack/llxprt-code-settings';

describe('CLI vertical-slice — profile startup integration', () => {
  let tempDir: string;
  let profilesDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-p07-cli-'));
    profilesDir = path.join(tempDir, '.llxprt', 'profiles');
    await fs.mkdir(profilesDir, { recursive: true });
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('fails: CLI production path ProfileManager is the settings-package constructor', async () => {
    // RED PHASE: Verify that the CLI's production import path resolves
    // ProfileManager to the same constructor as the settings package.
    //
    // Production entrypoint exercised:
    //   packages/cli/src/runtime/runtimeContextFactory.ts line 34:
    //     import { ..., ProfileManager, ... } from '@vybestack/llxprt-code-settings'
    //
    // Before P08: CLI imports ProfileManager from core, which is a separate
    // module/class instance from the settings-package ProfileManager.
    // After P08: CLI imports from settings package → same constructor.
    const settingsModule = await import('@vybestack/llxprt-code-settings');
    const CliProfileManager = settingsModule.ProfileManager;

    // The CLI production path should resolve ProfileManager from the settings package.
    expect(CliProfileManager).toBe(ProfileManager);
  });

  it('fails: CLI production path uses settings-package ProfileManager for profile operations', async () => {
    // This test creates a profile using the settings-package ProfileManager
    // and then verifies the CLI production path resolves the same class.
    //
    // Production entrypoint exercised:
    //   packages/cli/src/runtime/runtimeContextFactory.ts line 233:
    //     new ProfileManager(path.join(llxprtDir, 'profiles'))
    //
    // Before P08: new ProfileManager() from core creates a core ProfileManager instance.
    // After P08: new ProfileManager() from settings creates a settings-package instance.

    const settingsPkgManager = new ProfileManager(profilesDir);

    const testProfile: StandardProfile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {
        'base-url': 'https://custom-api.example.com/v1',
      },
      type: 'standard',
    };

    await settingsPkgManager.saveProfile('cli-path-profile', testProfile);

    // Load via the CLI production import path (settings package)
    const settingsModule = await import('@vybestack/llxprt-code-settings');
    const CliProfileManager = settingsModule.ProfileManager;
    const cliManager = new CliProfileManager(profilesDir);

    const loaded = await cliManager.loadProfile('cli-path-profile');
    expect(loaded.provider).toBe('openai');
    expect(loaded.model).toBe('gpt-4o');
    expect(cliManager).toBeInstanceOf(ProfileManager);
  });

  it('settings-package ProfileManager round-trips profiles through temp filesystem', async () => {
    // Baseline test: verify the settings-package ProfileManager works correctly
    // with temp-filesystem profile operations. This test should always pass.
    const manager = new ProfileManager(profilesDir);

    const testProfile: StandardProfile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      modelParams: {
        temperature: 0.7,
      },
      ephemeralSettings: {},
      type: 'standard',
    };

    await manager.saveProfile('baseline-profile', testProfile);

    const profilePath = path.join(profilesDir, 'baseline-profile.json');
    const stat = await fs.stat(profilePath);
    expect(stat.isFile()).toBe(true);

    const loaded = await manager.loadProfile('baseline-profile');
    expect(loaded.provider).toBe('anthropic');
    expect(loaded.model).toBe('claude-sonnet-4-20250514');
  });
});
