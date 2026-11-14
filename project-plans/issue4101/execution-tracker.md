# REQ-4101 execution tracker

Branch: `issue4101`
Current phase: P01
Status: Phase A implementation is present. Focused verification passes; repository-wide verification has known baseline failures and the full suite is still running or has stopped on unrelated tests. No Phase B work has started.

| Phase | State | Verification |
| --- | --- | --- |
| P00 / P00.5 | Complete from the checked-in plan | Issue and integration map were read before implementation. |
| P01 | Implemented; verification caveats remain | Details in `.completed/P01.md`. |
| P02-P05 | Not started | Out of scope for this task. |

## P01 red/green evidence

- Red category-statistics test: `tmp/verify4101/stats-category-red.log` showed the new `refusalsByCategory` assertion failing because the projection was missing.
- Red user-notice assertion: the prior `refusal-core-green.log` records the expected mismatch before retry notice diagnostics were wired.
- Green focused command: `bun test packages/providers/src/anthropic/finish-metadata.test.ts packages/agents/src/api/__tests__/refusal-diagnostics.behavior.test.ts packages/agents/src/api/__tests__/refusalRecovery.anthropic.behavior.test.ts packages/telemetry/src/telemetry/refusalCounting.behavior.test.ts packages/cli/src/ui/components/ModelStatsDisplay.test.tsx` passed 40 tests with 8 snapshots (`tmp/verify4101/focused-final3.log`).
- Green format: `npm run format` passed after the final edits (`tmp/verify4101/format-final5.log`).
- Green lint: `npm run lint` passed (`tmp/verify4101/lint-final4.log`).
- Typecheck: `npm run typecheck` failed on pre-existing errors in `packages/agent-core/src/definition.test.ts` (two invalid `timeout` properties) and `packages/core/src/services/gitService.ts` (installed `simple-git` types reject `allowEnvironment`). The run reported no P01 diagnostics (`tmp/verify4101/typecheck-final3.log`).
- Build: `npm run build` failed before coordinated workspace builds because `packages/agent-core` has no corresponding `node_modules` workspace entry; the preceding declaration builds also hit the same pre-existing typecheck failures (`tmp/verify4101/build-final2.log`).
- Full `npm test` was attempted under nohup (`tmp/verify4101/npm-test-final.log`) and exited 1. The run logged an MCP lifetime timeout, provider issue #4001 / synthetic credential failures, 19 failing CLI test files out of 1002 (including clipboard/startup/auth integration cases), an A2A request-cancellation timeout, and test-utils failures that require the local model E2E profile/environment. The focused P01 suite passed independently.

## P01 deviations and follow-up

The focused integration tests cover streaming refusal records, null and future categories, JSON response parsing, terminal events without usage, retry request IDs, absent request-id headers, retry notice text, and the successful retry's clean evidence/history. Provider parser tests cover malformed details without masking the refusal finish reason. Category telemetry tests cover deduplication, null/future buckets and reset; CLI ModelStatsDisplay tests cover the visible category row.

The P01 test list is not fully satisfied. Still missing or not directly verified are a SessionRecordingService/ReplayEngine round trip, an AfterModel hook replacement integration case, a transport error after response headers with request-id on the abandoned record, fast-check properties, and the specified public noninteractive/A2A notice consumer cases. These are recorded as verification gaps, not treated as covered by neighboring assertions. Before advancing beyond P01, add those tests and run their listed verification commands; preserve existing checks and behaviors.
