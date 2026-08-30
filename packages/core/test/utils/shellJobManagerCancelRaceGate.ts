/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function capRaceFreezesOnCiWindows(
  platform: NodeJS.Platform,
  githubActions: string | undefined,
  runnerEnvironment: string | undefined,
): boolean {
  return (
    platform === 'win32' &&
    githubActions === 'true' &&
    runnerEnvironment === 'github-hosted'
  );
}
