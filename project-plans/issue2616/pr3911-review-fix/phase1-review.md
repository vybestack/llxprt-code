# Phase 1 review

Review scope: commits after `c27661099`, Phase 1 tasks T1.1-T1.13, binding review, and plan ground rules. Findings are recorded below as verified.

## Findings

### 1. Medium: skills listing ignores the extension disable selection

- **Task:** T1.4, interacting with T1.3 (A1/A2).
- **Commit:** `d1f7d5f00` (T1.4), following `e2bc6bf95` (T1.3).
- **Location:** `packages/cli/src/commands/skills/list.ts:69-72,83-84`.
- **Problem:** The repaired subcommand constructs `ExtensionEnablementManager(workspaceDir)` without the settings disable list. The main bootstrap now supplies that list, but this discovery entry point does not. Consequently, the command reports skills belonging to a disabled extension as enabled, disagreeing with the extension selection the actual agent uses. The declarative resolver receives extensions after this selection has already happened and does not correct it.
- **Evidence:** Ran the real `packages/cli/index.ts skills list` in an isolated temporary HOME/config/data/workspace with an installed `alpha` extension containing `alpha-skill`. With both `extensions.disabled: []` and `extensions.disabled: ['alpha']`, exit status was 0 and stdout included `alpha-skill [Enabled] [Extension]`. The existing three subprocess tests pass but exercise project skills only.
- **Concrete fix:** Supply `{ disabled: settings.merged.extensions?.disabled }` when constructing the selection manager for this entry point. Add a real subprocess test with an installed extension, asserting its skill is listed when enabled and absent when the extension is disabled. Keep the declarative path free of provider preflight and credential authority acquisition.

## Review completion

Reviewed `c27661099..c41908d128482fbc7f642016a9bd1f6fb2ec0452` against the Phase 1 task criteria and binding rules, including the approved production scope extensions. No source or plan files were edited.

The real-alias suite entry disables a preload mock so the new test reaches the real loader; it does not suppress a check. The no-op disposal marker tests, unused providerMutations mock, dead model-profile fallback cases, and tests of deleted bootstrap helpers were removed or replaced consistently with their tasks. The provider-switch model-premise corrections exercise registered providers rather than preserving the suppressed no-op switch. No additional finding is raised for those changes. No committed handoff files or increases to existing test timeouts were found.

Focused verification during this review ran each file in its own Bun process with closed stdin: skills-list subprocess tests (3 passed), extension-selection bootstrap (3), switch-context (11), turn error reports (14), provider alias errors (6), and session execution resolution (3). Total: **40 passed, 0 failed**. The disabled-extension reproduction described in finding 1 is separate from those passing tests. Native Windows behavior was not executed on this macOS host.

**Findings by severity: high 0, medium 1, low 0.**

## Follow-up

Verification was limited to the two requested fixes, using Bun 1.4.4 on macOS. No source files were edited.

1. **Resolved: finding 1, `skills list` extension disable selection (`cae1ddc93`).** `packages/cli/src/commands/skills/list.ts:69-73` now passes `settings.merged.extensions.disabled` into the selection manager before loading extensions; the manager rejects those names at `packages/cli/src/config/extensions/extensionEnablement.ts:197-198`. The real-CLI subprocess cases at `packages/cli/src/commands/skills/list.subprocess.test.ts:218-240` install the same `alpha` extension in isolated data directories, prove `alpha-skill` is discoverable by default, and prove it is absent with `extensions.disabled: ['alpha']`, with successful exits in both cases. Ran `exec < /dev/null; bun test src/commands/skills/list.subprocess.test.ts` from `packages/cli`: **5 passed, 0 failed**.

2. **Resolved: peak RSS measurement-resolution assertion (`ea29a9bf2`).** `packages/core/src/storage/media-lifecycle-metrics.ts:157-178,205-206` samples byte-valued RSS first, then converts `process.resourceUsage().maxRSS` from KiB with `* 1024`. The installed Bun matches `.bun-version` (1.4.4). A direct allocation probe reproduced RSS 9,060,904 bytes versus maxRSS 8,848 KiB (9,060,352 bytes), a 552-byte truncation difference; all eight samples satisfied the floored comparison. Peak values can also exceed current RSS, as expected, so the sub-KiB difference applies at the high-water mark rather than universally. The assertion at `packages/core/src/storage/media-lifecycle-metrics.test.ts:205-210` permits only the discarded `rss % 1024` bytes (0-1023), still rejects a peak below the RSS KiB bucket, and retains the non-null and upper-bound checks. This adjustment does not relax the check beyond its measurement resolution. Ran `exec < /dev/null; bun test src/storage/media-lifecycle-metrics.test.ts` from `packages/core`: **3 passed, 0 failed**.
