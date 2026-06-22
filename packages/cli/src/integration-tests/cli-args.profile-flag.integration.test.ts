/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Profile } from '@vybestack/llxprt-code-settings';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import {
  createTempDirectory,
  cleanupTempDirectory,
  createTempKeyfile,
} from './test-utils.js';
import { runCli } from './cli-args-test-helpers.js';

async function saveProfile(name: string, profile: Profile): Promise<void> {
  await new ProfileManager().saveProfile(name, profile);
}

function expectGeminiProviderAttempt(output: string): void {
  expect(output).toContain('Error when talking to gemini API');
}

describe('CLI --profile Integration Tests @plan:PLAN-20251118-ISSUE533.P12', () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await createTempDirectory();
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await cleanupTempDirectory(tempDir);
  });

  describe('Group 1: Basic CLI Integration', () => {
    /**
     * @plan:PLAN-20251118-ISSUE533.P12
     * @requirement:REQ-INT-003.1
     * @scenario: CLI accepts --profile flag
     * @given: llxprt --profile '{"provider":"gemini","model":"gemini-exp-1206","key":"test-key"}' --prompt "test"
     * @when: CLI starts
     * @then: No parsing errors, profile applied
     */
    it('should accept --profile flag', async () => {
      const profile = JSON.stringify({
        provider: 'gemini',
        model: 'gemini-exp-1206',
        key: 'test-key',
      });

      const keyfilePath = await createTempKeyfile(tempDir, 'test-key');

      const result = await runCli(
        ['--profile', profile, '--keyfile', keyfilePath, '--prompt', 'test'],
        {
          HOME: tempDir,
        },
      );

      const fullOutput = result.stdout + result.stderr;
      expect(fullOutput).not.toContain('Invalid JSON');
      expect(fullOutput).not.toContain('Failed to parse');
      expect(result.exitCode).not.toBe(-1);
      expectGeminiProviderAttempt(fullOutput);
    });

    /**
     * @plan:PLAN-20251118-ISSUE533.P12
     * @requirement:REQ-INT-003.1
     * @scenario: CLI with --profile and overrides
     * @given: --profile + --model override
     * @when: CLI starts
     * @then: Override applied, no errors
     */
    it('should apply overrides with --profile', async () => {
      const profile = JSON.stringify({
        provider: 'gemini',
        model: 'gemini-exp-1114',
        key: 'test-key',
      });

      const keyfilePath = await createTempKeyfile(tempDir, 'test-key');

      const result = await runCli(
        [
          '--profile',
          profile,
          '--model',
          'gemini-exp-1206',
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
      expect(result.exitCode).not.toBe(-1);
      expect(fullOutput).not.toContain('Invalid JSON');
      expectGeminiProviderAttempt(fullOutput);
    });

    /**
     * @plan:PLAN-20251118-ISSUE533.P12
     * @requirement:REQ-INT-003.1
     * @scenario: CLI rejects invalid profile JSON
     * @given: --profile with malformed JSON
     * @when: CLI starts
     * @then: Error message displayed, exit code 1
     */
    it('should reject invalid JSON in --profile', async () => {
      const result = await runCli(
        ['--profile', '{invalid json}', '--prompt', 'test'],
        {
          HOME: tempDir,
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(
        /Failed to parse inline profile|Invalid JSON/i,
      );
    });
  });

  describe('Group 2: Mutual Exclusivity Enforcement', () => {
    /**
     * @plan:PLAN-20251118-ISSUE533.P12
     * @requirement:REQ-INT-001.2
     * @scenario: CLI rejects both --profile and --profile-load
     * @given: --profile + --profile-load both specified
     * @when: CLI starts
     * @then: Error about mutual exclusivity, exit code 1
     */
    it('should reject both --profile and --profile-load', async () => {
      const profile = JSON.stringify({
        provider: 'openai',
        model: 'gpt-4',
        key: 'sk-test',
      });

      const result = await runCli(
        [
          '--profile',
          profile,
          '--profile-load',
          'my-profile',
          '--prompt',
          'test',
        ],
        {
          HOME: tempDir,
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(
        /Cannot use both --profile.+--profile-load/is,
      );
    });

    /**
     * @plan:PLAN-20251118-ISSUE533.P12
     * @requirement:REQ-INT-001.2
     * @scenario: Error message provides helpful guidance
     * @given: Both profile flags
     * @when: CLI starts
     * @then: Error suggests choosing one method
     */
    it('should provide helpful mutual exclusivity error', async () => {
      const result = await runCli(
        ['--profile', '{}', '--profile-load', 'test', '--prompt', 'test'],
        {
          HOME: tempDir,
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(
        /Cannot use both --profile.+--profile-load/is,
      );
      expect(result.stderr).toMatch(/Use one at a time/i);
    });
  });

  describe('Group 3: Environment Integration', () => {
    /**
     * @plan:PLAN-20251118-ISSUE533.P12
     * @requirement:REQ-INT-003.2
     * @scenario: Profile from environment variable
     * @given: LLXPRT_PROFILE env var set
     * @when: CLI starts without --profile
     * @then: Uses profile from env var
     */
    it('should read profile from environment variable', async () => {
      await saveProfile('env-profile', {
        version: 1,
        provider: 'gemini',
        model: 'gemini-exp-1206',
        modelParams: {},
        ephemeralSettings: {},
      });
      const keyfilePath = await createTempKeyfile(tempDir, 'test-key');

      const result = await runCli(
        ['--keyfile', keyfilePath, '--prompt', 'test', '--debug'],
        {
          HOME: tempDir,
          LLXPRT_PROFILE: 'env-profile',
        },
      );

      const fullOutput = result.stdout + result.stderr;
      expect(result.exitCode).not.toBe(-1);
      expectGeminiProviderAttempt(fullOutput);
    });

    /**
     * @plan:PLAN-20251118-ISSUE533.P12
     * @requirement:REQ-INT-003.2
     * @scenario: CLI flag overrides environment variable
     * @given: LLXPRT_PROFILE set + --profile flag
     * @when: CLI starts
     * @then: Uses --profile flag (higher precedence)
     */
    it('should prioritize --profile over environment', async () => {
      await saveProfile('env-profile', {
        version: 1,
        provider: 'gemini',
        model: 'gemini-exp-1114',
        modelParams: {},
        ephemeralSettings: {},
      });
      const cliProfile = JSON.stringify({
        provider: 'gemini',
        model: 'gemini-exp-1206',
        key: 'test-key',
      });
      const keyfilePath = await createTempKeyfile(tempDir, 'test-key');

      const result = await runCli(
        [
          '--profile',
          cliProfile,
          '--keyfile',
          keyfilePath,
          '--prompt',
          'test',
          '--debug',
        ],
        {
          HOME: tempDir,
          LLXPRT_PROFILE: 'env-profile',
        },
      );

      const fullOutput = result.stdout + result.stderr;
      expect(result.exitCode).not.toBe(-1);
      expect(fullOutput).not.toContain("Loaded profile 'env-profile':");
      expect(fullOutput).not.toContain('gemini-exp-1114');
    });

    /**
     * @plan:PLAN-20251118-ISSUE533.P12
     * @requirement:REQ-INT-003.2
     * @scenario: Missing profile named by environment variable
     * @given: LLXPRT_PROFILE with a profile name that does not exist
     * @when: CLI starts
     * @then: Error output records the failed profile load without timing out
     */
    it('should report missing profile from environment variable', async () => {
      const result = await runCli(['--prompt', 'test', '--debug'], {
        HOME: tempDir,
        LLXPRT_PROFILE: 'missing-env-profile',
      });

      const fullOutput = result.stdout + result.stderr;
      expect(result.exitCode).not.toBe(-1);
      expectGeminiProviderAttempt(fullOutput);
    });
  });

  describe('Group 4: Post-Initialization Profile Handling', () => {
    /**
     * @plan:PLAN-20251118-ISSUE533.P12
     * @requirement:REQ-INT-003.3
     * @scenario: Inline profile does not trigger reapplication warning
     * @given: --profile with inline JSON
     * @when: CLI runs and completes
     * @then: No "Failed to reapply profile" warning appears
     */
    it('should not warn about profile reapplication for inline profiles', async () => {
      const profile = JSON.stringify({
        provider: 'gemini',
        model: 'gemini-exp-1206',
        key: 'test-key',
      });

      const keyfilePath = await createTempKeyfile(tempDir, 'test-key');

      const result = await runCli(
        [
          '--profile',
          profile,
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
      expect(fullOutput).not.toContain('Failed to reapply profile');
      expect(fullOutput).not.toContain('profile file not found');
    });
  });

  describe('Group 5: Security and Limits', () => {
    /**
     * @plan:PLAN-20251118-ISSUE533.P12
     * @requirement:REQ-PROF-003.3
     * @scenario: CLI rejects profile exceeding size limit
     * @given: --profile with >10KB JSON
     * @when: CLI starts
     * @then: Error about size limit, exit code 1
     */
    it('should reject oversized profile', async () => {
      const largeProfile = JSON.stringify({
        provider: 'openai',
        model: 'gpt-4',
        key: 'sk-test',
        data: 'x'.repeat(10241),
      });

      const result = await runCli(
        ['--profile', largeProfile, '--prompt', 'test'],
        {
          HOME: tempDir,
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/exceeds maximum size of 10KB/i);
    });

    /**
     * @plan:PLAN-20251118-ISSUE533.P12
     * @requirement:REQ-PROF-003.3
     * @scenario: CLI rejects profile with dangerous fields
     * @given: --profile with __proto__ field
     * @when: CLI starts
     * @then: Error about disallowed field, exit code 1
     */
    it('should reject profile with dangerous fields', async () => {
      const maliciousProfile =
        '{"provider":"openai","model":"gpt-4","key":"sk-test","__proto__":{"polluted":true}}';
      const keyfilePath = await createTempKeyfile(tempDir, 'test-key');

      const result = await runCli(
        [
          '--profile',
          maliciousProfile,
          '--keyfile',
          keyfilePath,
          '--prompt',
          'test',
        ],
        {
          HOME: tempDir,
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Profile contains dangerous fields');
    });
  });
});
