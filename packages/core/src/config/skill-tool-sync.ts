/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CoreSkillServiceAdapter } from '../tools-adapters/CoreSkillServiceAdapter.js';
import type { Config } from './config.js';

/**
 * Rebuilds the skill activation tool so it reflects the current skill set.
 *
 * The activation tool captures the available skill names in its description
 * and parameter schema when it is constructed, and that declaration is the
 * only channel by which the model learns which skills exist. It therefore has
 * to be rebuilt after every skill discovery, not just the first one, or a
 * reloaded skill stays invisible to the model until the CLI restarts
 * (issue #3379).
 *
 * The concrete tool is built by the injected registrar hook so the inverted
 * core->tools dependency stays out of core (issue #2417). The hook also owns
 * the decision of whether the tool should exist at all, which is why it is
 * invoked even when no skills are available: that is how a stale registration
 * gets removed.
 */
export function syncSkillActivationTool(config: Config): void {
  if (!config.isSkillsSupportEnabled()) {
    return;
  }
  const registrar = config.getPostSkillDiscoveryToolRegistrar();
  const messageBus = config.getRuntimeMessageBus();
  if (!registrar || !messageBus) {
    return;
  }
  registrar(
    config.getToolRegistry(),
    new CoreSkillServiceAdapter(config),
    messageBus,
  );
}
