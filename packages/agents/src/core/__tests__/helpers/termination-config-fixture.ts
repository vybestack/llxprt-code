/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  seedSubagentSettings,
  createSubagentConfig,
  acquireSubagentSettings,
  acquireSubagentWorkspace,
  installSubagentCleanup,
} from '../subagent-test-helpers.js';

const retain = installSubagentCleanup();

export async function createTerminationConfig(): Promise<{
  config: ReturnType<typeof createSubagentConfig>;
  mcpRuntime: Awaited<ReturnType<typeof acquireSubagentWorkspace>>;
  settingsOwner: Awaited<ReturnType<typeof acquireSubagentSettings>>;
  settingsService: ReturnType<typeof seedSubagentSettings>;
}> {
  const settingsService = seedSubagentSettings();
  const config = createSubagentConfig(settingsService, retain);
  const settingsOwner = await acquireSubagentSettings(
    config,
    settingsService,
    retain,
  );
  const mcpRuntime = await acquireSubagentWorkspace(config, retain);
  return { config, mcpRuntime, settingsService, settingsOwner };
}
