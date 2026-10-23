# Issue #3937: /mcp reload fails in the interactive CLI

## Problem

`/mcp reload` in the interactive CLI always fails with
`MCP server reload is not available in this composition.`

## Root cause

`McpRuntimeOwner.reload()` (packages/agents/src/api/mcpRuntimeAssembly.ts)
rejects when the runtime has no `SessionMcpSettingsReads` binding.

The CLI binds MCP settings on the session settings owner during config
load (`bindSelectedMcpSettings` in packages/cli/src/config/config.ts).
`createForegroundAgent` (packages/cli/src/cliAgentBootstrap.ts) builds the
foreground `McpRuntimeOwner` directly with `McpRuntimeOwner.create(...)` and
omits the final `mcpSettings` construction input. The agents-side
`assembleMcpRuntime` passes `settingsOwner?.readMcpSettingsBinding()`, but
the interactive CLI does not use that path.

The regression came from #3842, which moved MCP settings ownership to
`SessionSettingsOwner` without wiring the foreground CLI composition.

## Fix

Pass `settingsOwner.readMcpSettingsBinding()` as the `mcpSettings` input
when `createForegroundAgent` constructs the foreground `McpRuntimeOwner`.

A local prototype of this change was verified in tmux. It handled four
cases: an empty startup config with a server added later, a renamed server,
removal of all servers, and `/mcp list` parity after each step.

## Tests (test-first, behavioral, bun:test)

Location: packages/cli/src (next to cliAgentBootstrap / foreground tests).

Drive the real `createForegroundAgent` with a real `SessionSettingsOwner`
whose MCP settings binding loads from a mutable source (or the real
`loadCliConfig` loader against a temp workspace settings file). Use a real
stdio MCP fixture server so reconcile actually starts and stops processes.

1. Empty startup config, server added, then `agent.mcp.reload()`:
   resolves, and `agent.mcp.listServers()` contains the added server.
2. Server renamed, then reload: the old name is gone and the new name is
   present.
3. All servers removed, then reload: `listServers()` is empty.

Each test must fail on main with the "not available in this composition"
rejection and pass after the fix.

## Interactive evidence (tmux harness)

`tmux-script.issue3937-mcp-reload.json` (this directory) drives the real
interactive CLI. It edits `.llxprt/settings.json` through the CLI's own `!cp`
shell mode, so the change happens inside the live session. Workspace setup:

```bash
W=$(mktemp -d); mkdir -p "$W/.llxprt"; cd "$W"; git init -q
ln -s <repo> llxprt-src
echo '{}' > .llxprt/settings.json; echo '{}' > settings.empty.json
F=llxprt-src/packages/cli/src/__tests__/mcp-reload-stdio-fixture.ts
printf '{"mcpServers":{"alpha":{"command":"bun","args":["%s","alpha.pid","alpha_tool"],"trust":true}}}' $F > settings.added.json
printf '{"mcpServers":{"beta":{"command":"bun","args":["%s","beta.pid","beta_tool"],"trust":true}}}' $F > settings.renamed.json
bun llxprt-src/scripts/tmux-harness.ts --script <repo>/project-plans/issue3937/tmux-script.issue3937-mcp-reload.json
```

The start command loads profile `gpt-6-luna`. No model call is made, but the
profile has to exist locally; change it to one of your own if needed.

The app clears tmux scrollback on re-render, so whole-run counts come from the
harness's `pane-output.log`, not from scrollback.

## Follow-up

- #3939: the status-bar MCP server count does not re-render after a reload
  changes the server set. It is cosmetic and separate from this fix.

## Verification

- npm run test / lint / typecheck / format / build
- smoke: bun scripts/start.ts --profile-load <available profile> "write me a haiku and nothing else"
- tmux evidence: interactive `/mcp list` and `/mcp reload` across
  empty, added, renamed and removed config states.
