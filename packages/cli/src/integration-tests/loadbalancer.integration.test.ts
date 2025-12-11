/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { Profile, LoadBalancerProfile } from '@vybestack/llxprt-code-core';
import {
  createTempDirectory,
  cleanupTempDirectory,
  createTempKeyfile,
} from './test-utils.js';

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(
  args: string[],
  env: Record<string, string> = {},
  input?: string,
): Promise<CliResult> {
  return new Promise((resolve) => {
    const cliPath = path.join(process.cwd(), 'dist', 'index.js');

    const child = spawn('node', [cliPath, ...args], {
      env: {
        ...process.env,
        ...env,
        LLXPRT_TELEMETRY: 'false',
        LLXPRT_CLI_NO_RELAUNCH: 'true',
        HOME: env.HOME || process.env.HOME,
        NODE_ENV: 'production',
        LLXPRT_NO_BROWSER_AUTH: 'true',
        CI: 'true',
      },
      cwd: process.cwd(),
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    if (input) {
      child.stdin.write(input);
      child.stdin.end();
    }

    const timeout = setTimeout(() => {
      child.kill();
      resolve({
        stdout,
        stderr,
        exitCode: -1,
      });
    }, 10000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      });
    });
  });
}

describe('LoadBalancer Integration Tests', () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await createTempDirectory();
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    if (originalHome) {
      process.env.HOME = originalHome;
    }
    await cleanupTempDirectory(tempDir);
  });

  describe('LoadBalancer Profile via --profile-load', () => {
    it('should accept LoadBalancer profile from disk', async () => {
      const profile1: Profile = {
        version: 1,
        type: 'standard',
        provider: 'gemini',
        model: 'gemini-exp-1206',
        modelParams: {},
        ephemeralSettings: {},
      };

      const profile2: Profile = {
        version: 1,
        type: 'standard',
        provider: 'gemini',
        model: 'gemini-exp-1114',
        modelParams: {},
        ephemeralSettings: {},
      };

      const profilesDir = path.join(tempDir, '.llxprt', 'profiles');
      await fs.mkdir(profilesDir, { recursive: true });

      await fs.writeFile(
        path.join(profilesDir, 'test-profile1.json'),
        JSON.stringify(profile1, null, 2),
        'utf8',
      );

      await fs.writeFile(
        path.join(profilesDir, 'test-profile2.json'),
        JSON.stringify(profile2, null, 2),
        'utf8',
      );

      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['test-profile1', 'test-profile2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      await fs.writeFile(
        path.join(profilesDir, 'lb-profile.json'),
        JSON.stringify(lbProfile, null, 2),
        'utf8',
      );

      const keyfilePath = await createTempKeyfile(tempDir, 'test-api-key-123');

      const result = await runCli(
        [
          '--profile-load',
          'lb-profile',
          '--keyfile',
          keyfilePath,
          '--prompt',
          'test prompt',
          '--debug',
        ],
        {
          HOME: tempDir,
        },
      );

      expect(result.exitCode).not.toBe(-1);

      const fullOutput = result.stdout + result.stderr;
      expect(fullOutput).toMatch(
        /Loaded profile.*lb-profile|Loading profile.*lb-profile/i,
      );
    });

    it('should handle missing referenced profiles', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['nonexistent1', 'nonexistent2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const profilesDir = path.join(tempDir, '.llxprt', 'profiles');
      await fs.mkdir(profilesDir, { recursive: true });

      await fs.writeFile(
        path.join(profilesDir, 'lb-missing.json'),
        JSON.stringify(lbProfile, null, 2),
        'utf8',
      );

      const keyfilePath = await createTempKeyfile(tempDir, 'test-key');

      const result = await runCli(
        [
          '--profile-load',
          'lb-missing',
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

      expect(result.exitCode).not.toBe(-1);

      const fullOutput = result.stdout + result.stderr;
      expect(fullOutput).toMatch(/profile.*not found|failed.*load/i);
    });

    it('should handle empty profiles list', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: [],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const profilesDir = path.join(tempDir, '.llxprt', 'profiles');
      await fs.mkdir(profilesDir, { recursive: true });

      await fs.writeFile(
        path.join(profilesDir, 'lb-empty.json'),
        JSON.stringify(lbProfile, null, 2),
        'utf8',
      );

      const keyfilePath = await createTempKeyfile(tempDir, 'test-key');

      const result = await runCli(
        [
          '--profile-load',
          'lb-empty',
          '--keyfile',
          keyfilePath,
          '--prompt',
          'test',
        ],
        {
          HOME: tempDir,
        },
      );

      expect(result.exitCode).not.toBe(-1);

      const fullOutput = result.stdout + result.stderr;
      expect(fullOutput).toMatch(
        /must reference at least one profile|empty.*profiles|no profiles/i,
      );
    });
  });

  describe('LoadBalancer Profile via --profile (inline JSON)', () => {
    it('should accept inline LoadBalancer profile JSON', async () => {
      const profile1: Profile = {
        version: 1,
        type: 'standard',
        provider: 'gemini',
        model: 'gemini-exp-1206',
        modelParams: {},
        ephemeralSettings: {},
      };

      const profile2: Profile = {
        version: 1,
        type: 'standard',
        provider: 'gemini',
        model: 'gemini-exp-1114',
        modelParams: {},
        ephemeralSettings: {},
      };

      const profilesDir = path.join(tempDir, '.llxprt', 'profiles');
      await fs.mkdir(profilesDir, { recursive: true });

      await fs.writeFile(
        path.join(profilesDir, 'inline-profile1.json'),
        JSON.stringify(profile1, null, 2),
        'utf8',
      );

      await fs.writeFile(
        path.join(profilesDir, 'inline-profile2.json'),
        JSON.stringify(profile2, null, 2),
        'utf8',
      );

      const lbProfileJson = JSON.stringify({
        type: 'loadbalancer',
        version: 1,
        policy: 'roundrobin',
        profiles: ['inline-profile1', 'inline-profile2'],
      });

      const keyfilePath = await createTempKeyfile(tempDir, 'test-key');

      const result = await runCli(
        [
          '--profile',
          lbProfileJson,
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

      expect(result.exitCode).not.toBe(-1);

      const fullOutput = result.stdout + result.stderr;
      expect(fullOutput).not.toContain('Invalid JSON');
      expect(fullOutput).not.toContain('Failed to parse');
    });

    it('should reject invalid LoadBalancer JSON', async () => {
      const invalidJson = '{type:loadbalancer,profiles:[]}';

      const result = await runCli(
        ['--profile', invalidJson, '--prompt', 'test'],
        {
          HOME: tempDir,
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(
        /Failed to parse inline profile|Invalid JSON/i,
      );
    });

    it('should reject LoadBalancer with unsupported policy', async () => {
      const profile1: Profile = {
        version: 1,
        type: 'standard',
        provider: 'gemini',
        model: 'gemini-exp-1206',
        modelParams: {},
        ephemeralSettings: {},
      };

      const profilesDir = path.join(tempDir, '.llxprt', 'profiles');
      await fs.mkdir(profilesDir, { recursive: true });

      await fs.writeFile(
        path.join(profilesDir, 'policy-profile1.json'),
        JSON.stringify(profile1, null, 2),
        'utf8',
      );

      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['policy-profile1'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      await fs.writeFile(
        path.join(profilesDir, 'lb-policy.json'),
        JSON.stringify(lbProfile, null, 2),
        'utf8',
      );

      const keyfilePath = await createTempKeyfile(tempDir, 'test-key');

      const result = await runCli(
        [
          '--profile-load',
          'lb-policy',
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

      expect(result.exitCode).not.toBe(-1);

      const fullOutput = result.stdout + result.stderr;
      expect(fullOutput).toMatch(/Loaded profile.*lb-policy|policy-profile1/i);
    });
  });

  describe('Round Robin Behavior', () => {
    it('should select profiles in round-robin fashion', async () => {
      const profile1: Profile = {
        version: 1,
        type: 'standard',
        provider: 'gemini',
        model: 'gemini-exp-1206',
        modelParams: {},
        ephemeralSettings: {},
      };

      const profile2: Profile = {
        version: 1,
        type: 'standard',
        provider: 'gemini',
        model: 'gemini-exp-1114',
        modelParams: {},
        ephemeralSettings: {},
      };

      const profilesDir = path.join(tempDir, '.llxprt', 'profiles');
      await fs.mkdir(profilesDir, { recursive: true });

      await fs.writeFile(
        path.join(profilesDir, 'rr-profile1.json'),
        JSON.stringify(profile1, null, 2),
        'utf8',
      );

      await fs.writeFile(
        path.join(profilesDir, 'rr-profile2.json'),
        JSON.stringify(profile2, null, 2),
        'utf8',
      );

      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['rr-profile1', 'rr-profile2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      await fs.writeFile(
        path.join(profilesDir, 'rr-lb.json'),
        JSON.stringify(lbProfile, null, 2),
        'utf8',
      );

      const keyfilePath = await createTempKeyfile(tempDir, 'test-key');

      const result = await runCli(
        [
          '--profile-load',
          'rr-lb',
          '--keyfile',
          keyfilePath,
          '--prompt',
          'test first call',
          '--debug',
        ],
        {
          HOME: tempDir,
        },
      );

      expect(result.exitCode).not.toBe(-1);

      const fullOutput = result.stdout + result.stderr;
      expect(fullOutput).toMatch(/Loaded profile.*rr-lb/i);
    });
  });
});
