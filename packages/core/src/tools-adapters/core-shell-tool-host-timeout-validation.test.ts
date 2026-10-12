/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { Config } from '../config/config.js';
import { SessionSettingsOwner } from '../session/session-settings-owner.js';
import { WorkspaceFilesystemOwner } from '../services/workspace-filesystem-owner.js';
import { CoreShellToolHostAdapter } from './CoreShellToolHostAdapter.js';

function createHost(
  defaultSeconds: number,
  maxSeconds: number,
): CoreShellToolHostAdapter {
  const config = new Config({
    sessionId: 'session-cr3031',
    model: 'timeout-model',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
  });
  const settings = new SettingsService();
  const owner = new SessionSettingsOwner(settings);
  owner.writeUserParameter('shell-default-timeout-seconds', defaultSeconds);
  owner.writeUserParameter('shell-max-timeout-seconds', maxSeconds);
  const paths = new WorkspaceFilesystemOwner({
    targetDir: process.cwd(),
    isTrusted: () => true,
  }).paths;
  return new CoreShellToolHostAdapter(config, paths, () =>
    owner.readToolExecutionPolicy(),
  );
}

describe('CoreShellToolHostAdapter configured timeout validation', () => {
  it.each([0, -2, Infinity])(
    'rejects an invalid shell-max-timeout-seconds (%s) at the shell host resolution boundary',
    (badMax) => {
      const host = createHost(60, badMax);
      expect(() => host.getTimeoutConfig()).toThrow(
        /shell-max-timeout-seconds/,
      );
    },
  );

  it.each([0, -2, Infinity])(
    'rejects an invalid shell-default-timeout-seconds (%s) at the shell host resolution boundary',
    (badDefault) => {
      const host = createHost(badDefault, 100);
      expect(() => host.getTimeoutConfig()).toThrow(
        /shell-default-timeout-seconds/,
      );
    },
  );
});
