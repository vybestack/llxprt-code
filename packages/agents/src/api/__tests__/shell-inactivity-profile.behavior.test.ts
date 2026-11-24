/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { CoreShellToolHostAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreShellToolHostAdapter.js';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import {
  standardProfile,
  useProfileOwner,
} from './helpers/profile-workflow-owner-fixture.js';

const SETTING = 'shell-inactivity-timeout-seconds';

describe('shell inactivity timeout under profile control (issue #4094)', () => {
  const owner = useProfileOwner();

  function shellHost(): CoreShellToolHostAdapter {
    const { config, settingsOwner } = owner();
    const workspace = new WorkspaceFilesystemOwner({
      targetDir: config.getTargetDir(),
      isTrusted: () => true,
    });
    return new CoreShellToolHostAdapter(config, workspace.paths, () =>
      settingsOwner.readToolExecutionPolicy(),
    );
  }

  it('uses the 300 s default when no profile or setting supplies a value', () => {
    expect(shellHost().getShellExecutionConfig().inactivityTimeoutMs).toBe(
      300_000,
    );
  });

  it('applies a profile value after a profile load', async () => {
    await owner().application.applySnapshot(
      standardProfile({ [SETTING]: 900 }),
    );

    expect(shellHost().getShellExecutionConfig().inactivityTimeoutMs).toBe(
      900_000,
    );
  });

  it('applies -1 from a profile as unlimited', async () => {
    await owner().application.applySnapshot(standardProfile({ [SETTING]: -1 }));

    expect(
      shellHost().getShellExecutionConfig().inactivityTimeoutMs,
    ).toBeUndefined();
  });

  it('returns to the default when the next profile loaded does not set a value', async () => {
    await owner().application.applySnapshot(
      standardProfile({ [SETTING]: 900 }),
    );
    await owner().application.applySnapshot(standardProfile({}));

    expect(shellHost().getShellExecutionConfig().inactivityTimeoutMs).toBe(
      300_000,
    );
  });
});
