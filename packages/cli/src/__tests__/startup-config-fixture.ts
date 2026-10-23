/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach } from 'bun:test';
import { Config, OutputFormat } from '@vybestack/llxprt-code-core';
const startupConfigs: Config[] = [];

afterEach(async () => {
  await Promise.all(startupConfigs.splice(0).map((config) => config.dispose()));
});
export function makeConfig(
  hasActive: boolean,
  interactive: boolean,
  experimentalZedIntegration = false,
): Config {
  const config = new Config({
    sessionId: crypto.randomUUID(),
    cwd: process.cwd(),
    targetDir: process.cwd(),
    debugMode: false,
    experimentalZedIntegration,
    model: 'startup-test',
    provider: hasActive ? 'fake' : undefined,
    interactive,
    outputFormat: OutputFormat.TEXT,
  });
  startupConfigs.push(config);
  return config;
}
