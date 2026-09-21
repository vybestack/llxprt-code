/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:ISSUE-3222
 * @requirement:REQ-3222-AC3
 *
 * createIsolatedRuntimeContext must require a caller-supplied Config: the
 * factory must stop constructing Config on behalf of agent callers (that is
 * agent-owned assembly now). Calling it without a config must fail fast with
 * a typed Error naming the missing config — never silently build one.
 *
 * RED basis (main @ 5bedbd238): the factory silently constructs a Config via
 * resolveRuntimeConfig when options.config is undefined.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createIsolatedRuntimeContext,
  type IsolatedRuntimeContextOptions,
} from './runtimeSettings.js';

describe('createIsolatedRuntimeContext required config @plan:ISSUE-3222 @requirement:REQ-3222-AC3', () => {
  let previousConfigHome: string | undefined;
  let isolatedHome: string;

  beforeEach(() => {
    isolatedHome = mkdtempSync(join(tmpdir(), 'issue3222-required-config-'));
    previousConfigHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = isolatedHome;
  });

  afterEach(() => {
    if (previousConfigHome === undefined) {
      delete process.env.LLXPRT_CONFIG_HOME;
    } else {
      process.env.LLXPRT_CONFIG_HOME = previousConfigHome;
    }
    rmSync(isolatedHome, { recursive: true, force: true });
  });

  it('throws a typed Error naming the missing config when called without one @requirement:REQ-3222-AC3 @scenario:missing-config @given:activation bindings registered (runtimeSettings import) and NO config option @when:createIsolatedRuntimeContext({ runtimeId }) @then:an Error is thrown whose message names the required config (no runtime is silently constructed)', () => {
    expect(() =>
      createIsolatedRuntimeContext(
        // Intentional type escape: `config` is required on
        // IsolatedRuntimeContextOptions (issue #3222), but this test
        // asserts the runtime guard for JS callers that omit it, so the
        // options object deliberately crosses the typed API without one.
        {
          runtimeId: 'issue3222-required-config',
        } as unknown as IsolatedRuntimeContextOptions,
      ),
    ).toThrow(/config/i);
  });

  it('no superseded-path option key remains on the options surface @requirement:REQ-3222-AC3 @scenario:superseded-options-removed @given:the five option keys the caller-owned-Config path made dead (settingsService, profileManager, model, debugMode, workspaceDir) @when:the IsolatedRuntimeContextOptions type is inspected @then:none of them is a key of the options type (TypeScript rejects them at every call site; this structural pin fails compilation if one is resurrected)', () => {
    type SupersededOptionKey =
      | 'settingsService'
      | 'profileManager'
      | 'model'
      | 'debugMode'
      | 'workspaceDir';
    type ResurrectedOptionKey = Extract<
      SupersededOptionKey,
      keyof IsolatedRuntimeContextOptions
    >;
    // Non-distributive never-check: the annotation is `true` only while
    // no superseded key overlaps the options surface, and `never` (a
    // compile error for the `true` literal) the moment one returns.
    const supersededKeysAreGone: [ResurrectedOptionKey] extends [never]
      ? true
      : never = true;
    expect(supersededKeysAreGone).toBe(true);
  });
});
