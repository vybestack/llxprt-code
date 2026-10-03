/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20270110-ISSUE2378.P03
 * @requirement:REQ-2378-003
 *
 * Public core API for lightweight skill discovery against a resolved Config.
 *
 * #2378: the CLI `skills list` command delegates Config initialization and
 * discovery to this helper. The caller retains ownership of the explicit
 * MessageBus while this helper drives `Config.initialize` so extension loading
 * and skill discovery run, then returns the discovered skills.
 *
 * The initialize lifecycle is idempotent here: an already-initialized Config
 * (its `initialize()` throws "Config was already initialized") is treated as a
 * no-op so a second discovery call re-reads the already-discovered skills
 * rather than failing.
 */

import type { Config } from '../config/config.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { SkillDefinition } from './skillLoader.js';

/**
 * Initializes the given Config with the caller-owned MessageBus and returns the
 * skills discovered during that initialization.
 *
 * When `skillsSupport` is disabled on the Config, initialization does not run
 * skill discovery and this returns an empty array.
 *
 * @param config A resolved Config (e.g. from the CLI's loadCliConfig path).
 * @returns The discovered skills (built-in, extension, user, and project).
 */
export async function discoverSkillsForConfig(
  config: Config,
  messageBus: MessageBus,
): Promise<SkillDefinition[]> {
  await config.ensureInitialized({ messageBus });
  return config.getSkillManager().getAllSkills();
}
