/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P27
 * @requirement:REQ-021
 *
 * Canonical slash-command → API surface map (REQ-021 / §4.7 runtime-vs-app-
 * service boundary). This is the PRODUCTION source of truth; the P09 boundary
 * harness re-exports `COMMAND_API_MAP` / `CommandApiMapping` from here (via the
 * public `./app-service.js` subpath) instead of duplicating it, so there is no
 * drift.
 *
 * Every CLI touchpoint is assigned exactly one kind:
 *   - runtime    -> a live Agent method path (affects the active conversation).
 *   - subpath    -> a durable app-service concern exposed via this subpath.
 *   - cli-local  -> pure UI/UX with no core dependency.
 *
 * The durable `subpath` set targets the SINGULAR public specifier
 * `@vybestack/llxprt-code-agents/app-service.js`, implemented by the concrete
 * behavior-real functions re-exported alongside this map.
 */

import type { CommandApiMapping } from './types.js';

export type { CommandApiKind, CommandApiMapping } from './types.js';

/**
 * The pinned public app-service subpath specifier targeted by every durable
 * `subpath` entry below.
 */
export const APP_SERVICE_SUBPATH =
  '@vybestack/llxprt-code-agents/app-service.js';

export const COMMAND_API_MAP: readonly CommandApiMapping[] = [
  {
    command: '/auth',
    kind: 'runtime',
    target: 'agent.auth.login',
    note: 'OAuth/key login affects the active provider run',
  },
  {
    command: '/key',
    kind: 'runtime',
    target: 'agent.auth.keys',
    note: 'API key store feeds the active runtime auth',
  },
  {
    command: '/keyfile',
    kind: 'runtime',
    target: 'agent.auth',
    note: 'Keyfile path feeds the active runtime auth',
  },
  {
    command: '/provider',
    kind: 'runtime',
    target: 'agent.setProvider',
    note: 'Switching the live provider affects the active turn',
  },
  {
    command: '/model',
    kind: 'runtime',
    target: 'agent.setModel',
    note: 'Switching the live model affects the active turn',
  },
  {
    command: '/profile apply',
    kind: 'runtime',
    target: 'agent.profiles.apply',
    note: 'Applying a profile rebinds the active runtime',
  },
  {
    command: '/profile save',
    kind: 'subpath',
    target: APP_SERVICE_SUBPATH,
    exportName: 'saveCurrentProfile',
    note: 'Persisting a profile is durable config, not live state',
  },
  {
    command: '/profile list',
    kind: 'subpath',
    target: APP_SERVICE_SUBPATH,
    exportName: 'listProfiles',
    note: 'Listing profiles reads durable config',
  },
  {
    command: '/profile delete',
    kind: 'subpath',
    target: APP_SERVICE_SUBPATH,
    exportName: 'deleteProfile',
    note: 'Deleting a profile mutates durable config',
  },
  {
    command: '/compress',
    kind: 'runtime',
    target: 'agent.compress',
    note: 'Compression operates on the live conversation history',
  },
  {
    command: '/mcp status',
    kind: 'runtime',
    target: 'agent.mcp.status',
    note: 'MCP status reflects the live runtime connection set',
  },
  {
    command: '/mcp auth',
    kind: 'runtime',
    target: 'agent.mcp.auth',
    note: 'MCP OAuth affects the live runtime connection',
  },
  {
    command: '/mcp add',
    kind: 'subpath',
    target: APP_SERVICE_SUBPATH,
    exportName: 'addMcpServer',
    note: 'Adding an MCP server is durable config, not live mutation',
  },
  {
    command: '/mcp remove',
    kind: 'subpath',
    target: APP_SERVICE_SUBPATH,
    exportName: 'removeMcpServer',
    note: 'Removing an MCP server is durable config, not live mutation',
  },
  {
    command: '/restore',
    kind: 'runtime',
    target: 'agent.restoreHistory',
    note: 'Restoring history feeds the live conversation context',
  },
  {
    command: '/chat save',
    kind: 'runtime',
    target: 'agent.session.createCheckpoint',
    note: 'Checkpointing the session is tied to the live agent snapshot',
  },
  {
    command: '/chat resume',
    kind: 'runtime',
    target: 'agent.session.resume',
    note: 'Resuming a session feeds the live conversation context',
  },
  {
    command: '/chat clear',
    kind: 'runtime',
    target: 'agent.resetChat',
    note: 'Clearing chat resets the live conversation',
  },
  {
    command: '/tools',
    kind: 'runtime',
    target: 'agent.tools.list',
    note: 'Listing tools reflects the live runtime tool registry',
  },
  {
    command: '/directory',
    kind: 'runtime',
    target: 'agent.addDirectoryContext',
    note: 'Directory context feeds the next live turn',
  },
  {
    command: '/memory show',
    kind: 'runtime',
    target: 'agent.updateSystemInstruction',
    note: 'Showing memory reflects the live system instruction',
  },
  {
    command: '/memory edit',
    kind: 'subpath',
    target: APP_SERVICE_SUBPATH,
    exportName: 'editMemory',
    note: 'Durable memory-file edits persist beyond the live run',
  },
  {
    command: '/skills',
    kind: 'subpath',
    target: APP_SERVICE_SUBPATH,
    exportName: 'manageSkills',
    note: 'Skill config is durable app-service state',
  },
  {
    command: '/extensions',
    kind: 'subpath',
    target: APP_SERVICE_SUBPATH,
    exportName: 'manageExtensions',
    note: 'Extension config is durable app-service state',
  },
  {
    command: '/ide',
    kind: 'runtime',
    target: 'agent.ide.status',
    note: 'IDE status reflects the live runtime integration',
  },
  {
    command: '/stats',
    kind: 'runtime',
    target: 'agent.getStats',
    note: 'Stats reflect the live conversation token usage',
  },
  {
    command: '/about',
    kind: 'subpath',
    target: APP_SERVICE_SUBPATH,
    exportName: 'getAbout',
    note: 'About/diagnostics is durable app-service metadata',
  },
  {
    command: 'settings mutation',
    kind: 'subpath',
    target: APP_SERVICE_SUBPATH,
    exportName: 'mutateSettings',
    note: 'Persisting settings is durable config, not live state',
  },
  {
    command: 'diagnostics',
    kind: 'subpath',
    target: APP_SERVICE_SUBPATH,
    exportName: 'getDiagnostics',
    note: 'Diagnostics is durable app-service metadata',
  },
  {
    command: 'completions:prompt',
    kind: 'cli-local',
    target: 'prompt completion (UI)',
    note: 'Loading stays CLI-local; the prompt action maps to a runtime turn',
  },
  {
    command: 'completions:command',
    kind: 'cli-local',
    target: 'command completion (UI)',
    note: 'Command discovery/loading stays CLI-local per §4.7 decision (a)',
  },
  {
    command: 'completions:at-command',
    kind: 'cli-local',
    target: 'at-command completion (UI)',
    note: 'At-command completion is pure UI; actions resolve to runtime/subpath',
  },
  {
    command: 'completions:mcp-prompt',
    kind: 'cli-local',
    target: 'MCP prompt completion (UI)',
    note: 'MCP prompt listing is CLI-local; execution routes to the runtime',
  },
  {
    command: '/help',
    kind: 'cli-local',
    target: 'help rendering (UI)',
    note: 'Pure UI with no core dependency',
  },
  {
    command: '/clear',
    kind: 'cli-local',
    target: 'screen clear (UI)',
    note: 'Pure UI with no core dependency',
  },
  {
    command: '/theme',
    kind: 'cli-local',
    target: 'theme switching (UI)',
    note: 'Pure UI with no core dependency',
  },
  {
    command: '/quit',
    kind: 'cli-local',
    target: 'exit (UI)',
    note: 'Pure UI with no core dependency',
  },
];
