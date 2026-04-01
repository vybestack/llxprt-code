# Plan: Hooks Schema Split Refactor

Plan ID: PLAN-20260325-HOOKSPLIT
Generated: 2026-03-25
Total Phases: 17 (P00a through P17)
Upstream Commit: 211d2c5fdd877c506cb38217075d1aee98245d2c
Prerequisite: f7f38e2 (non-nullable settings) must be merged first

## Requirements Implemented

| Requirement | Title | Phases |
|-------------|-------|--------|
| REQ-211-S01 | New `hooksConfig` settings key | P03, P04, P05 |
| REQ-211-S02 | `hooks` contains only event definitions | P03, P04, P05 |
| REQ-211-S03 | `hooksConfig` merge strategy | P03, P04, P05 |
| REQ-211-M01 | Automatic migration on load | P06, P07, P08 |
| REQ-211-M02 | Migration applies to all scopes | P06, P07, P08 |
| REQ-211-M03 | Migration is idempotent | P06, P07, P08 |
| REQ-211-M04 | Migration does not overwrite existing hooksConfig | P06, P07, P08 |
| REQ-211-C01 | `enableHooks` reads from `hooksConfig` | P03, P05, P14 |
| REQ-211-C02 | `hooks` passed to Config is pure event map | P11, P14 |
| REQ-211-C03 | `disabledHooks` is explicit Config parameter | P09, P10, P11, P14 |
| REQ-211-CC01 | Config constructor uses `disabledHooks` param | P09, P10, P11 |
| REQ-211-CC02 | `projectHooks` type is pure event map | P09, P10, P11 |
| REQ-211-CC03 | SettingsService persistence key updated | P09, P10, P11 |
| REQ-211-HD01 | Hook registration unaffected | P10, P15 |
| REQ-211-HD02 | Hook execution guards unchanged | P15 |
| REQ-211-HD03 | Trust scan treats project hooks as pure event map | P12, P13, P14 |
| REQ-211-CMD01 | `/hooks` command uses Config API | P13, P14 |
| REQ-211-CMD02 | User-facing messages reference `hooksConfig.enabled` | P12, P13, P14 |
| REQ-211-MIG01 | `hooks migrate` operates on pure event map | P12, P13, P14 |
| REQ-211-UI01 | StatusDisplay does not regress | P15, P16 |
| REQ-211-SM01 | `hooksConfig` is merged across scopes | P05, P08, P15 |
| REQ-211-T01 | Schema helper tests updated | P04 |
| REQ-211-T02 | Core Config tests updated | P10 |
| REQ-211-T03 | Hook system tests use split schema | P10, P13 |
| REQ-211-T04 | Migration function tests | P07 |
| REQ-211-T05 | Integration tests use split schema | P15 |
| REQ-211-T06 | CLI config loading tests | P13 |
| REQ-211-ZD01 | No breaking change for existing settings files | P08, P15, P16 |
| REQ-211-NR01 | Full verification suite passes | P17 |

## Phase Sequence

| Phase | File | Title |
|-------|------|-------|
| P00a | 00a-preflight-verification.md | Preflight Verification |
| P01 | 01-analysis.md | Domain Analysis |
| P01a | 01a-analysis-verification.md | Analysis Verification |
| P02 | 02-pseudocode.md | Pseudocode Development |
| P02a | 02a-pseudocode-verification.md | Pseudocode Verification |
| P03 | 03-schema-split-stub.md | Schema Split + Helper Update |
| P03a | 03a-schema-split-stub-verification.md | Schema Split + Helper Update Verification |
| P04 | 04-schema-split-tdd.md | Schema Split TDD |
| P04a | 04a-schema-split-tdd-verification.md | Schema Split TDD Verification |
| P05 | 05-schema-split-impl.md | Schema Split Verification + Cleanup |
| P05a | 05a-schema-split-impl-verification.md | Schema Split Verification + Cleanup Verification |
| P06 | 06-migration-stub.md | Migration Function Stub |
| P06a | 06a-migration-stub-verification.md | Migration Stub Verification |
| P07 | 07-migration-tdd.md | Migration Function TDD |
| P07a | 07a-migration-tdd-verification.md | Migration TDD Verification |
| P08 | 08-migration-impl.md | Migration Function Implementation |
| P08a | 08a-migration-impl-verification.md | Migration Impl Verification |
| P09 | 09-config-types-stub.md | Core Config Type Updates Stub |
| P09a | 09a-config-types-stub-verification.md | Config Types Stub Verification |
| P10 | 10-config-types-tdd.md | Core Config Type TDD |
| P10a | 10a-config-types-tdd-verification.md | Config Types TDD Verification |
| P11 | 11-config-types-impl.md | Core Config Type Implementation |
| P11a | 11a-config-types-impl-verification.md | Config Types Impl Verification |
| P12 | 12-cli-loading-stub.md | CLI Loading + Commands Stub |
| P12a | 12a-cli-loading-stub-verification.md | CLI Loading Stub Verification |
| P13 | 13-cli-loading-tdd.md | CLI Loading + Commands TDD |
| P13a | 13a-cli-loading-tdd-verification.md | CLI Loading TDD Verification |
| P14 | 14-cli-loading-impl.md | CLI Loading + Commands Implementation |
| P14a | 14a-cli-loading-impl-verification.md | CLI Loading Impl Verification |
| P15 | 15-integration-tdd.md | Integration Tests |
| P15a | 15a-integration-tdd-verification.md | Integration TDD Verification |
| P16 | 16-integration-impl.md | Integration Wiring |
| P16a | 16a-integration-impl-verification.md | Integration Impl Verification |
| P17 | 17-final-verification.md | Final Verification |

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 00a)
2. Verified the f7f38e2 (non-nullable settings) prerequisite is merged
3. Read the domain analysis and all pseudocode files
4. Understood this is a REFACTORING task — no new features, schema migration + behavioral preservation
5. The full verification suite is: `npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
