# Batch RS-S5 — `sonarjs/os-command` and `sonarjs/no-os-command-from-path`

## Target rules

- `sonarjs/os-command`
- `sonarjs/no-os-command-from-path`

These rules flag shell/process invocation sites that can be risky when command
names are path-resolved or command strings are executed through a shell. Fix by
using explicit binary paths/argument arrays where that preserves behaviour. When
the call site is intentionally invoking platform shell/tooling with bounded or
trusted inputs, use a narrow inline disable with an explanatory reason. Do not
use broad file-level disables.

## Baseline

- `sonarjs/os-command`: 13 warnings across 5 files
- `sonarjs/no-os-command-from-path`: 31 warnings across 13 files
- Combined unique files: 16
- Source summary: `/tmp/phase4-summary.json`

## Frozen file list

- `packages/cli/src/utils/sandbox.ts` — `sonarjs/os-command` 8 (547:22, 698:22, 1261:24, 1656:9, 1664:11, 1674:32, 1943:22, 1951:9); `sonarjs/no-os-command-from-path` 7 (388:20, 495:5, 649:5, 807:31, 1409:22, 1831:28, 1832:28)
- `packages/core/src/tools/grep.ts` — `sonarjs/os-command` 1 (461:23); `sonarjs/no-os-command-from-path` 2 (704:33, 789:33)
- `packages/core/src/ide/ide-installer.ts` — `sonarjs/os-command` 2 (35:22, 45:7)
- `packages/core/src/utils/editor.ts` — `sonarjs/os-command` 1 (70:5)
- `packages/cli/src/auth/proxy/__tests__/deprecation-guard.test.ts` — `sonarjs/os-command` 1 (43:20)
- `packages/core/src/services/shellExecutionService.ts` — `sonarjs/no-os-command-from-path` 4 (402:29, 549:25, 929:29, 1072:25)
- `packages/cli/src/integration-tests/cli-args.integration.test.ts` — `sonarjs/no-os-command-from-path` 1 (29:25)
- `packages/core/src/tools/shell.ts` — `sonarjs/no-os-command-from-path` 1 (465:38)
- `packages/core/src/tools/ast-edit/repository-context-provider.ts` — `sonarjs/no-os-command-from-path` 4 (59:34, 107:9, 124:32, 139:9)
- `packages/cli/src/utils/gitUtils.ts` — `sonarjs/no-os-command-from-path` 4 (19:16, 41:14, 106:30, 136:30)
- `packages/core/src/utils/gitLineChanges.ts` — `sonarjs/no-os-command-from-path` 1 (44:25)
- `packages/core/src/utils/systemEncoding.ts` — `sonarjs/no-os-command-from-path` 2 (60:31, 92:25)
- `packages/cli/src/integration-tests/loadbalancer.integration.test.ts` — `sonarjs/no-os-command-from-path` 1 (32:25)
- `packages/cli/src/ui/hooks/useGitBranchName.ts` — `sonarjs/no-os-command-from-path` 2 (19:9, 31:15)
- `packages/cli/src/utils/installationInfo.ts` — `sonarjs/no-os-command-from-path` 1 (84:21)
- `packages/core/src/services/gitService.ts` — `sonarjs/no-os-command-from-path` 1 (48:12)

## Exit criteria

- `npx eslint <listed-files> --ext .ts,.tsx --rule '{"sonarjs/os-command":"error","sonarjs/no-os-command-from-path":"error"}' --quiet` reports 0 errors.
- Full package-source scan reports 0 diagnostics for both rules before global promotion.
- Both rules are promoted to global `error` only after zero diagnostics and fresh review.
