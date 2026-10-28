/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SettingsService } from '@vybestack/llxprt-code-settings';

import { fromConfig } from '../fromConfig.js';
import { captureAgentPreflightHostInput } from '../preflight-host-input.js';
import type { AgentPreflightHostInput } from '../preflight-host-input.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('explicit Agent adoption and preflight construction requirements @plan:ISSUE-3222 @requirement:REQ-3222-AC3', () => {
  const credentials = useOwnedCredentials();
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

  it('rejects missing caller Config before constructing an adopted Agent @requirement:REQ-3222-AC3', async () => {
    await expect(
      Reflect.apply(fromConfig, undefined, [
        {
          sessionId: 'issue3222-required-config',
          credentialAuthority: credentials().authority,
        },
        new SettingsService(),
        {},
        credentials().authority,
      ]),
    ).rejects.toThrow(/config/i);
  });

  it('keeps the preflight data-only type free of superseded Config and service options @requirement:REQ-3222-AC3', () => {
    type SupersededOptionKey =
      | 'settingsService'
      | 'profileManager'
      | 'model'
      | 'debugMode'
      | 'workspaceDir';
    type ResurrectedOptionKey = Extract<
      SupersededOptionKey,
      keyof AgentPreflightHostInput
    >;
    // Non-distributive never-check: the annotation is `true` only while
    // no superseded key overlaps the options surface, and `never` (a
    // compile error for the `true` literal) the moment one returns.
    const supersededKeysAreGone: [ResurrectedOptionKey] extends [never]
      ? true
      : never = true;
    expect(supersededKeysAreGone).toBe(true);
  });
  it.each([
    'settingsService',
    'profileManager',
    'model',
    'debugMode',
    'workspaceDir',
  ])(
    'rejects superseded preflight field %s before owner acquisition',
    (field) => {
      expect(() =>
        captureAgentPreflightHostInput({
          runtimeId: 'explicit-data-only',
          [field]: 'unaccepted-input',
        }),
      ).toThrow(/[Uu]nrecognized/);
    },
  );
});
