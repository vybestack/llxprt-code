/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach } from 'bun:test';
import { Config, OutputFormat } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
const retainedDispatchRoots: Array<{
  config: Config;
  runtimeSettings: { store: SettingsService; owner: SessionSettingsOwner };
}> = [];
afterEach(async () => {
  const retiring = retainedDispatchRoots.splice(0);
  await Promise.all(
    retiring.map(async ({ config, runtimeSettings }) => {
      await runtimeSettings.owner.dispose();
      await config.dispose();
    }),
  );
});

export function createMinimalConfig(options: {
  interactive: boolean;
  question?: string;
  outputFormat?: string;
}) {
  const config = new Config({
    sessionId: 'test-session',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    model: 'dispatch-test',
    debugMode: false,
    interactive: options.interactive,
    question: options.question,
    outputFormat: dispatchOutputFormat(options.outputFormat),
  });
  const store = new SettingsService();
  const owner = new SessionSettingsOwner(store);
  owner.bindTelemetry(config);
  owner.writeUserParameter('session-recording-queue-max-bytes', 4096);
  const runtimeSettings = { store, owner };
  retainedDispatchRoots.push({ config, runtimeSettings });
  return { config, runtimeSettings };
}

function dispatchOutputFormat(format: string | undefined): OutputFormat {
  if (format === 'json') return OutputFormat.JSON;
  if (format === 'stream-json') return OutputFormat.STREAM_JSON;
  return OutputFormat.TEXT;
}
