/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const pasteConfig = {
  getMcpServers: () => undefined,
  apiKey: 'test-key',
  model: 'test-model',
  getProjectRoot: () => '/tmp/test',
  getTargetDir: () => '/tmp/test',
  getWorkspaceContext: () => ({
    getDirectories: () => ['/tmp/test'],
  }),
  getEnablePromptCompletion: () => false,
  getUtilityModel: () => undefined,
};
