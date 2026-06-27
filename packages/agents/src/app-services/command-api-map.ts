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
  /**
   * @plan:PLAN-20260622-COREAPIGAP.P17
   * @requirement:REQ-008
   * @pseudocode command-map.md lines 1-13
   */
  {
    command: '/approval-mode',
    kind: 'runtime',
    target: 'agent.setApprovalMode',
    note: 'Approval mode is a live engine setting on the active run',
  },
  {
    command: '/policies',
    kind: 'runtime',
    target: 'agent.policy.getRules',
    note: 'Policy inspection reads the active run policy engine',
  },
  {
    command: '/task',
    kind: 'runtime',
    target: 'agent.tasks.list',
    note: 'Async task list/inspect/cancel over the active run task manager',
  },
  {
    command: '/hooks',
    kind: 'runtime',
    target: 'agent.hooks.listHooks',
    note: 'Hook registry inspection + enable/disable on the active run',
  },
  {
    command: '/toolkey',
    kind: 'runtime',
    target: 'agent.tools.keys.save',
    note: 'Built-in tool key storage feeds the active run tools',
  },
  {
    command: '/toolkeyfile',
    kind: 'runtime',
    target: 'agent.tools.keys.setKeyFile',
    note: 'Built-in tool keyfile path feeds the active run tools',
  },
  // ---- Phase 2 (#2203): close classification gaps ----
  {
    command: '/baseurl',
    kind: 'runtime',
    target: 'agent.auth.setBaseUrl',
    note: 'Base URL affects the active provider auth endpoint',
  },
  {
    command: '/logout',
    kind: 'runtime',
    target: 'agent.auth.logout',
    note: 'Logout clears the active provider auth credentials',
  },
  {
    command: '/continue',
    kind: 'runtime',
    target: 'agent.session.resume',
    note: 'Resume feeds the live conversation context from a checkpoint',
  },
  {
    command: '/set',
    kind: 'runtime',
    target: 'agent.setEphemeralSetting',
    note: 'Ephemeral settings affect the active run configuration',
  },
  {
    command: '/dumpcontext',
    kind: 'runtime',
    target: 'agent.getHistory',
    note: 'Context dump reads the live conversation state for debugging',
  },
  {
    command: '/mcp list',
    kind: 'runtime',
    target: 'agent.mcp.listServers',
    note: 'Listing MCP servers reflects the live runtime connection set',
  },
  {
    command: '/mcp refresh',
    kind: 'runtime',
    target: 'agent.mcp.refresh',
    note: 'Refreshing MCP discovery affects the live runtime tool set',
  },
  {
    command: '/chat list',
    kind: 'runtime',
    target: 'agent.session.listCheckpoints',
    note: 'Listing checkpoints reflects the live session state',
  },
  {
    command: '/profile load',
    kind: 'runtime',
    target: 'agent.profiles.apply',
    note: 'Loading a profile rebinds the active runtime',
  },
  {
    command: '/profile show',
    kind: 'runtime',
    target: 'agent.profiles.get',
    note: 'Showing a profile reflects the active runtime config',
  },
  {
    command: '/profile set-default',
    kind: 'runtime',
    target: 'agent.profiles.setDefault',
    note: 'Default profile affects the active run on next startup',
  },
  {
    command: '/memory add',
    kind: 'runtime',
    target: 'agent.updateSystemInstruction',
    note: 'Adding memory content affects the live system instruction',
  },
  {
    command: '/memory list',
    kind: 'runtime',
    target: 'agent.updateSystemInstruction',
    note: 'Listing memory reflects the live system instruction sources',
  },
  {
    command: '/diagnostics',
    kind: 'subpath',
    target: APP_SERVICE_SUBPATH,
    exportName: 'getDiagnostics',
    note: 'Diagnostics is durable app-service metadata',
  },
  // cli-local: pure UI / dialog commands with no core runtime dependency
  {
    command: '/bug',
    kind: 'cli-local',
    target: 'bug report (UI)',
    note: 'Opens a bug-report dialog; no core dependency',
  },
  {
    command: '/copy',
    kind: 'cli-local',
    target: 'copy to clipboard (UI)',
    note: 'Pure UI clipboard operation',
  },
  {
    command: '/docs',
    kind: 'cli-local',
    target: 'open docs (UI)',
    note: 'Opens documentation; pure UI',
  },
  {
    command: '/privacy',
    kind: 'cli-local',
    target: 'privacy dialog (UI)',
    note: 'Privacy settings dialog; pure UI',
  },
  {
    command: '/mouse',
    kind: 'cli-local',
    target: 'mouse toggle (UI)',
    note: 'UI rendering toggle; pure UI',
  },
  {
    command: '/vim',
    kind: 'cli-local',
    target: 'vim toggle (UI)',
    note: 'UI input mode toggle; pure UI',
  },
  {
    command: '/uiprofile',
    kind: 'cli-local',
    target: 'UI profile (UI)',
    note: 'UI-only profile management; pure UI',
  },
  {
    command: '/terminal-setup',
    kind: 'cli-local',
    target: 'terminal setup (UI)',
    note: 'Terminal shell integration setup; pure UI',
  },
  {
    command: '/setup',
    kind: 'cli-local',
    target: 'setup wizard (UI)',
    note: 'First-run setup wizard; pure UI',
  },
  {
    command: '/setup-github',
    kind: 'cli-local',
    target: 'GitHub setup (UI)',
    note: 'GitHub Actions setup; pure UI',
  },
  {
    command: '/editor',
    kind: 'cli-local',
    target: 'editor dialog (UI)',
    note: 'Editor settings dialog; pure UI',
  },
  {
    command: '/toolformat',
    kind: 'cli-local',
    target: 'tool format toggle (UI)',
    note: 'Tool display format setting; pure UI',
  },
  {
    command: '/logging',
    kind: 'cli-local',
    target: 'logging dialog (UI)',
    note: 'Logging viewer dialog; pure UI',
  },
  {
    command: '/debug',
    kind: 'cli-local',
    target: 'debug toggle (UI)',
    note: 'Debug profiler toggle; pure UI',
  },
  {
    command: '/permissions',
    kind: 'cli-local',
    target: 'permissions dialog (UI)',
    note: 'Permissions viewer dialog; pure UI',
  },
  {
    command: '/init',
    kind: 'cli-local',
    target: 'project init (UI)',
    note: 'Creates project config files; CLI-local',
  },
  {
    command: '/todo',
    kind: 'cli-local',
    target: 'todo list (UI)',
    note: 'Session-local todo management; pure UI state',
  },
  {
    command: '/settings',
    kind: 'cli-local',
    target: 'settings dialog (UI)',
    note: 'Settings dialog open; mutations route via settings mutation subpath',
  },
  {
    command: '/subagent',
    kind: 'cli-local',
    target: 'subagent dialog (UI)',
    note: 'Subagent management dialog; durable ops via subagent CRUD',
  },
  {
    command: '/subagent save',
    kind: 'cli-local',
    target: 'subagent save dialog (UI)',
    note: 'Subagent save dialog; durable config managed by SubagentManager',
  },
  {
    command: '/subagent list',
    kind: 'cli-local',
    target: 'subagent list dialog (UI)',
    note: 'Subagent list dialog; pure UI',
  },
  {
    command: '/subagent show',
    kind: 'cli-local',
    target: 'subagent show dialog (UI)',
    note: 'Subagent detail dialog; pure UI',
  },
  {
    command: '/subagent delete',
    kind: 'cli-local',
    target: 'subagent delete dialog (UI)',
    note: 'Subagent delete dialog; durable config managed by SubagentManager',
  },
  {
    command: '/subagent edit',
    kind: 'cli-local',
    target: 'subagent edit dialog (UI)',
    note: 'Subagent edit dialog; durable config managed by SubagentManager',
  },
  {
    command: '/subagent create',
    kind: 'cli-local',
    target: 'subagent create dialog (UI)',
    note: 'Subagent create dialog; durable config managed by SubagentManager',
  },
  {
    command: '/subagent menu',
    kind: 'cli-local',
    target: 'subagent menu dialog (UI)',
    note: 'Subagent menu dialog; pure UI',
  },
  {
    command: '/mcp',
    kind: 'cli-local',
    target: 'MCP default list (UI)',
    note: 'Default action shows server list; mutations via /mcp add/remove subpaths',
  },
  {
    command: '/profile',
    kind: 'cli-local',
    target: 'profile menu (UI)',
    note: 'Default action shows profile list; mutations via /profile save/delete subpaths',
  },
  {
    command: '/profile create',
    kind: 'cli-local',
    target: 'profile create dialog (UI)',
    note: 'Profile creation dialog; durable config via /profile save subpath',
  },
  {
    command: '/profile edit',
    kind: 'cli-local',
    target: 'profile edit dialog (UI)',
    note: 'Profile edit dialog; durable config via /profile save subpath',
  },
  {
    command: '/memory',
    kind: 'cli-local',
    target: 'memory list (UI)',
    note: 'Default action lists memory; show/add variants are runtime',
  },
  {
    command: '/chat',
    kind: 'cli-local',
    target: 'chat management (UI)',
    note: 'Default action shows checkpoint list; save/resume/clear are runtime',
  },
  {
    command: '/chat tag',
    kind: 'runtime',
    target: 'agent.session.createCheckpoint',
    note: 'Tagging a checkpoint is tied to the live agent snapshot',
  },
  {
    command: '/chat delete',
    kind: 'runtime',
    target: 'agent.session.listCheckpoints',
    note: 'Deleting a checkpoint mutates live session state',
  },
  {
    command: '/chat rename',
    kind: 'runtime',
    target: 'agent.session.createCheckpoint',
    note: 'Renaming a checkpoint mutates live session state',
  },
  {
    command: '/chat restore',
    kind: 'runtime',
    target: 'agent.restoreHistory',
    note: 'Restoring a checkpoint feeds the live conversation context',
  },
  {
    command: '/chat debug',
    kind: 'cli-local',
    target: 'chat debug info (UI)',
    note: 'Debug info display; pure UI',
  },
  {
    command: '/memory refresh',
    kind: 'runtime',
    target: 'agent.updateSystemInstruction',
    note: 'Refreshing memory re-reads the live system instruction sources',
  },
  // Subcommands inheriting parent classification (#2203 completeness)
  {
    command: '/directory add',
    kind: 'runtime',
    target: 'agent.addDirectoryContext',
    note: 'Adding directory context feeds the next live turn',
  },
  {
    command: '/directory show',
    kind: 'runtime',
    target: 'agent.addDirectoryContext',
    note: 'Showing directory context reflects the active context set',
  },
  {
    command: '/extensions list',
    kind: 'subpath',
    target: APP_SERVICE_SUBPATH,
    exportName: 'manageExtensions',
    note: 'Listing extensions reads durable app-service state',
  },
  {
    command: '/extensions update',
    kind: 'subpath',
    target: APP_SERVICE_SUBPATH,
    exportName: 'manageExtensions',
    note: 'Updating extensions mutates durable app-service state',
  },
  {
    command: '/extensions restart',
    kind: 'runtime',
    target: 'agent.mcp.refresh',
    note: 'Restarting an extension reloads the live runtime tool set',
  },
  {
    command: '/extensions install',
    kind: 'subpath',
    target: APP_SERVICE_SUBPATH,
    exportName: 'manageExtensions',
    note: 'Installing extensions mutates durable app-service state',
  },
  {
    command: '/extensions uninstall',
    kind: 'subpath',
    target: APP_SERVICE_SUBPATH,
    exportName: 'manageExtensions',
    note: 'Uninstalling extensions mutates durable app-service state',
  },
  {
    command: '/logging status',
    kind: 'cli-local',
    target: 'logging status (UI)',
    note: 'Logging status display; pure UI',
  },
  {
    command: '/logging enable',
    kind: 'cli-local',
    target: 'logging enable (UI)',
    note: 'Logging enable toggle; pure UI',
  },
  {
    command: '/logging disable',
    kind: 'cli-local',
    target: 'logging disable (UI)',
    note: 'Logging disable toggle; pure UI',
  },
  {
    command: '/logging redaction',
    kind: 'cli-local',
    target: 'logging redaction (UI)',
    note: 'Logging redaction setting; pure UI',
  },
  {
    command: '/logging show',
    kind: 'cli-local',
    target: 'logging show (UI)',
    note: 'Logging viewer display; pure UI',
  },
  {
    command: '/stats session',
    kind: 'runtime',
    target: 'agent.getStats',
    note: 'Session stats reflect the live conversation token usage',
  },
  {
    command: '/stats model',
    kind: 'runtime',
    target: 'agent.getStats',
    note: 'Model stats reflect the live conversation usage',
  },
  {
    command: '/stats tools',
    kind: 'runtime',
    target: 'agent.getStats',
    note: 'Tool stats reflect the live conversation usage',
  },
  {
    command: '/stats cache',
    kind: 'runtime',
    target: 'agent.getStats',
    note: 'Cache stats reflect the live conversation usage',
  },
  {
    command: '/stats quota',
    kind: 'runtime',
    target: 'agent.getStats',
    note: 'Quota stats reflect the live provider quota',
  },
  {
    command: '/stats buckets',
    kind: 'runtime',
    target: 'agent.getStats',
    note: 'Bucket stats reflect the live auth state',
  },
  {
    command: '/stats lb',
    kind: 'runtime',
    target: 'agent.getStats',
    note: 'Load-balancer stats reflect the live provider routing',
  },
  {
    command: '/debug enable',
    kind: 'cli-local',
    target: 'debug enable (UI)',
    note: 'Debug mode toggle; pure UI',
  },
  {
    command: '/debug disable',
    kind: 'cli-local',
    target: 'debug disable (UI)',
    note: 'Debug mode toggle; pure UI',
  },
  {
    command: '/debug level',
    kind: 'cli-local',
    target: 'debug level (UI)',
    note: 'Debug level setting; pure UI',
  },
  {
    command: '/debug output',
    kind: 'cli-local',
    target: 'debug output (UI)',
    note: 'Debug output destination; pure UI',
  },
  {
    command: '/debug persist',
    kind: 'cli-local',
    target: 'debug persist (UI)',
    note: 'Debug persistence toggle; pure UI',
  },
  {
    command: '/debug status',
    kind: 'cli-local',
    target: 'debug status (UI)',
    note: 'Debug status display; pure UI',
  },
  {
    command: '/todo clear',
    kind: 'cli-local',
    target: 'todo clear (UI)',
    note: 'Session-local todo management; pure UI state',
  },
  {
    command: '/todo show',
    kind: 'cli-local',
    target: 'todo show (UI)',
    note: 'Session-local todo display; pure UI state',
  },
  {
    command: '/todo set',
    kind: 'cli-local',
    target: 'todo set (UI)',
    note: 'Session-local todo set; pure UI state',
  },
  {
    command: '/todo unset',
    kind: 'cli-local',
    target: 'todo unset (UI)',
    note: 'Session-local todo unset; pure UI state',
  },
  {
    command: '/todo add',
    kind: 'cli-local',
    target: 'todo add (UI)',
    note: 'Session-local todo add; pure UI state',
  },
  {
    command: '/todo remove',
    kind: 'cli-local',
    target: 'todo remove (UI)',
    note: 'Session-local todo remove; pure UI state',
  },
  {
    command: '/todo delete',
    kind: 'cli-local',
    target: 'todo delete (UI)',
    note: 'Session-local todo delete; pure UI state',
  },
  {
    command: '/todo undo',
    kind: 'cli-local',
    target: 'todo undo (UI)',
    note: 'Session-local todo undo; pure UI state',
  },
  {
    command: '/todo list',
    kind: 'cli-local',
    target: 'todo list (UI)',
    note: 'Session-local todo list; pure UI state',
  },
  {
    command: '/todo load',
    kind: 'cli-local',
    target: 'todo load (UI)',
    note: 'Session-local todo load; pure UI state',
  },
  {
    command: '/task list',
    kind: 'runtime',
    target: 'agent.tasks.list',
    note: 'Async task list over the active run task manager',
  },
  {
    command: '/task end',
    kind: 'runtime',
    target: 'agent.tasks.cancel',
    note: 'Cancelling an async task affects the active run',
  },
];
