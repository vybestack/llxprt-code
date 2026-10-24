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
