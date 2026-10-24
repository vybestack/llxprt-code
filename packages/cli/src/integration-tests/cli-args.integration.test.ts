/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'node:path';
import type { Profile } from '@vybestack/llxprt-code-settings';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import {
  createTempDirectory,
  cleanupTempDirectory,
  createTempKeyfile,
} from './test-utils.js';
import { Storage } from '@vybestack/llxprt-code-storage';
import {
  runCli,
  type CliRunResult,
} from './__tests__/cli-args-test-helpers.js';
import { testRegex } from '../__tests__/regex.js';

// Asserts that stdout contains a semantic-version string like "1.2.3".
function expectVersionOutput(stdout: string): void {
  const trimmed = stdout.trim();
  const parts = trimmed.split('.');
  expect(parts.length).toBeGreaterThanOrEqual(3);
  expect(Number(parts[0])).not.toBeNaN();
  expect(Number(parts[1])).not.toBeNaN();
  expect(Number((parts[2] ?? '').split(/\s/)[0] ?? '')).not.toBeNaN();
}

describe('CLI --profile-load Integration Tests', () => {
  let tempDir: string;
  let configHome: string;
  let profileManager: ProfileManager;
  let originalHome: string | undefined;
  let originalConfigHome: string | undefined;

  beforeEach(async () => {
    tempDir = await createTempDirectory();
    configHome = path.join(tempDir, 'config');
    originalHome = process.env.HOME;
    originalConfigHome = process.env.LLXPRT_CONFIG_HOME;
    // LLXPRT_CONFIG_HOME is what steers Storage, and therefore ProfileManager's
    // default directory. HOME does not: the platform paths come from env-paths,
    // which is evaluated once at module load. runCli forwards this variable to
    // the spawned CLI, so both sides see the same profiles.
    process.env.HOME = tempDir;
    process.env.LLXPRT_CONFIG_HOME = configHome;
    profileManager = new ProfileManager(path.join(configHome, 'profiles'));
  });

  afterEach(async () => {
    // Restore original HOME
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalConfigHome === undefined) {
      delete process.env.LLXPRT_CONFIG_HOME;
    } else {
      process.env.LLXPRT_CONFIG_HOME = originalConfigHome;
    }
    await cleanupTempDirectory(tempDir);
  });

  describe('Basic Profile Loading', () => {
    it('should load a profile and apply its settings', async () => {
      // Create a test profile
      const profile: Profile = {
        version: 1,
        provider: 'gemini', // Use the default provider
        model: 'gemini-exp-1206',
        modelParams: {
          temperature: 0.5,
          max_tokens: 2000,
        },
        ephemeralSettings: {},
      };

      await profileManager.saveProfile('test-profile', profile);

      // Create a fake API key file
      const keyfilePath = await createTempKeyfile(tempDir, 'test-api-key-123');

      const result = await runCli(
        [
          '--profile-load',
          'test-profile',
          '--keyfile',
          keyfilePath,
          '--prompt',
          'test prompt',
          '--debug', // Enable debug mode to see profile loading messages
        ],
        {
          HOME: tempDir,
        },
      );

      expect(result.exitCode).not.toBe(-1);
      expect(result.stdout + result.stderr).toContain(
        'Error when talking to gemini API',
      );
    });

    it('should error when non-existent profile is explicitly specified', async () => {
      // Create a keyfile so it doesn't hang on auth
      const keyfilePath = await createTempKeyfile(tempDir, 'test-key');

      const result = await runCli(
        [
          '--profile-load',
          'non-existent-profile',
          '--keyfile',
          keyfilePath,
          '--prompt',
          'test prompt',
          '--debug', // Enable debug to see error messages
        ],
        {
          HOME: tempDir,
        },
      );

      // Should log error and exit with non-zero code
      const fullOutput = result.stdout + result.stderr;
      expect(fullOutput).toContain("Profile 'non-existent-profile' not found");
      // Should exit with error code 1 when profile fails to load
      expect(result.exitCode).toBe(1);
    });

    it('should error when invalid profile format is explicitly specified', async () => {
      // Create an invalid profile file
      const profilesDir = path.join(Storage.getGlobalConfigDir(), 'profiles');
      await fs.mkdir(profilesDir, { recursive: true });
      await fs.writeFile(
        path.join(profilesDir, 'invalid-profile.json'),
        '{ invalid json',
        'utf8',
      );

      const result = await runCli(
        ['--profile-load', 'invalid-profile', '--prompt', 'test prompt'],
        {
          HOME: tempDir,
        },
      );

      const fullOutput = result.stdout + result.stderr;
      expect(fullOutput).toContain("Profile 'invalid-profile' is corrupted");
      // Should exit with error code 1 when profile is corrupted
      expect(result.exitCode).toBe(1);
    });
  });

  describe('CLI Argument Precedence', () => {
    it('should allow --model to override profile model', async () => {
      const profile: Profile = {
        version: 1,
        provider: 'gemini',
        model: 'gemini-exp-1206',
        modelParams: {},
        ephemeralSettings: {},
      };

      await profileManager.saveProfile('test-profile', profile);
      const keyfilePath = await createTempKeyfile(tempDir, 'test-api-key');

      const result = await runCli(
        [
          '--profile-load',
          'test-profile',
          '--model',
          'gemini-exp-1114',
          '--keyfile',
          keyfilePath,
          '--prompt',
          'test',
          '--debug',
        ],
        {
          HOME: tempDir,
        },
      );

      expect(result.stdout + result.stderr).toContain(
        'Error when talking to gemini API',
      );
    });

    it('should allow --key to override profile auth', async () => {
      const profile: Profile = {
        version: 1,
        provider: 'gemini',
        model: 'gemini-exp-1206',
        modelParams: {},
        ephemeralSettings: {},
      };

      await profileManager.saveProfile('test-profile', profile);

      const result = await runCli(
        [
          '--profile-load',
          'test-profile',
          '--key',
          'override-key-123',
          '--prompt',
          'test',
          '--debug',
        ],
        {
          HOME: tempDir,
        },
      );

      // Profile should be loaded
      expect(result.stdout + result.stderr).toContain(
        'Error when talking to gemini API',
      );
      // The key should be used (we can't directly verify it but the CLI should attempt to use it)
      expect(result.exitCode).toBeDefined();
    });

    it('should override profile keyfile with CLI keyfile', async () => {
      // Create profile with one keyfile
      const profileKeyfilePath = await createTempKeyfile(
        tempDir,
        'profile-key-123',
      );
      const profile: Profile = {
        version: 1,
        provider: 'gemini',
        model: 'gemini-exp-1206',
        modelParams: {},
        ephemeralSettings: {
          'auth-keyfile': profileKeyfilePath,
        },
      };

      await profileManager.saveProfile('keyfile-profile', profile);

      // Create a different keyfile for CLI override
      const cliKeyfilePath = await createTempKeyfile(tempDir, 'cli-key-456');

      const result = await runCli(
        [
          '--profile-load',
          'keyfile-profile',
          '--keyfile',
          cliKeyfilePath,
          '--prompt',
          'test',
          '--debug',
        ],
        {
          HOME: tempDir,
        },
      );

      const fullOutput = result.stdout + result.stderr;
      expect(fullOutput).toContain('Error when talking to gemini API');
      expect(fullOutput).not.toContain('profile-key-123');
    });

    it('should process --set arguments at startup and override profile settings', async () => {
      const profile: Profile = {
        version: 1,
        provider: 'gemini',
        model: 'gemini-exp-1206',
        modelParams: {},
        ephemeralSettings: {
          'context-limit': 50000,
        },
      };

      await profileManager.saveProfile('set-profile', profile);
      const keyfilePath = await createTempKeyfile(tempDir, 'test-key');

      const result = await runCli(
        [
          '--profile-load',
          'set-profile',
          '--set',
          'context-limit=100000',
          '--keyfile',
          keyfilePath,
          '--prompt',
          'test',
          '--debug',
        ],
        {
          HOME: tempDir,
        },
      );

      expect(result.stdout + result.stderr).toContain(
        'Error when talking to gemini API',
      );
      expect(result.exitCode).not.toBe(-1);
    });

    it('should apply CLI args after profile load but before provider switch', async () => {
      // This test ensures the timing is correct: CLI args override profile settings
      const profileKeyfilePath = await createTempKeyfile(
        tempDir,
        'profile-auth',
      );
      const profile: Profile = {
        version: 1,
        provider: 'gemini',
        model: 'gemini-exp-1206',
        modelParams: {},
        ephemeralSettings: {
          'auth-keyfile': profileKeyfilePath,
          'base-url': 'https://profile-base-url.example.com',
        },
      };

      await profileManager.saveProfile('timing-test', profile);

      // Override with CLI args
      const cliKeyfilePath = await createTempKeyfile(tempDir, 'cli-auth');

      const result = await runCli(
        [
          '--profile-load',
          'timing-test',
          '--keyfile',
          cliKeyfilePath,
          '--baseurl',
          'https://cli-base-url.example.com',
          '--set',
          'context-limit=200000',
          // The unresolvable host fails with ENOTFOUND, which the provider
          // retry policy treats as transient (Bun 1.4 reports it as Node does;
          // Bun 1.3 reported a non-retried connect error). One attempt keeps the
          // run well inside the spawned-CLI guard without changing what is
          // asserted.
          '--set',
          'retries=1',
          '--prompt',
          'test',
          '--debug',
        ],
        {
          HOME: tempDir,
        },
      );

      const fullOutput = result.stdout + result.stderr;
      // Issue #2231: the error names the resolved endpoint, which also
      // proves the CLI --baseurl won over the profile base-url.
      expect(fullOutput).toContain(
        'Error when talking to gemini (endpoint: https://cli-base-url.example.com)',
      );
      expect(fullOutput).not.toContain('profile-auth');
      expect(fullOutput).not.toContain('profile-base-url.example.com');
    });
  });

  describe('Profile with Auth Credentials', () => {
    it('should load profile with embedded auth info', async () => {
      const profile: Profile = {
        version: 1,
        provider: 'gemini',
        model: 'gemini-exp-1206',
        modelParams: {
          temperature: 0.7,
        },
        ephemeralSettings: {
          // Auth credentials would typically be stored securely
          // For testing, we'll use a keyfile reference
        },
      };

      await profileManager.saveProfile('auth-profile', profile);
      const keyfilePath = await createTempKeyfile(tempDir, 'secure-api-key');

      const result = await runCli(
        [
          '--profile-load',
          'auth-profile',
          '--keyfile',
          keyfilePath,
          '--prompt',
          'test',
          '--debug',
        ],
        {
          HOME: tempDir,
        },
      );

      const fullOutput = result.stdout + result.stderr;
      expect(fullOutput).toContain('Error when talking to gemini API');
      expect(fullOutput).not.toContain('secure-api-key');
    });
  });

  describe('Profile with Model Parameters', () => {
    it('should apply model parameters from profile', async () => {
      const profile: Profile = {
        version: 1,
        provider: 'gemini',
        model: 'gemini-exp-1206',
        modelParams: {
          temperature: 0.2,
          max_tokens: 1500,
          topP: 0.9,
        },
        ephemeralSettings: {},
      };

      await profileManager.saveProfile('params-profile', profile);
      const keyfilePath = await createTempKeyfile(tempDir, 'test-key');

      const result = await runCli(
        [
          '--profile-load',
          'params-profile',
          '--keyfile',
          keyfilePath,
          '--prompt',
          'test with params',
          '--debug',
        ],
        {
          HOME: tempDir,
        },
      );

      expect(result.stdout + result.stderr).toContain(
        'Error when talking to gemini API',
      );
      // The model params should be applied internally
      // We can't directly verify them from output, but the profile should be loaded
    });
  });

  describe('Multiple Profiles', () => {
    it('should load the correct profile when multiple exist', async () => {
      // Create multiple profiles
      const profile1: Profile = {
        version: 1,
        provider: 'gemini',
        model: 'gemini-exp-1114',
        modelParams: {},
        ephemeralSettings: {},
      };

      const profile2: Profile = {
        version: 1,
        provider: 'gemini',
        model: 'gemini-exp-1206',
        modelParams: {},
        ephemeralSettings: {},
      };

      await profileManager.saveProfile('profile1', profile1);
      await profileManager.saveProfile('profile2', profile2);

      const keyfilePath = await createTempKeyfile(tempDir, 'test-key');

      // Load profile2
      const result = await runCli(
        [
          '--profile-load',
          'profile2',
          '--keyfile',
          keyfilePath,
          '--prompt',
          'test',
          '--debug',
        ],
        {
          HOME: tempDir,
        },
      );

      expect(result.stdout + result.stderr).toContain(
        'Error when talking to gemini API',
      );
    });
  });

  describe('CI Environment', () => {
    it('should not open browser windows in CI environment', async () => {
      // Test without any auth - should fail but not open browser
      const result = await runCli(
        ['--prompt', 'test without auth', '--debug'],
        {
          HOME: tempDir,
          CI: 'true',
          LLXPRT_NO_BROWSER_AUTH: 'true',
          // Additional env vars to prevent browser auth
          GITHUB_ACTIONS: 'true',
          DISPLAY: '', // No display available
        },
      );

      // Should fail due to no auth, but should complete within timeout
      expect(result.exitCode).not.toBe(-1); // -1 means timeout
      const fullOutput = result.stdout + result.stderr;
      // Should show auth error but not browser-related messages
      expect(fullOutput.toLowerCase()).not.toMatch(
        testRegex('(?:opening|browser).*(?:browser|auth)', 'i'),
      );
    });
  });

  describe('Error Cases', () => {
    it('should handle missing profile version', async () => {
      // Create profile without version
      const profilesDir = path.join(Storage.getGlobalConfigDir(), 'profiles');
      await fs.mkdir(profilesDir, { recursive: true });
      await fs.writeFile(
        path.join(profilesDir, 'no-version.json'),
        JSON.stringify({
          provider: 'gemini',
          model: 'gemini-exp-1206',
          modelParams: {},
          ephemeralSettings: {},
        }),
        'utf8',
      );

      const result = await runCli(
        ['--profile-load', 'no-version', '--prompt', 'test'],
        {
          HOME: tempDir,
        },
      );

      const fullOutput = result.stdout + result.stderr;
      expect(fullOutput).toContain(
        "Profile 'no-version' is invalid: missing required fields",
      );
    });

    it('should handle unsupported profile version', async () => {
      // Create profile with unsupported version
      const profilesDir = path.join(Storage.getGlobalConfigDir(), 'profiles');
      await fs.mkdir(profilesDir, { recursive: true });
      await fs.writeFile(
        path.join(profilesDir, 'bad-version.json'),
        JSON.stringify({
          version: 2, // Unsupported version
          provider: 'gemini',
          model: 'gemini-exp-1206',
          modelParams: {},
          ephemeralSettings: {},
        }),
        'utf8',
      );

      const result = await runCli(
        ['--profile-load', 'bad-version', '--prompt', 'test'],
        {
          HOME: tempDir,
        },
      );

      const fullOutput = result.stdout + result.stderr;
      expect(fullOutput).toContain('unsupported profile version');
    });
  });
});

const INVALID_SETTINGS_FIXTURE = JSON.stringify({
  telemetry: { logConversations: true },
});

/**
 * Writes the invalid-settings fixture below an explicitly named config
 * directory (issue #3581). The directory is always passed in, never resolved
 * from the ambient environment, so the write cannot reach a real config dir.
 */
async function writeInvalidSettingsFixture(configDir: string): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, 'settings.json'),
    INVALID_SETTINGS_FIXTURE,
  );
}

describe('CLI --version and --help flags', () => {
  let tempDir: string;
  let configHome: string;
  let originalHome: string | undefined;
  let originalConfigHome: string | undefined;

  beforeEach(async () => {
    tempDir = await createTempDirectory();
    configHome = path.join(tempDir, 'config-home');
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
    // Point Storage at a per-test config root (issue #3581) so any code in the
    // test process that resolves the global config dir lands in the temp dir.
    // The invalid-settings.json cases below do not depend on this: they write
    // the fixture to `configHome` explicitly and hand the same directory to
    // the spawned CLI.
    originalConfigHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = configHome;
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    if (originalConfigHome !== undefined) {
      process.env.LLXPRT_CONFIG_HOME = originalConfigHome;
    } else {
      delete process.env.LLXPRT_CONFIG_HOME;
    }
    await cleanupTempDirectory(tempDir);
  });

  it('should print version with --version flag', async () => {
    const result = await runCli(['--version'], { HOME: tempDir });
    expect(result.exitCode).toBe(0);
    expectVersionOutput(result.stdout);
  });

  it('should print version with -v flag', async () => {
    const result = await runCli(['-v'], { HOME: tempDir });
    expect(result.exitCode).toBe(0);
    expectVersionOutput(result.stdout);
  });

  it('should print help with --help flag', async () => {
    const result = await runCli(['--help'], { HOME: tempDir });
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain('llxprt');
    expect(output).toContain('--version');
    expect(output).toContain('--help');
    expect(output).not.toContain('--telemetry-target');
    expect(output).not.toContain('--telemetry-otlp-endpoint');
    expect(output).not.toContain('--telemetry-otlp-protocol');
    expect(output).toContain('--telemetry-outfile');
  });

  it('should print help with -h flag', async () => {
    const result = await runCli(['-h'], { HOME: tempDir });
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain('llxprt');
    expect(output).toContain('--version');
    expect(output).toContain('--help');
  });

  it('should print help even with invalid settings.json (--help)', async () => {
    // Write an invalid settings file with an unrecognized key
    await writeInvalidSettingsFixture(configHome);

    const result = await runCli(['--help'], {
      HOME: tempDir,
      LLXPRT_CONFIG_HOME: configHome,
    });
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain('llxprt');
    expect(output).toContain('--version');
    expect(output).toContain('--help');
    // Should NOT contain config error messages
    expect(output).not.toContain('Invalid configuration');
  });

  it('should show config error (not silently fail) with invalid settings.json and no args', async () => {
    // Write an invalid settings file with an unrecognized key
    await writeInvalidSettingsFixture(configHome);

    const result = await runCli([], {
      HOME: tempDir,
      LLXPRT_CONFIG_HOME: configHome,
    });
    // Should exit with non-zero exit code
    expect(result.exitCode).not.toBe(0);
    const output = result.stdout + result.stderr;
    // Should contain the config error, not silently fail
    expect(output).toContain('Invalid configuration');
  });

  describe('invalid settings fixtures vs ambient LLXPRT_CONFIG_HOME', () => {
    const SENTINEL_SETTINGS = '{ }\n';
    let envAtStart: { home?: string; configHome?: string };

    beforeAll(() => {
      envAtStart = {
        home: process.env.HOME,
        configHome: process.env.LLXPRT_CONFIG_HOME,
      };
    });

    afterAll(() => {
      // The enclosing afterEach has run for every case by now. Throwing keeps
      // this a hook failure rather than an assertion outside a test block.
      if (process.env.HOME !== envAtStart.home) {
        throw new Error(`HOME not restored: ${process.env.HOME}`);
      }
      if (process.env.LLXPRT_CONFIG_HOME !== envAtStart.configHome) {
        throw new Error(
          `LLXPRT_CONFIG_HOME not restored: ${process.env.LLXPRT_CONFIG_HOME}`,
        );
      }
    });

    // The enclosing afterEach restores the original value; the afterAll above
    // verifies that it did.
    function setAmbientConfigHome(ambient: string | undefined): void {
      if (ambient === undefined) {
        delete process.env.LLXPRT_CONFIG_HOME;
      } else {
        process.env.LLXPRT_CONFIG_HOME = ambient;
      }
    }

    async function runInvalidSettingsFlows(): Promise<{
      help: CliRunResult;
      bare: CliRunResult;
    }> {
      await writeInvalidSettingsFixture(configHome);
      const env = { HOME: tempDir, LLXPRT_CONFIG_HOME: configHome };
      const help = await runCli(['--help'], env);
      const bare = await runCli([], env);
      return { help, bare };
    }

    function expectInvalidSettingsOutcome(flows: {
      help: CliRunResult;
      bare: CliRunResult;
    }): void {
      expect(flows.help.exitCode).toBe(0);
      const helpOutput = flows.help.stdout + flows.help.stderr;
      expect(helpOutput).toContain('--help');
      expect(helpOutput).not.toContain('Invalid configuration');
      expect(flows.bare.exitCode).not.toBe(0);
      expect(flows.bare.stdout + flows.bare.stderr).toContain(
        'Invalid configuration',
      );
    }

    it('leaves ambient settings.json byte-for-byte untouched and uses the test config dir', async () => {
      const ambientRoot = path.join(tempDir, 'ambient-config');
      const ambientSettings = path.join(ambientRoot, 'settings.json');
      await fs.mkdir(ambientRoot, { recursive: true });
      await fs.writeFile(ambientSettings, SENTINEL_SETTINGS);
      setAmbientConfigHome(ambientRoot);

      const flows = await runInvalidSettingsFlows();

      expect(await fs.readFile(ambientSettings, 'utf8')).toBe(
        SENTINEL_SETTINGS,
      );
      expect(
        await fs.readFile(path.join(configHome, 'settings.json'), 'utf8'),
      ).toBe(INVALID_SETTINGS_FIXTURE);
      expectInvalidSettingsOutcome(flows);
    });

    it('works when the ambient LLXPRT_CONFIG_HOME is unset', async () => {
      setAmbientConfigHome(undefined);

      const flows = await runInvalidSettingsFlows();

      expect(
        await fs.readFile(path.join(configHome, 'settings.json'), 'utf8'),
      ).toBe(INVALID_SETTINGS_FIXTURE);
      expectInvalidSettingsOutcome(flows);
    });
  });
});

/**
 * @plan PLAN-20251118-ISSUE533.P12
 * CLI Integration Tests for --profile flag (inline JSON profiles)
 */
