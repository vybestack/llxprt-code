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
  toolRegistry.unregisterTool(ActivateSkillTool.Name);
  if (skillService.listSkills().length > 0) {
    toolRegistry.registerTool(new ActivateSkillTool(skillService, messageBus));
  }
};
