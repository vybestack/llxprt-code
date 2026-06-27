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

/** Compact factory for a `runtime` entry. */
const runtime = (
  command: string,
  target: string,
  note: string,
): CommandApiMapping => ({
  command,
  kind: 'runtime',
  target,
  note,
});

/** Compact factory for a `cli-local` entry. */
const cliLocal = (
  command: string,
  target: string,
  note: string,
): CommandApiMapping => ({
  command,
  kind: 'cli-local',
  target,
  note,
});

/** Compact factory for a `subpath` entry. */
const subpath = (
  command: string,
  exportName: string,
  note: string,
): CommandApiMapping => ({
  command,
  kind: 'subpath',
  target: APP_SERVICE_SUBPATH,
  exportName,
  note,
});

export const COMMAND_API_MAP: readonly CommandApiMapping[] = [
  runtime(
    '/auth',
    'agent.auth.login',
    'OAuth/key login affects the active provider run',
  ),
  runtime(
    '/key',
    'agent.auth.keys',
    'API key store feeds the active runtime auth',
  ),
  runtime(
    '/keyfile',
    'agent.auth',
    'Keyfile path feeds the active runtime auth',
  ),
  runtime(
    '/provider',
    'agent.setProvider',
    'Switching the live provider affects the active turn',
  ),
  runtime(
    '/model',
    'agent.setModel',
    'Switching the live model affects the active turn',
  ),
  runtime(
    '/profile load',
    'agent.profiles.apply',
    'Loading a profile rebinds the active runtime',
  ),
  subpath(
    '/profile save',
    'saveCurrentProfile',
    'Persisting a profile is durable config, not live state',
  ),
  subpath(
    '/profile list',
    'listProfiles',
    'Listing profiles reads durable config',
  ),
  subpath(
    '/profile delete',
    'deleteProfile',
    'Deleting a profile mutates durable config',
  ),
  runtime(
    '/compress',
    'agent.compress',
    'Compression operates on the live conversation history',
  ),
  runtime(
    '/mcp list',
    'agent.mcp.listServers',
    'MCP listing reflects the live runtime connection set',
  ),
  runtime(
    '/mcp auth',
    'agent.mcp.auth',
    'MCP OAuth affects the live runtime connection',
  ),
  subpath(
    '/mcp add',
    'addMcpServer',
    'Adding an MCP server is durable config, not live mutation',
  ),
  subpath(
    '/mcp remove',
    'removeMcpServer',
    'Removing an MCP server is durable config, not live mutation',
  ),
  runtime(
    '/restore',
    'agent.restoreHistory',
    'Restoring history feeds the live conversation context',
  ),
  runtime(
    '/chat save',
    'agent.session.createCheckpoint',
    'Checkpointing the session is tied to the live agent snapshot',
  ),
  runtime(
    '/chat resume',
    'agent.session.resume',
    'Resuming a session feeds the live conversation context',
  ),
  runtime(
    '/chat clear',
    'agent.resetChat',
    'Clearing chat resets the live conversation',
  ),
  runtime(
    '/tools',
    'agent.tools.list',
    'Listing tools reflects the live runtime tool registry',
  ),
  runtime(
    '/directory',
    'agent.addDirectoryContext',
    'Directory context feeds the next live turn',
  ),
  cliLocal(
    '/memory show',
    'memory show (UI)',
    'Memory display is CLI-local; updates route via runtime',
  ),
  subpath(
    '/memory edit',
    'editMemory',
    'Durable memory-file edits persist beyond the live run',
  ),
  subpath(
    '/skills',
    'manageSkills',
    'Skill config is durable app-service state',
  ),
  subpath(
    '/extensions',
    'manageExtensions',
    'Extension config is durable app-service state',
  ),
  runtime(
    '/ide',
    'agent.ide.status',
    'IDE status reflects the live runtime integration',
  ),
  runtime(
    '/stats',
    'agent.getStats',
    'Stats reflect the live conversation token usage',
  ),
  subpath(
    '/about',
    'getAbout',
    'About/diagnostics is durable app-service metadata',
  ),
  subpath(
    'settings mutation',
    'mutateSettings',
    'Persisting settings is durable config, not live state',
  ),
  subpath(
    'diagnostics',
    'getDiagnostics',
    'Diagnostics is durable app-service metadata',
  ),
  cliLocal(
    'completions:prompt',
    'prompt completion (UI)',
    'Loading stays CLI-local; the prompt action maps to a runtime turn',
  ),
  cliLocal(
    'completions:command',
    'command completion (UI)',
    'Command discovery/loading stays CLI-local per §4.7 decision (a)',
  ),
  cliLocal(
    'completions:at-command',
    'at-command completion (UI)',
    'At-command completion is pure UI; actions resolve to runtime/subpath',
  ),
  cliLocal(
    'completions:mcp-prompt',
    'MCP prompt completion (UI)',
    'MCP prompt listing is CLI-local; execution routes to the runtime',
  ),
  cliLocal('/help', 'help rendering (UI)', 'Pure UI with no core dependency'),
  cliLocal('/clear', 'screen clear (UI)', 'Pure UI with no core dependency'),
  cliLocal('/theme', 'theme switching (UI)', 'Pure UI with no core dependency'),
  cliLocal('/quit', 'exit (UI)', 'Pure UI with no core dependency'),
  /** @plan:PLAN-20260622-COREAPIGAP.P17 @requirement:REQ-008 */
  runtime(
    '/approval-mode',
    'agent.setApprovalMode',
    'Approval mode is a live engine setting on the active run',
  ),
  runtime(
    '/policies',
    'agent.policy.getRules',
    'Policy inspection reads the active run policy engine',
  ),
  runtime(
    '/task',
    'agent.tasks.list',
    'Async task list/inspect/cancel over the active run task manager',
  ),
  runtime(
    '/hooks',
    'agent.hooks.listHooks',
    'Hook registry inspection + enable/disable on the active run',
  ),
  runtime(
    '/toolkey',
    'agent.tools.keys.save',
    'Built-in tool key storage feeds the active run tools',
  ),
  runtime(
    '/toolkeyfile',
    'agent.tools.keys.setKeyFile',
    'Built-in tool keyfile path feeds the active run tools',
  ),
  // ---- Phase 2 (#2203): close classification gaps ----
  runtime(
    '/baseurl',
    'agent.auth.setBaseUrl',
    'Base URL affects the active provider auth endpoint',
  ),
  runtime(
    '/logout',
    'agent.auth.logout',
    'Logout clears the active provider auth credentials',
  ),
  runtime(
    '/continue',
    'agent.session.resume',
    'Resume feeds the live conversation context from a checkpoint',
  ),
  runtime(
    '/set',
    'agent.setEphemeralSetting',
    'Ephemeral settings affect the active run configuration',
  ),
  runtime(
    '/dumpcontext',
    'agent.getHistory',
    'Context dump reads the live conversation state for debugging',
  ),
  runtime(
    '/mcp refresh',
    'agent.mcp.refresh',
    'Refreshing MCP discovery affects the live runtime tool set',
  ),
  runtime(
    '/chat list',
    'agent.session.listCheckpoints',
    'Listing checkpoints reflects the live session state',
  ),
  runtime(
    '/profile show',
    'agent.profiles.get',
    'Showing a profile reflects the active runtime config',
  ),
  runtime(
    '/profile set-default',
    'agent.profiles.setDefault',
    'Default profile affects the active run on next startup',
  ),
  runtime(
    '/memory add',
    'agent.updateSystemInstruction',
    'Adding memory content affects the live system instruction',
  ),
  cliLocal(
    '/memory list',
    'memory list (UI)',
    'Memory listing is CLI-local; updates route via runtime',
  ),
  subpath(
    '/diagnostics',
    'getDiagnostics',
    'Diagnostics is durable app-service metadata',
  ),
  // cli-local: pure UI / dialog commands with no core runtime dependency
  cliLocal(
    '/bug',
    'bug report (UI)',
    'Opens a bug-report dialog; no core dependency',
  ),
  cliLocal('/copy', 'copy to clipboard (UI)', 'Pure UI clipboard operation'),
  cliLocal('/docs', 'open docs (UI)', 'Opens documentation; pure UI'),
  cliLocal(
    '/privacy',
    'privacy dialog (UI)',
    'Privacy settings dialog; pure UI',
  ),
  cliLocal('/mouse', 'mouse toggle (UI)', 'UI rendering toggle; pure UI'),
  cliLocal('/vim', 'vim toggle (UI)', 'UI input mode toggle; pure UI'),
  cliLocal(
    '/uiprofile',
    'UI profile (UI)',
    'UI-only profile management; pure UI',
  ),
  cliLocal(
    '/terminal-setup',
    'terminal setup (UI)',
    'Terminal shell integration setup; pure UI',
  ),
  cliLocal('/setup', 'setup wizard (UI)', 'First-run setup wizard; pure UI'),
  cliLocal(
    '/setup-github',
    'GitHub setup (UI)',
    'GitHub Actions setup; pure UI',
  ),
  cliLocal('/editor', 'editor dialog (UI)', 'Editor settings dialog; pure UI'),
  cliLocal(
    '/toolformat',
    'tool format toggle (UI)',
    'Tool display format setting; pure UI',
  ),
  cliLocal('/logging', 'logging dialog (UI)', 'Logging viewer dialog; pure UI'),
  cliLocal('/debug', 'debug toggle (UI)', 'Debug profiler toggle; pure UI'),
  cliLocal(
    '/permissions',
    'permissions dialog (UI)',
    'Permissions viewer dialog; pure UI',
  ),
  cliLocal(
    '/init',
    'project init (UI)',
    'Creates project config files; CLI-local',
  ),
  cliLocal(
    '/todo',
    'todo list (UI)',
    'Session-local todo management; pure UI state',
  ),
  cliLocal(
    '/settings',
    'settings dialog (UI)',
    'Settings dialog open; mutations route via settings mutation subpath',
  ),
  cliLocal(
    '/subagent',
    'subagent dialog (UI)',
    'Subagent management dialog; durable ops via subagent CRUD',
  ),
  cliLocal(
    '/subagent save',
    'subagent save dialog (UI)',
    'Subagent save dialog; durable config managed by SubagentManager',
  ),
  cliLocal(
    '/subagent list',
    'subagent list dialog (UI)',
    'Subagent list dialog; pure UI',
  ),
  cliLocal(
    '/subagent show',
    'subagent show dialog (UI)',
    'Subagent detail dialog; pure UI',
  ),
  cliLocal(
    '/subagent delete',
    'subagent delete dialog (UI)',
    'Subagent delete dialog; durable config managed by SubagentManager',
  ),
  cliLocal(
    '/subagent edit',
    'subagent edit dialog (UI)',
    'Subagent edit dialog; durable config managed by SubagentManager',
  ),
  cliLocal(
    '/subagent create',
    'subagent create dialog (UI)',
    'Subagent create dialog; durable config managed by SubagentManager',
  ),
  cliLocal(
    '/subagent menu',
    'subagent menu dialog (UI)',
    'Subagent menu dialog; pure UI',
  ),
  cliLocal(
    '/mcp',
    'MCP default list (UI)',
    'Default action shows server list; mutations via /mcp add/remove subpaths',
  ),
  cliLocal(
    '/profile',
    'profile menu (UI)',
    'Default action shows profile list; mutations via /profile save/delete subpaths',
  ),
  cliLocal(
    '/profile create',
    'profile create dialog (UI)',
    'Profile creation dialog; durable config via /profile save subpath',
  ),
  cliLocal(
    '/profile edit',
    'profile edit dialog (UI)',
    'Profile edit dialog; durable config via /profile save subpath',
  ),
  cliLocal(
    '/memory',
    'memory list (UI)',
    'Default action lists memory; show/add variants are runtime',
  ),
  cliLocal(
    '/chat',
    'chat management (UI)',
    'Default action shows checkpoint list; save/resume/clear are runtime',
  ),
  runtime(
    '/chat tag',
    'agent.session.createCheckpoint',
    'Tagging a checkpoint is tied to the live agent snapshot',
  ),
  cliLocal(
    '/chat delete',
    'chat delete (UI)',
    'Checkpoint deletion is CLI-local; no Agent deleteCheckpoint surface yet',
  ),
  cliLocal(
    '/chat rename',
    'chat rename (UI)',
    'Checkpoint rename is CLI-local; no Agent renameCheckpoint surface yet',
  ),
  runtime(
    '/chat restore',
    'agent.restoreHistory',
    'Restoring a checkpoint feeds the live conversation context',
  ),
  cliLocal(
    '/chat debug',
    'chat debug info (UI)',
    'Debug info display; pure UI',
  ),
  runtime(
    '/memory refresh',
    'agent.updateSystemInstruction',
    'Refreshing memory re-reads the live system instruction sources',
  ),
  // Subcommands inheriting parent classification (#2203 completeness)
  runtime(
    '/directory add',
    'agent.addDirectoryContext',
    'Adding directory context feeds the next live turn',
  ),
  cliLocal(
    '/directory show',
    'directory show (UI)',
    'Directory display is CLI-local; add routes via runtime',
  ),
  subpath(
    '/extensions list',
    'manageExtensions',
    'Listing extensions reads durable app-service state',
  ),
  subpath(
    '/extensions update',
    'manageExtensions',
    'Updating extensions mutates durable app-service state',
  ),
  cliLocal(
    '/extensions restart',
    'extension restart (UI)',
    'Extension restart handled by extension manager; no Agent surface yet',
  ),
  subpath(
    '/extensions install',
    'manageExtensions',
    'Installing extensions mutates durable app-service state',
  ),
  subpath(
    '/extensions uninstall',
    'manageExtensions',
    'Uninstalling extensions mutates durable app-service state',
  ),
  cliLocal(
    '/logging status',
    'logging status (UI)',
    'Logging status display; pure UI',
  ),
  cliLocal(
    '/logging enable',
    'logging enable (UI)',
    'Logging enable toggle; pure UI',
  ),
  cliLocal(
    '/logging disable',
    'logging disable (UI)',
    'Logging disable toggle; pure UI',
  ),
  cliLocal(
    '/logging redaction',
    'logging redaction (UI)',
    'Logging redaction setting; pure UI',
  ),
  cliLocal(
    '/logging show',
    'logging show (UI)',
    'Logging viewer display; pure UI',
  ),
  runtime(
    '/stats session',
    'agent.getStats',
    'Session stats reflect the live conversation token usage',
  ),
  runtime(
    '/stats model',
    'agent.getStats',
    'Model stats reflect the live conversation usage',
  ),
  runtime(
    '/stats tools',
    'agent.getStats',
    'Tool stats reflect the live conversation usage',
  ),
  runtime(
    '/stats cache',
    'agent.getStats',
    'Cache stats reflect the live conversation usage',
  ),
  runtime(
    '/stats quota',
    'agent.getStats',
    'Quota stats reflect the live provider quota',
  ),
  runtime(
    '/stats buckets',
    'agent.getStats',
    'Bucket stats reflect the live auth state',
  ),
  runtime(
    '/stats lb',
    'agent.getStats',
    'Load-balancer stats reflect the live provider routing',
  ),
  cliLocal('/debug enable', 'debug enable (UI)', 'Debug mode toggle; pure UI'),
  cliLocal(
    '/debug disable',
    'debug disable (UI)',
    'Debug mode toggle; pure UI',
  ),
  cliLocal('/debug level', 'debug level (UI)', 'Debug level setting; pure UI'),
  cliLocal(
    '/debug output',
    'debug output (UI)',
    'Debug output destination; pure UI',
  ),
  cliLocal(
    '/debug persist',
    'debug persist (UI)',
    'Debug persistence toggle; pure UI',
  ),
  cliLocal(
    '/debug status',
    'debug status (UI)',
    'Debug status display; pure UI',
  ),
  cliLocal(
    '/todo clear',
    'todo clear (UI)',
    'Session-local todo management; pure UI state',
  ),
  cliLocal(
    '/todo show',
    'todo show (UI)',
    'Session-local todo display; pure UI state',
  ),
  cliLocal(
    '/todo set',
    'todo set (UI)',
    'Session-local todo set; pure UI state',
  ),
  cliLocal(
    '/todo unset',
    'todo unset (UI)',
    'Session-local todo unset; pure UI state',
  ),
  cliLocal(
    '/todo add',
    'todo add (UI)',
    'Session-local todo add; pure UI state',
  ),
  cliLocal(
    '/todo remove',
    'todo remove (UI)',
    'Session-local todo remove; pure UI state',
  ),
  cliLocal(
    '/todo delete',
    'todo delete (UI)',
    'Session-local todo delete; pure UI state',
  ),
  cliLocal(
    '/todo undo',
    'todo undo (UI)',
    'Session-local todo undo; pure UI state',
  ),
  cliLocal(
    '/todo list',
    'todo list (UI)',
    'Session-local todo list; pure UI state',
  ),
  cliLocal(
    '/todo load',
    'todo load (UI)',
    'Session-local todo load; pure UI state',
  ),
  runtime(
    '/task list',
    'agent.tasks.list',
    'Async task list over the active run task manager',
  ),
  runtime(
    '/task end',
    'agent.tasks.cancel',
    'Cancelling an async task affects the active run',
  ),
];
