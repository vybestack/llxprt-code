/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

interface StreamSettingsRoot {
  readonly config: Config;
  readonly settingsOwner: SessionSettingsOwner;
  readonly includeThinking: boolean;
}

let roots: readonly StreamSettingsRoot[] = [];
afterEach(async () => {
  const retiring = roots;
  roots = [];
  const failures: unknown[] = [];
  for (const root of retiring) {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => root.settingsOwner.dispose()),
      root.config.dispose(),
    ]);
    failures.push(
      ...results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      ),
    );
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      'Stream settings fixture cleanup failed',
    );
});

export function createStreamSettingsFixture(
  options: {
    readonly sessionId?: string;
    readonly includeInResponse?: boolean;
  } = {},
): StreamSettingsRoot {
  const config = new Config({
    sessionId: options.sessionId ?? 'test-session',
    cwd: process.cwd(),
    targetDir: process.cwd(),
    model: 'stream-output-fixture',
    debugMode: false,
  });
  const settingsOwner = new SessionSettingsOwner(new SettingsService());
  settingsOwner.writeUserParameter(
    'reasoning.includeInResponse',
    options.includeInResponse,
  );
  const root = {
    config,
    settingsOwner,
    get includeThinking(): boolean {
      return (
        settingsOwner.readNamedParameter('reasoning.includeInResponse') !==
        false
      );
    },
  };
  roots = [...roots, root];
  return root;
}
