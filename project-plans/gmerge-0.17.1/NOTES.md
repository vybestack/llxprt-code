# Running Notes: gmerge/0.17.1

Notes appended after each batch during execution.

---

## Batch 1

- `555e25e63` (model message formatting) SKIPPED — `ModelMessage.tsx` does not exist in LLxprt.
- `d683e1c0d` (exit on trust save fail) picked cleanly as `e288fe9e4`.
- `472e775a1` (/permissions modify trust) — massive conflicts across 10+ files. Reclassified to REIMPLEMENT (deferred, not completed in this sync).
- `9786c4dcf` (folder trust /add) — depends on 472e775a1, also deferred.
- `78a28bfc0` (NO_COLOR scrollbar) — conflict on Footer.tsx, Header.tsx, StatsDisplay.tsx, ThemedGradient.tsx. Resolved by keeping LLxprt versions; only color-utils.ts and useAnimatedScrollbar.ts changes applied.
- Post-pick fix: GradientRegression.test.tsx had upstream types (FooterProps, nightly, sessionStats) that don't exist in LLxprt — adapted to use `updateHistoryTokenCount` and `historyTokenCount`. useFolderTrust.ts missing `addItem` in useCallback deps — fixed.

## Batch 2

- `8c78fe4f1` (MCP rework) picked with conflict resolution. All DebugLogger calls preserved. mcpToTool() import removed. McpCallableTool class added. Full verify passed.

## Batch 3

- `cc0eadffe` (setupGithubCommand) SKIPPED — command is intentionally disabled/stubbed in LLxprt. Cherry-pick produced 5 conflict markers across 166+ lines. Per PLAN.md: "only port bugfixes that apply to shared helper logic. Do NOT re-enable the command."

## Batch 4

- All 7 extractions from `86828bb56` (Gemini 3 launch) implemented and verified.
- editorSettingsManager.ts needed antigravity entry in EDITOR_DISPLAY_NAMES (Record<EditorType, string>) — caught during build.

## Batch 5

- Multi-extension uninstall implemented cleanly. Tests cover single, multiple, dedup, partial failure, all-pass.

## Batch 6

- Terminal mode cleanup: added exit handler for bracketed paste + focus tracking. Mouse mock added to gemini.test.tsx. gemini.test.tsx enabled in vitest config.

## Batch 7

- Right-click paste: clipboardy dependency added. PASTE_CLIPBOARD_IMAGE renamed to PASTE_CLIPBOARD. Image-first / text-fallback pattern. useMouse hook wired up.

## Batch 8

- Profile name change: HistoryItemProfileChange type added. showProfileChangeInChat setting (default true). useGeminiStream tracks activeProfileName via ref. First turn initializes without emitting. Guards null/empty.

## Batch 9

- 4 new extension test files (disable, enable, link, list). install.test.ts refactored to use it.each.

## Deferred Items (RESOLVED)

- 472e775a1 (/permissions modify trust for other dirs) — REIMPLEMENTED as 97fc400ea
- 9786c4dcf (check folder trust before allowing /add directory) — REIMPLEMENTED as 4018472a9

## Follow-Up Plan P1 — 472e775a1

- Added non-interactive trust modification to /permissions command.
- `parsePermissionsArgs()` parses trust level + target path from command args.
- Supports TRUST_FOLDER, TRUST_PARENT, DO_NOT_TRUST.
- Preserves existing dialog behavior when no args given.
- Path normalization via `path.resolve()`.
- 12 behavioral tests added.
- No conflicts; clean implementation against existing permissionsCommand.ts.

## Follow-Up Plan P2 — 9786c4dcf

- Trust gate in directoryCommand.tsx before addDirectory().
- Uses `loadTrustedFolders().isPathTrusted()` when `config.getFolderTrust()` is enabled.
- Untrusted paths blocked with guidance to /permissions.
- Mixed input: trusted succeed, untrusted rejected per-path.
- Sandbox early-return preserved at highest priority.
- vitest.config.ts updated to include directoryCommand.test.tsx.
- 4 behavioral tests added (reject untrusted, allow trusted, mixed list, sandbox preservation).

## Follow-Up Plan P3 — ab11b2c27 Cleanup

- Extracted ProfileChangeMessage.tsx from inline InfoMessage in HistoryItemDisplay.
- Compact left margin (marginLeft=2), theme.ui.comment color, sentence-case.
- No warning icon semantics.
- 4 behavioral tests.
- vitest.config.ts updated to include ProfileChangeMessage.test.tsx.

## Follow-Up Plan P4 — Schema Regeneration

- `npm run schema:settings` regenerated settings.schema.json.
- Added previewFeatures (Batch 4) and showProfileChangeInChat (Batch 8).
- `npm run schema:settings -- --check` passes (schema now in sync).
- Single file change, no code modifications.
