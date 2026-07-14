/**
 * Behavioral tests for canonical profile repair — outcome semantics.
 *
 * Covers the no-candidate / none, marker lifecycle, and I/O error outcome
 * paths of {@link repairCanonicalProfiles}. Split from the main test file
 * to stay within the eslint max-lines limit.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  repairCanonicalProfiles,
  CORRUPT_PROVIDER,
} from '../canonicalProfileRepair.js';
import {
  type TestEnv,
  setupEnv,
  teardownEnv,
  writeProfile,
  corruptCanonicalProfile,
  validLegacyProfile,
} from './canonicalProfileRepair.testHelpers.js';

// ─── No candidates / none outcome ──────────────────────────────────────────

describe('repairCanonicalProfiles — no candidates / none outcome', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('returns none when canonical profiles dir does not exist', () => {
    const result = repairCanonicalProfiles(
      path.join(env.canonicalDir, 'nonexistent'),
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');
  });

  it('returns none when no corrupt profiles exist', () => {
    writeProfile(env.canonicalDir, 'good.json', validLegacyProfile());
    writeProfile(env.legacyProfilesDir, 'good.json', validLegacyProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');
  });

  it('returns none when corrupt canonical has no valid legacy replacement', () => {
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    // No legacy file at all.

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');
  });

  it('returns none when legacy is a loadbalancer (not a valid standard replacement)', () => {
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'zai.json', {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['p1'],
      provider: 'load-balancer',
      model: 'default',
      modelParams: {},
      ephemeralSettings: {},
    });

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');

    // Canonical NOT replaced.
    expect(
      JSON.parse(
        fs.readFileSync(path.join(env.canonicalDir, 'zai.json'), 'utf-8'),
      ).provider,
    ).toBe(CORRUPT_PROVIDER);
  });

  it('returns none when canonical is a genuine loadbalancer', () => {
    writeProfile(env.canonicalDir, 'lb.json', {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['p1'],
      provider: 'load-balancer',
      model: 'default',
      modelParams: {},
      ephemeralSettings: {},
    });
    writeProfile(env.legacyProfilesDir, 'lb.json', validLegacyProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');

    // LB profile untouched.
    const after = JSON.parse(
      fs.readFileSync(path.join(env.canonicalDir, 'lb.json'), 'utf-8'),
    );
    expect(after.type).toBe('loadbalancer');
  });

  it('returns none when legacy replacement is also corrupt (matches the structural signature)', () => {
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'zai.json', corruptCanonicalProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');
  });

  it('does NOT repair when the legacy replacement has provider load-balancer with nonempty modelParams', () => {
    // The replacement has the virtual non-loadable provider 'load-balancer'
    // but does NOT match the narrow canonical corrupt signature (which
    // requires empty modelParams). It must still be rejected because
    // 'load-balancer' is not a registered provider at load time — replacing
    // one non-loadable profile with another non-loadable profile is not a
    // repair.
    writeProfile(env.canonicalDir, 'broken.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'broken.json', {
      version: 1,
      provider: CORRUPT_PROVIDER,
      model: 'some-model',
      modelParams: { temperature: 0.5 },
      ephemeralSettings: {
        'base-url': 'https://example.com',
        'auth-key-name': 'test',
        'context-limit': 100000,
      },
    });

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');

    // Canonical NOT replaced.
    expect(
      JSON.parse(
        fs.readFileSync(path.join(env.canonicalDir, 'broken.json'), 'utf-8'),
      ).provider,
    ).toBe(CORRUPT_PROVIDER);
  });

  it('returns none when legacy replacement is invalid JSON', () => {
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    fs.writeFileSync(
      path.join(env.legacyProfilesDir, 'zai.json'),
      '{ not valid json',
    );

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');
  });

  it('returns none when canonical has explicit type: standard (not the corrupt shape)', () => {
    writeProfile(env.canonicalDir, 'explicit.json', {
      version: 1,
      type: 'standard',
      provider: CORRUPT_PROVIDER,
      model: 'gemini-2.5-pro',
      modelParams: {},
      ephemeralSettings: {},
    });
    writeProfile(env.legacyProfilesDir, 'explicit.json', validLegacyProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');
  });

  it('returns none when canonical has nonempty modelParams (manually-authored, not the defect)', () => {
    writeProfile(env.canonicalDir, 'manual.json', {
      version: 1,
      provider: CORRUPT_PROVIDER,
      model: 'gemini-2.5-pro',
      modelParams: { temperature: 0.5 },
      ephemeralSettings: {},
    });
    writeProfile(env.legacyProfilesDir, 'manual.json', validLegacyProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');
  });

  it('returns none when canonical has nonempty ephemeralSettings (manually-authored, not the defect)', () => {
    writeProfile(env.canonicalDir, 'manual2.json', {
      version: 1,
      provider: CORRUPT_PROVIDER,
      model: 'gemini-2.5-pro',
      modelParams: {},
      ephemeralSettings: { 'base-url': 'https://example.com' },
    });
    writeProfile(env.legacyProfilesDir, 'manual2.json', validLegacyProfile());

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');
  });
});

// ─── Marker semantics: no stamp when no repair performed ────────────────────

describe('repairCanonicalProfiles — marker semantics', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('initial: no candidate / no canonical dir → none (no marker)', () => {
    const result = repairCanonicalProfiles(
      path.join(env.canonicalDir, 'no-such-dir'),
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('none');
  });

  it('later: affected canonical+legacy appears → repaired on next startup', () => {
    // First run: empty canonical dir, nothing to repair.
    const first = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(first.kind).toBe('none');

    // Later: affected files appear.
    writeProfile(env.canonicalDir, 'zai.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'zai.json', validLegacyProfile());

    // Next startup repairs.
    const second = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(second.kind).toBe('repaired');
    expect(second.kind === 'repaired' ? second.profilesRepaired : 0).toBe(1);
  });
});

// ─── I/O error outcomes ────────────────────────────────────────────────────

describe('repairCanonicalProfiles — I/O error outcomes', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await teardownEnv(env);
  });

  it('returns error when canonical profiles path is a file, not a directory', () => {
    fs.mkdirSync(env.canonicalDir, { recursive: true });
    // Replace the canonicalDir with a file.
    fs.rmSync(env.canonicalDir, { recursive: true, force: true });
    fs.writeFileSync(env.canonicalDir, 'not a directory');

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('error');
  });

  it('returns error and does NOT mutate anything when scan error exists alongside a repair candidate', () => {
    // A directory named "*.json" inside the canonical profiles dir will
    // cause a read error when the scan tries to readAndParseProfile it
    // (fs.readFileSync on a directory throws EISDIR). This error occurs
    // alongside a valid repair candidate. The repair must NOT proceed:
    // it must return kind:error and leave all files untouched.
    writeProfile(env.canonicalDir, 'broken.json', corruptCanonicalProfile());
    writeProfile(env.legacyProfilesDir, 'broken.json', validLegacyProfile());

    // Create a directory with a .json name so readdir picks it up and the
    // scan hits a read error on it.
    const corruptingDirPath = path.join(env.canonicalDir, 'trap.json');
    fs.mkdirSync(corruptingDirPath, { recursive: true });

    // Snapshot the valid candidate before the repair attempt.
    const brokenBefore = fs.readFileSync(
      path.join(env.canonicalDir, 'broken.json'),
      'utf-8',
    );

    const result = repairCanonicalProfiles(
      env.canonicalDir,
      env.legacyProfilesDir,
    );
    expect(result.kind).toBe('error');

    // No mutation: the valid candidate must be unchanged.
    const brokenAfter = fs.readFileSync(
      path.join(env.canonicalDir, 'broken.json'),
      'utf-8',
    );
    expect(brokenAfter).toBe(brokenBefore);

    // No backup file was created (repair did not start).
    const backups = fs
      .readdirSync(env.canonicalDir)
      .filter((f) => f.endsWith('.pre-repair.bak'));
    expect(backups).toStrictEqual([]);
  });
});
