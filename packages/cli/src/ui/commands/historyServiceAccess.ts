/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandContext } from './types.js';

export function requireSessionAgent(
  context: CommandContext,
): NonNullable<CommandContext['services']['agent']> {
  const agent = context.services.agent;
  if (!agent) throw new Error('Session agent is unavailable');
  return agent;
}
