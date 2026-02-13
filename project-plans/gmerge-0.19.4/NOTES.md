# NOTES.md — gmerge-0.19.4

Running notes during batch execution.

---

## Pre-Execution Notes

- Branch: `gmerge/0.19.4` created from `main`
- Range: upstream v0.18.4 → v0.19.4 (71 commits)
- Decisions: 22 PICK, 47 SKIP, 2 REIMPLEMENT
- Session-related skips tracked by #1385 (blocked on #1361)
- MCP SDK 1.23.0 update (`d2a6cff4`) moved to SKIP — evaluate independently due to package-lock conflict risk
- Release-branch patches (6169ef04, 95f9032b, ee6b01f9, 93511487) skipped — underlying fixes arrive via main-branch originals in future ranges
- `readStdin.ts` 1-line bug fix from 95693e26 (big test commit) — consider taking standalone if not already covered

---

## Batch 1 (PICK) — Commits 1–5

- 4 of 5 commits cherry-picked cleanly
- `fec0eba0` (move stdio) was a NO_OP — `packages/core/src/utils/stdio.ts` already existed from a prior sync (commit `75abfc44a` reimplemented upstream `2e8d7831`)
- Post-batch fix needed: mcp-client.ts needed DebugLogger instance for LenientJsonSchemaValidator; text-buffer.ts needed set_cursor action type and reducer handler

## Batch 2 (PICK) — Commits 6–10

- 3 of 5 commits cherry-picked
- `030a5ace` (auth flow fixes) intentionally SKIPPED — massive architecture divergence. LLxprt has profile-based multi-provider auth vs upstream's Gemini-only auth. Would require a full rewrite of auth dialog, oauth2, mouse utils.
- `d351f077` (loading phrases) was a NO_OP — `usePhraseCycler` and loading phrase support already exist in our codebase
- Post-batch fix: Removed connection.test.ts (source file doesn't exist in our fork); fixed zedIntegration.test.ts for LLxprt's profile-based auth (3-arg constructor, no AuthType)

## Batch 3 (PICK) — Commits 11–15

- 3 of 5 commits cherry-picked as reimplementations (commit messages show "upstream ..." suffix)
- `8c36b106` (BaseLlmClient.generateContent) was MISSED in the initial batch 3 execution (agent crash). Picked up later as reimplementation due to severe conflicts — added GenerateContentOptions interface, generateContent() method, and _generateWithRetry() helper. Tests needed retryWithBackoff mock to avoid timeouts.
- `b3fcddde` (ink 6.4.6 update) was a NO_OP — our ink is already at `npm:@jrichman/ink@6.4.8`
- `bdf80ea7` (extension stdout/stderr) required follow-up test fixes: Mock exitCli in affected tests, fix extensionsCommand tests for new no-extensions check
- Pre-existing lint fix needed in shell.test.ts

## Batch 4 (PICK) — Commits 16–19

- All 4 commits cherry-picked as reimplementations (adapted for our codebase)
- Clean batch, no significant issues
- Test fixes for extension commands bundled with batch 3 fixes

## Batch 5 (PICK) — Commits 20–22

- All 3 commits cherry-picked cleanly
- Reviewer caught that `6f9118dc` (URL.parse fix) was incomplete — `parseGitHubRepoForReleases` still used `URL.parse()`. Fixed in remediation commit `a1634ddf3`.
- Settings schema $schema property and SCP URL support landed without issues

## Batch 6 (REIMPLEMENT) — Extension Documentation

- Rewrote docs/extension.md from 95 lines to 363 lines
- Added comprehensive Extension Management CLI section covering all 9 commands
- Added Settings section for extension-defined settings
- All LLxprt branding applied; zero upstream branding references remain
- Full verify passed

## Batch 7 (REIMPLEMENT) — /stats session

- Extracted defaultSessionView() function from main action
- Added 'session' as first subcommand in subCommands array
- Updated description to include session in usage string
- Updated 4 test description strings in useSlashCompletion.test.ts
- Formatting fix needed after implementation (committed separately)

## Final Verification

- lint: PASS
- typecheck: PASS
- test: PASS (all ~6900 tests)
- format: PASS (one file needed formatting, committed)
- build: PASS
- haiku: PASS
