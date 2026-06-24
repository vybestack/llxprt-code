/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P27
 * @requirement:REQ-021
 *
 * Internal app-service helper barrel (REQ-021). These submodules implement the
 * durable, behavior-real config/app concerns. The PUBLIC entry point is the
 * SINGULAR `./app-service.js` subpath (`packages/agents/src/app-service.ts`),
 * which re-exports everything here. Consumers MUST import the public subpath,
 * not this internal directory.
 */

export { saveCurrentProfile, listProfiles, deleteProfile } from './profiles.js';
export { addMcpServer, removeMcpServer } from './mcp-config.js';
export { editMemory } from './memory.js';
export { manageSkills, manageExtensions } from './extensions-skills.js';
export { getAbout, getDiagnostics } from './diagnostics.js';
export { mutateSettings } from './settings.js';
export { listCliLocalCompletions } from './completions.js';
export type { CliLocalCompletion } from './completions.js';

export { COMMAND_API_MAP, APP_SERVICE_SUBPATH } from './command-api-map.js';
export type { CommandApiKind, CommandApiMapping } from './command-api-map.js';

export type {
  SaveProfileInput,
  SaveProfileResult,
  ListProfilesInput,
  ListProfilesResult,
  DeleteProfileInput,
  DeleteProfileResult,
  AddMcpServerInput,
  AddMcpServerResult,
  RemoveMcpServerInput,
  RemoveMcpServerResult,
  EditMemoryInput,
  EditMemoryResult,
  SkillAction,
  ManageSkillsInput,
  ManageSkillsManager,
  ManageSkillsSkill,
  ManageSkillsResult,
  ExtensionAction,
  ManageExtensionsInput,
  ManageExtensionsLoader,
  ManageExtensionsExtension,
  ManageExtensionsResult,
  MutateSettingsInput,
  MutateSettingsResult,
  DiagnosticsInput,
  DiagnosticsResult,
  AboutInput,
  AboutResult,
} from './types.js';
