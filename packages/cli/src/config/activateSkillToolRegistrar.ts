/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ActivateSkillTool } from '@vybestack/llxprt-code-tools/tools/activate-skill.js';
import type { PostSkillDiscoveryToolRegistrar } from '@vybestack/llxprt-code-core';

/**
 * Composition-root implementation of {@link PostSkillDiscoveryToolRegistrar}.
 *
 * `ActivateSkillTool` captures the available skill names in its description and
 * its `name` parameter schema when it is constructed, so the registered
 * instance has to be replaced whenever the skill set changes. Core invokes this
 * after every skill discovery, including `/skills reload` (issue #3379).
 *
 * When no skills are available the tool is left unregistered rather than
 * registered with an empty enum, so a session that starts with no skills can
 * still gain the tool on a later reload.
 *
 * Lives in the CLI because `ActivateSkillTool` may not be referenced from core
 * (issue #2417).
 */
export const registerActivateSkillTool: PostSkillDiscoveryToolRegistrar = (
  toolRegistry,
  skillService,
  messageBus,
) => {
  // Build the replacement before touching the registry. Construction is the
  // only step here that can throw, and Config.reloadSkills() lets that
  // propagate. Unregistering first would leave the registry without a tool the
  // live chat session is still advertising, because the setTools() that would
  // have corrected the session never runs on the failure path.
  const replacement =
    skillService.listSkills().length > 0
      ? new ActivateSkillTool(skillService, messageBus)
      : undefined;

  toolRegistry.unregisterTool(ActivateSkillTool.Name);
  if (replacement) {
    toolRegistry.registerTool(replacement);
  }
};
