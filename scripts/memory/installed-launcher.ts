/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export async function main(): Promise<void> {
  const { createInstalledLauncherRuntime, runLauncher } = await import(
    './launcher.ts'
  );

  runLauncher(
    createInstalledLauncherRuntime(import.meta.url, process.env.CLI_VERSION),
  );
}
