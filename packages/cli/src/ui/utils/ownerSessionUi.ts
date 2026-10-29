/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';

type OwnerUiReplay = {
  readonly warnings: readonly string[];
};

export async function importOwnerSession(
  importSession: Agent['session']['importSession'],
  packageDirectory: string,
): Promise<OwnerUiReplay> {
  await importSession(packageDirectory);
  return { warnings: [] };
}
