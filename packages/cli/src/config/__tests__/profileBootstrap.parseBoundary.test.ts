/**
 * Behavioral tests for the shared profile-JSON parse boundary via the CLI
 * `--profile` path and the load-balancer interactive save member rule (#2642).
 *
 * The inline `--profile` path (profileBootstrap) and the on-disk path
 * (ProfileManager) must agree on the same parsed result for identical content,
 * and the interactive save path must still require >= 2 member profiles.
 *
 * These use the REAL `parseProfileJson` (via `profileBootstrap` for the
 * `--profile` path, `ProfileManager` for the on-disk path) against a real
 * temp directory. The runtime providers module is mocked only so the
 * profileBootstrap module can be imported; the parser and ProfileManager are real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseInlineProfile } from '../profileBootstrap.js';
import {
  parseProfileJson,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import { profileCommand } from '../../ui/commands/profileCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

void vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  registerAgentRuntimeFactories: vi.fn(),
  resetAgentRuntimeFactories: vi.fn(),
  registerCliProviderInfrastructure: vi.fn(),
}));

const runtimeMocks = {
  saveProfileSnapshot: vi.fn(),
  loadProfileByName: vi.fn(),
  deleteProfileByName: vi.fn(),
  listSavedProfiles: vi.fn(),
  setDefaultProfileName: vi.fn(),
  getActiveProfileName: vi.fn(),
  getActiveProviderStatus: vi.fn(),
  saveLoadBalancerProfile: vi.fn(),
  getEphemeralSettings: vi.fn(),
};

void vi.mock('../../ui/contexts/RuntimeContext.js', () => ({
  getRuntimeApi: vi.fn(() => runtimeMocks),
}));

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-issue2642-cli-'));
}

describe('parseInlineProfile — same content as the on-disk parse boundary (#2642)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('identical inline --profile JSON and on-disk JSON produce the same provider/model', async () => {
    const content = JSON.stringify({
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: { temperature: 0.7 },
      ephemeralSettings: { 'context-limit': 190000 },
    });

    // On-disk path → real parseProfileJson.
    const onDisk = parseProfileJson(content);
    if (onDisk.kind !== 'parsed') {
      throw new Error(`expected kind "parsed", got "${onDisk.kind}"`);
    }
    {
      const value = onDisk.value as {
        provider: string;
        model: string;
      };
      expect(value.provider).toBe('openai');
      expect(value.model).toBe('gpt-4');
    }

    // On-disk path through the real ProfileManager.
    const manager = new ProfileManager(tempDir);
    await fs.writeFile(path.join(tempDir, 'profile.json'), content, 'utf8');
    const loaded = await manager.loadProfile('profile');
    expect(loaded.provider).toBe('openai');
    expect(loaded.model).toBe('gpt-4');

    // Inline --profile path (real parseProfileJson inside profileBootstrap).
    const inline = parseInlineProfile(content);
    expect(inline.providerName).toBe('openai');
    expect(inline.modelName).toBe('gpt-4');
    expect(inline.error).toBeUndefined();
  });

  it('the same malformed content is rejected through ProfileManager, the inline path, and parseProfileJson', async () => {
    const malformed = '{ this is not json';

    // Inline --profile path.
    const inline = parseInlineProfile(malformed);
    expect(inline.error).toBeDefined();

    // On-disk path: the SAME malformed bytes must be rejected as corrupt,
    // not silently reported as missing.
    await fs.writeFile(path.join(tempDir, 'malformed.json'), malformed, 'utf8');
    await expect(
      new ProfileManager(tempDir).loadProfile('malformed'),
    ).rejects.toThrow('corrupted');

    // Direct parse boundary agrees with both.
    expect(parseProfileJson(malformed).kind).toBe('invalid-json');
  });
});

describe('profile load-balancer save — interactive path still requires >= 2 members (#2642)', () => {
  beforeEach(() => {
    runtimeMocks.listSavedProfiles.mockResolvedValue(['profile1', 'profile2']);
    runtimeMocks.getEphemeralSettings.mockReturnValue({});
    runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);
  });

  const saveProfile = () =>
    profileCommand.subCommands!.find((cmd) => cmd.name === 'save')!;

  it('too few arguments produce the usage error, not the member-count error', async () => {
    const result = await saveProfile().action!(
      createMockCommandContext(),
      'loadbalancer lb roundrobin profile1',
    );

    expect(result).toBeDefined();
    expect(result).toMatchObject({ type: 'message', messageType: 'error' });
    const content = (result as { content: string }).content;
    expect(content).toContain('Usage: /profile save loadbalancer');
  });

  it('one member surviving --context-limit stripping is rejected as too few members', async () => {
    // Enough tokens to clear the arity guard, so this reaches the member-count
    // rule. Proves BOTH that the flag and its value are stripped rather than
    // counted as profile names, and that a lone member is then rejected.
    const result = await saveProfile().action!(
      createMockCommandContext(),
      'loadbalancer lb roundrobin --context-limit 150000 profile1',
    );

    expect(result).toBeDefined();
    expect(result).toMatchObject({ type: 'message', messageType: 'error' });
    const content = (result as { content: string }).content;
    expect(content).toContain('at least 2 profiles');
  });

  it('--context-limit and its value are stripped, not counted as members', async () => {
    const result = await saveProfile().action!(
      createMockCommandContext(),
      'loadbalancer lb roundrobin --context-limit 150000 profile1 profile2',
    );

    expect(result).toBeDefined();
    const content = (result as { content: string }).content;
    expect(content).toContain(
      "Load balancer profile 'lb' saved with 2 profiles",
    );
  });

  it('two members save successfully', async () => {
    const result = await saveProfile().action!(
      createMockCommandContext(),
      'loadbalancer lb roundrobin profile1 profile2',
    );

    expect(result).toBeDefined();
    const content = (result as { content: string }).content;
    expect(content).toContain(
      "Load balancer profile 'lb' saved with 2 profiles",
    );
  });
});
