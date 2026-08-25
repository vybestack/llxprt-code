/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, afterEach } from 'bun:test';
import {
  resolvePwshTestPolicy,
  resolvePwshTestPolicyFromEnv,
} from '../pwsh-test-policy.js';

describe('resolvePwshTestPolicy', () => {
  it('runs when the grammar is available and CI is unset', () => {
    const policy = resolvePwshTestPolicy({ available: true, ci: undefined });
    expect(policy).toStrictEqual({
      skip: false,
      skipReason: null,
      failureMessage: null,
    });
  });

  it('runs when the grammar is available even in CI', () => {
    const policy = resolvePwshTestPolicy({ available: true, ci: 'true' });
    expect(policy).toStrictEqual({
      skip: false,
      skipReason: null,
      failureMessage: null,
    });
  });

  it('skips locally with a repair hint when the grammar is unavailable', () => {
    const policy = resolvePwshTestPolicy({ available: false, ci: undefined });
    expect(policy.skip).toBe(true);
    expect(policy.skipReason).toContain('tree-sitter-pwsh');
    expect(policy.skipReason).toMatch(/bun install|npm install/);
    expect(policy.failureMessage).toBeNull();
  });

  it('fails in CI with an actionable message when the grammar is unavailable', () => {
    const policy = resolvePwshTestPolicy({ available: false, ci: 'true' });
    expect(policy.skip).toBe(false);
    expect(policy.failureMessage).toContain('tree-sitter-pwsh');
    expect(policy.failureMessage).toMatch(/bun install|npm install/);
    expect(policy.failureMessage).toContain('CI');
    expect(policy.skipReason).toBeNull();
  });

  it('treats the empty string as not-CI and skips instead of failing', () => {
    const policy = resolvePwshTestPolicy({ available: false, ci: '' });
    expect(policy.skip).toBe(true);
    expect(policy.skipReason).not.toBeNull();
    expect(policy.failureMessage).toBeNull();
  });
});

describe('resolvePwshTestPolicyFromEnv', () => {
  const savedStash = process.env.CI_BEFORE_TEST_PRELOAD;
  const savedCi = process.env.CI;

  afterEach(() => {
    if (savedStash === undefined) {
      delete process.env.CI_BEFORE_TEST_PRELOAD;
    } else {
      process.env.CI_BEFORE_TEST_PRELOAD = savedStash;
    }
    if (savedCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = savedCi;
    }
  });

  it('prefers the pre-preload CI stash over the safety override', () => {
    // bun-preload.ts force-sets CI='true' for every core test run; a local
    // run must still skip when the stash says CI was originally unset.
    process.env.CI_BEFORE_TEST_PRELOAD = '';
    process.env.CI = 'true';
    const policy = resolvePwshTestPolicyFromEnv(false);
    expect(policy.skip).toBe(true);
    expect(policy.failureMessage).toBeNull();
  });

  it('fails when the stash records a real CI runner', () => {
    process.env.CI_BEFORE_TEST_PRELOAD = 'true';
    process.env.CI = 'true';
    const policy = resolvePwshTestPolicyFromEnv(false);
    expect(policy.skip).toBe(false);
    expect(policy.failureMessage).toContain('tree-sitter-pwsh');
  });

  it('falls back to process.env.CI when the stash is absent', () => {
    delete process.env.CI_BEFORE_TEST_PRELOAD;
    process.env.CI = 'true';
    const policy = resolvePwshTestPolicyFromEnv(false);
    expect(policy.skip).toBe(false);
    expect(policy.failureMessage).toContain('tree-sitter-pwsh');

    delete process.env.CI;
    const localPolicy = resolvePwshTestPolicyFromEnv(false);
    expect(localPolicy.skip).toBe(true);
  });

  it('runs regardless of CI when the grammar is available', () => {
    process.env.CI_BEFORE_TEST_PRELOAD = '';
    process.env.CI = 'true';
    expect(resolvePwshTestPolicyFromEnv(true).skip).toBe(false);
  });
});
