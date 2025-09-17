# Cherry-pick Execution Plan (v2): gemini-cli v0.4.1 → llxprt-code

**Branch Target:** 0.3.4 → 0.4.1 sync  
**Generated:** 2025-09-17 (recreated post-reset)

This plan replaces the original 20250916 schedule. Ignore the legacy `project-plans/20250916-cherries/` files created before the reset; they are retained only for forensic reference. Follow it sequentially; do not reorder tasks. Every task ends by running the automated quality gate.

## Common Ground Rules

1. Work on the dedicated sync branch (e.g., `20250916-gmerge`). Never cherry-pick on `main`.
2. Before starting a task, ensure the working tree is clean and no merges are in progress.
3. Use `git cherry-pick -x` for every commit to retain upstream references.
4. Document each task in its dedicated results file (see template) and run the quality gate script before moving on.
5. If the script fails, fix the issue immediately; do **not** proceed.
6. Keep logs under `project-plans/20250916-cherries-v2/.quality-logs/` for auditability.

## Quality Gate Script

```bash
./project-plans/20250916-cherries-v2/run-quality-gates.sh <results-file>
```

- Validates required sections in the results file.
- Kills stray `vitest` processes.
- Runs tests, lint (`lint:ci`), typecheck, build, and format check.
- Exits non-zero on any failure or unresolved merge conflict.

A reusable template for results documentation lives at `project-plans/20250916-cherries-v2/RESULTS-TEMPLATE.md`.

## Codex Verification (Claude-assisted)

After the quality gate passes, instruct Claude to run Codex with a 10-minute shell timeout to audit the task. Use this command template (replace placeholders):

```bash
CLAUDE_PROMPT=$(cat <<'PROMPT'
codex exec "Evaluate the cherry-pick task results in [RESULTS_FILE_PATH]. Check:
  1. Were ALL commits listed in the task file actually cherry-picked? Use \"git log --oneline -n [N]\" to verify. List any missing commits.
  2. Review the actual code changes with \"git diff HEAD~[N]\" - do they match what the task intended? Check for:
     - Unauthorized settings migrations or schema changes
     - Package name changes beyond @vybestack/llxprt-code-core replacements
     - Removal of multi-provider support code
     - Addition of Gemini-specific code that breaks provider abstraction
  3. Did the quality gate script pass? Check the log file at [LOG_FILE_PATH] for any failures.
  4. Run "npm test" and verify ZERO test failures. List all failing tests if any.
  5. Run "npm run lint" and "npm run typecheck" - must have ZERO errors.
  6. Check "git status" - working tree MUST be clean with no uncommitted changes.
  7. Does the results file document all conflicts and resolutions?

  VERDICT: Provide one of these EXACT responses:
  - 'DO NOT CONTINUE. YOU MUST FIX: [specific issues]' if ANY check fails
  - 'THIS PASSED. YOU MAY PROCEED TO NEXT TASK' if ALL checks pass

  Be extremely critical. Any test failure, lint error, or unauthorized change means DO NOT CONTINUE."
PROMPT
)
claude --dangerously-bypass-approvals-and-sandbox \
  -C "$REPO_ROOT" \
  exec --timeout 600000 "$CLAUDE_PROMPT"
```

- Set `[RESULTS_FILE_PATH]` to `project-plans/20250916-cherries-v2/results/task-XX.md`.
- Set `[LOG_FILE_PATH]` to `project-plans/20250916-cherries-v2/.quality-logs/task-XX`.
- Replace `[N]` with the number of commits in the task.

Only move to the next task when Claude returns `THIS PASSED. YOU MAY PROCEED TO NEXT TASK`.

## Task Inventory

| # | Type | Commits | Focus | Risk | Task File |
|---|------|---------|-------|------|-----------|
| 01 | Batch | 4 | Fix import.meta.url polyfill for cjs build; Create base class for handling tokens stored in files; Replace wmic with powershell for windows process | medium | tasks/01-batch.md |
| 02 | PORT | 1 | Strip thoughts when loading history | low | tasks/02-port-600151c.md |
| 03 | Batch | 3 | Ensure loadEnvironment is always called with settings; Add section on self-assigning issues; Refuse to load from untrusted process.cwd() sources | low | tasks/03-batch.md |
| 04 | PORT | 1 | Add MCP loading indicator when initializing | low | tasks/04-port-03bcbcc.md |
| 05 | Batch | 5 | Settings in Folder trust hook; Refuse to load extensions from untrusted workspaces; Screen reader updates | low | tasks/05-batch.md |
| 06 | Batch | 1 | Skip MCP server connections in untrusted folders | low | tasks/06-batch.md |
| 07 | PORT | 1 | Add Pro Quota Dialog | medium | tasks/07-port-a63e678.md |
| 08 | Batch | 5 | Deprecate redundant CLI flags; Show citations at the end of each turn; Treat UTF16/32 BOM files as text and decode correctly | low | tasks/08-batch.md |
| 09 | Batch | 5 | Don't mutate 'replace' tool args in scheduleToolCalls; Restore missing resolved and integrity in lockfile; Fix enable command typo | medium | tasks/09-batch.md |
| 10 | Batch | 1 | Reuse computeNewContent in performAddMemoryEntry | low | tasks/10-batch.md |
| 11 | HIGH-RISK | 1 | Fix permissions for oauth_creds.json | high | tasks/11-port-3529595.md |
| 12 | Batch | 1 | Resolve environment variables in extension config | low | tasks/12-batch.md |
| 13 | PORT | 1 | Respect folder trust setting when reading GEMINI.md | low | tasks/13-port-5e5f2df.md |
| 14 | Batch | 5 | Preserve input history after /clear command; Add fuzzy matching for command suggestions; Show parent name in trust folder confirmation | medium | tasks/14-batch.md |
| 15 | Batch | 1 | Mock tools refix | low | tasks/15-batch.md |
| 16 | PORT | 1 | Restart cli on folder trust settings changes | low | tasks/16-port-001009d.md |
| 17 | Batch | 4 | Fix diff stats to correctly capture the edits; Fix duplicate LOC counting in diff_stat; Merge general settings from different sources | medium | tasks/17-batch.md |
| 18 | PORT | 1 | Genai sdk handles empty GEMINI_API_KEY correctly | medium | tasks/18-port-ee06dd3.md |
| 19 | Batch | 5 | Use port number for server port file instead of vscode pid; Allow builds to continue when sandbox detection fails; Require model for utility calls | medium | tasks/19-batch.md |
| 20 | Batch | 2 | Add highlights for input /commands and @file/paths; Enable citations by default for certain users | low | tasks/20-batch.md |
| 21 | PORT | 1 | Add gemini extensions link command | low | tasks/21-port-6a581a6.md |
| 22 | Batch | 5 | Add footer configuration settings; Fix screen reader config bug; Create hybrid storage class | medium | tasks/22-batch.md |
| 23 | Batch | 5 | Fix flaky test on Windows by awaiting server close; Improve test environment variable cleanup; Rename smart_edit to replace to align with EditTool | low | tasks/23-batch.md |
| 24 | Batch | 5 | Prevent race condition when diff accepted through CLI; Prevent crash when processing malformed file paths; Fix gemini-cli-vscode-ide-companion's package script | medium | tasks/24-batch.md |
| 25 | Batch | 1 | Merge A2A types | low | tasks/25-batch.md |
| 26 | PORT | 1 | Custom witty message | low | tasks/26-port-de53b30.md |
| 27 | Batch | 5 | Add fzf as a direct dependency to CLI; Correctly pass file filtering settings and add tests; Simplify MCP server timeout configuration | low | tasks/27-batch.md |
| 28 | Batch | 5 | Override Gemini CLI trust with VScode workspace trust; Stabilize PNG integration test part2; Fix more logging issues | medium | tasks/28-batch.md |
| 29 | PORT | 1 | Improve Google OAuth error handling | medium | tasks/29-port-876d091.md |
| 30 | Batch | 3 | Fix diff approval race between CLI and IDE; Add missing v1 settings to migration map; E2E workflow improvements | medium | tasks/30-batch.md |
| 31 | PORT | 1 | Add enforcedAuthType setting | medium | tasks/31-port-987f08a.md |
| 32 | Batch | 5 | Add positional argument for prompt; Update permissions for trustedFolders.json; Remove command from extension docs | low | tasks/32-batch.md |
| 33 | Batch | 5 | Handle cleaning up response text on stream retry; Improve settings migration and tool loading; Tend to history with dangling function calls | medium | tasks/33-batch.md |
| 34 | Batch | 4 | Always return diff stats from EditTool; Make the OAuthTokenStorage non static; Reduce bundle size & check it in CI | medium | tasks/34-batch.md |

### Post-task Checklist
- Update the corresponding results file using the template.
- Run the quality gate script and capture logs.
- Commit only after the task and gate succeed.
- After every 5 tasks (or at listed checkpoints), take a snapshot: `git status`, `npm run test`, verify staging.

### Checkpoints
- **Checkpoint A:** After Task 08 (initial security + MCP foundation)
- **Checkpoint B:** After Task 16 (trust + auth wiring)
- **Checkpoint C:** After Task 24 (IDE + MCP mid-stream)
- **Checkpoint D:** After Task 34 (final verification & merge marker)

Document checkpoint evidence in `project-plans/20250916-cherries-v2/checkpoints.md` (create it as you go).

### Merge Marker
Once every task and checkpoint passes, record the upstream sync point:
```bash
git merge -s ours --no-ff <last-upstream-hash> -m "Merge upstream gemini-cli up to commit <hash>

Cherry-picks recorded in 20250916 cycle"
```

Push the branch and open the PR with links to results and checkpoint artifacts.
