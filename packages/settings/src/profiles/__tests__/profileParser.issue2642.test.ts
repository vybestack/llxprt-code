/**
 * Behavioral tests for the shared profile-JSON parse boundary (#2642).
 *
 * All profile-JSON enters via a single `parseProfileJson` boundary that
 * ProfileManager routes every load through. These tests write REAL profile JSON
 * into a REAL temp directory and read it back through the REAL `parseProfileJson`
 * and REAL `ProfileManager` — no mocks, no stubs. Filesystem is
 * infrastructure; the parser and ProfileManager are the systems under test.
 *
 * Note: ProfileManager member validation is observed through its public
 * surface (loadProfile / deleteProfile), which is the behaviour a user sees.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { ProfileManager } from '../ProfileManager.js';
import {
  parseProfileJson,
  MIN_LOAD_BALANCER_MEMBERS,
} from '../../settings/validation.js';
import {
  withTempDir,
  writeProfile,
} from './canonicalProfileRepair.testHelpers.js';
import { getProfilePersistableKeys } from '../../settings/settingsRegistry.js';

const tempDir = withTempDir('llxprt-issue2642-parser-');
const profilesDir = () => path.join(tempDir(), 'profiles');
const pm = () => new ProfileManager(profilesDir());

// Guarantee the profiles directory exists for every test. Without this, tests
// that write raw JSON via fsp.writeFile would depend on an earlier
// writeProfile() call (which mkdirs) having run first in the same test.
beforeEach(async () => {
  await fsp.mkdir(profilesDir(), { recursive: true });
});

function standardProfileJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    provider: 'openai',
    model: 'gpt-4',
    modelParams: {},
    ephemeralSettings: {},
    ...overrides,
  });
}

function loadBalancerJson(profiles: readonly string[]): string {
  return JSON.stringify({
    version: 1,
    type: 'loadbalancer',
    policy: 'roundrobin',
    profiles,
    provider: '',
    model: '',
    modelParams: {},
    ephemeralSettings: {},
  });
}

// ─── A. single parser ───────────────────────────────────────────────────────

describe('parseProfileJson — single profile-JSON parse boundary', () => {
  it('returns kind "parsed" with the parsed value for valid JSON', () => {
    const result = parseProfileJson(
      JSON.stringify({ version: 1, provider: 'anthropic', model: 'gpt-4' }),
    );

    if (result.kind !== 'parsed') {
      throw new Error(`expected kind "parsed", got "${result.kind}"`);
    }
    {
      const value = result.value as { provider: string };
      expect(value.provider).toBe('anthropic');
    }
  });

  it('returns kind "invalid-json" for malformed JSON', () => {
    const result = parseProfileJson('{ not valid json');

    if (result.kind !== 'invalid-json') {
      throw new Error(`expected kind "invalid-json", got "${result.kind}"`);
    }
    {
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('returns kind "unsafe" for a top-level __proto__ key', () => {
    const result = parseProfileJson(
      '{"version":1,"provider":"openai","model":"gpt-4","__proto__":{"isAdmin":true}}',
    );

    expect(result.kind).toBe('unsafe');
  });

  it('returns kind "unsafe" for a nested constructor key', () => {
    const content = JSON.stringify({
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: { constructor: { prototype: { polluted: true } } },
      ephemeralSettings: {},
    });

    expect(parseProfileJson(content).kind).toBe('unsafe');
  });

  it('returns kind "unsafe" for a nested prototype key', () => {
    const content =
      '{"version":1,"provider":"openai","model":"gpt-4","modelParams":{},"ephemeralSettings":{"nested":{"prototype":{}}}}';

    expect(parseProfileJson(content).kind).toBe('unsafe');
  });

  it('a profile containing a legacy `loadBalancer` field still loads and is a standard profile', async () => {
    const legacy = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: { temperature: 0.7 },
      ephemeralSettings: {},
      loadBalancer: {
        strategy: 'round-robin',
        subProfiles: [
          { name: 'a', provider: 'openai' },
          { name: 'b', provider: 'openai' },
        ],
      },
    };
    const parsed = parseProfileJson(JSON.stringify(legacy));
    if (parsed.kind !== 'parsed' || parsed.value === null) {
      throw new Error(`expected a non-null parsed value, got "${parsed.kind}"`);
    }
    {
      const value = parsed.value as { provider: string };
      expect(value.provider).toBe('openai');
    }
    writeProfile(profilesDir(), 'legacy-lb.json', legacy);
    const loaded = await pm().loadProfile('legacy-lb');
    expect(loaded.type).not.toBe('loadbalancer');
    expect(loaded.provider).toBe('openai');
    expect(loaded.version).toBe(1);
  });

  it('an on-disk profile and an identical inline JSON string parse to the same value', async () => {
    const content = JSON.stringify({
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: { 'context-limit': 190000 },
    });
    writeProfile(profilesDir(), 'standard-a.json', JSON.parse(content));

    const parsed = parseProfileJson(content);
    const loaded = await pm().loadProfile('standard-a');

    if (parsed.kind !== 'parsed') {
      throw new Error(`expected kind "parsed", got "${parsed.kind}"`);
    }
    {
      const value = parsed.value as { provider: string; model: string };
      expect(value.provider).toBe('openai');
      expect(loaded.provider).toBe('openai');
      expect(loaded.version).toBe(1);
    }
  });
});

// ─── B. LB member handling through the shared parser ─────────────────────

describe('parseProfileJson — load-balancer member validation through ProfileManager', () => {
  it('rejects a load balancer referencing a MISSING member on load', async () => {
    await fsp.writeFile(
      path.join(profilesDir(), 'lb-hosts-ghost.json'),
      loadBalancerJson(['no-such-member']),
      'utf8',
    );
    writeProfile(
      profilesDir(),
      'member.json',
      JSON.parse(standardProfileJson()),
    );

    await expect(pm().loadProfile('lb-hosts-ghost')).rejects.toThrow(
      /references non-existent profile 'no-such-member'/,
    );
  });

  it('rejects a load balancer referencing a NESTED load balancer', async () => {
    writeProfile(
      profilesDir(),
      'member-b.json',
      JSON.parse(standardProfileJson()),
    );
    await fsp.writeFile(
      path.join(profilesDir(), 'nested.json'),
      loadBalancerJson(['member-b']),
      'utf8',
    );
    await fsp.writeFile(
      path.join(profilesDir(), 'nested-outer.json'),
      loadBalancerJson(['nested']),
      'utf8',
    );

    await expect(pm().loadProfile('nested-outer')).rejects.toThrow(
      /cannot reference another LoadBalancer profile 'nested'/,
    );
  });

  it('a 1-member load-balancer file LOADS successfully (MIN_LOAD_BALANCER_MEMBERS = 1)', async () => {
    expect(MIN_LOAD_BALANCER_MEMBERS).toBe(1);
    writeProfile(
      profilesDir(),
      'member-c.json',
      JSON.parse(standardProfileJson()),
    );
    await fsp.writeFile(
      path.join(profilesDir(), 'single-member.json'),
      loadBalancerJson(['member-c']),
      'utf8',
    );

    const loaded = await pm().loadProfile('single-member');
    if (loaded.type !== 'loadbalancer') {
      throw new Error(`expected a loadbalancer profile, got "${loaded.type}"`);
    }
    {
      expect(loaded.profiles).toStrictEqual(['member-c']);
      expect(loaded.version).toBe(1);
    }
  });

  it('survives a directory that also has an invalid JSON file and a non-profile JSON file when scanning references', async () => {
    writeProfile(
      profilesDir(),
      'member-d.json',
      JSON.parse(standardProfileJson()),
    );
    await fsp.writeFile(
      path.join(profilesDir(), 'garbage.json'),
      '{ broken',
      'utf8',
    );
    await fsp.writeFile(
      path.join(profilesDir(), 'notes.json'),
      '{"iAm":"plain json","not":"a-profile"}',
      'utf8',
    );

    const loaded = await pm().loadProfile('member-d');
    expect(loaded.provider).toBe('openai');
  });

  it('refuses to delete a referenced member, scanning past invalid and non-profile siblings', async () => {
    writeProfile(
      profilesDir(),
      'member-f-a.json',
      JSON.parse(standardProfileJson()),
    );
    await fsp.writeFile(
      path.join(profilesDir(), 'broken.json'),
      '{ broken',
      'utf8',
    );
    await fsp.writeFile(
      path.join(profilesDir(), 'plain.json'),
      '{"kind":"not-a-profile"}',
      'utf8',
    );
    await fsp.writeFile(
      path.join(profilesDir(), 'lb-ref.json'),
      loadBalancerJson(['member-f-a']),
      'utf8',
    );

    // The corrupt / non-profile siblings must not crash the scan → the
    // reference is found and deletion is blocked, not thrown.
    await expect(pm().deleteProfile('member-f-a')).rejects.toThrow(
      /referenced by load balancer profile\(s\): lb-ref/,
    );
  });
});

// ─── E. application keys are tolerated and never persisted ───────────────

describe('application-owned settings keys', () => {
  it('a profile file containing application keys loads without error', async () => {
    const content = JSON.stringify({
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {
        emojifilter: 'auto',
        dumponerror: 'enabled',
        dumpcontext: 'off',
      },
    });
    writeProfile(profilesDir(), 'app-keys.json', JSON.parse(content));

    const loaded = await pm().loadProfile('app-keys');
    expect(loaded.version).toBe(1);
    expect(loaded.provider).toBe('openai');
  });

  it('the application keys are excluded from profile persistence', () => {
    const keys = getProfilePersistableKeys();
    for (const key of ['emojifilter', 'dumponerror', 'dumpcontext']) {
      expect(keys).not.toContain(key);
    }
  });
});

// ─── F. regression fixture set ─────────────────────────────────────────────

describe('regression profile fixtures load with version: 1 unchanged', () => {
  it('standard profile', async () => {
    writeProfile(profilesDir(), 'std.json', JSON.parse(standardProfileJson()));
    const loaded = await pm().loadProfile('std');
    expect(loaded.version).toBe(1);
    expect(loaded.provider).toBe('openai');
  });

  it('load-balancer profile', async () => {
    writeProfile(
      profilesDir(),
      'member.json',
      JSON.parse(standardProfileJson()),
    );
    await fsp.writeFile(
      path.join(profilesDir(), 'lb.json'),
      loadBalancerJson(['member']),
      'utf8',
    );
    const loaded = await pm().loadProfile('lb');
    expect(loaded.version).toBe(1);
    expect(loaded.type).toBe('loadbalancer');
  });

  it('unknown / future keys are preserved through the passthrough parse', async () => {
    const content = JSON.stringify({
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: { 'future-param': 1 },
      ephemeralSettings: { 'future-setting': true },
      futureTopLevelField: 'future',
    });
    writeProfile(profilesDir(), 'future.json', JSON.parse(content));

    const parsed = parseProfileJson(content);
    if (parsed.kind !== 'parsed') {
      throw new Error(`expected kind "parsed", got "${parsed.kind}"`);
    }
    {
      const value = parsed.value as { futureTopLevelField: string };
      expect(value.futureTopLevelField).toBe('future');
    }
    const loaded = await pm().loadProfile('future');
    expect(loaded.version).toBe(1);
  });
});
