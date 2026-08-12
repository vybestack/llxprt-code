# Plan: Prevent stale generated settings artifacts from reaching release (Issue #3212)

Plan ID: PLAN-20260812-ISSUE3212
Generated: 2026-08-12

## Root cause and evidence

The scheduled release runs 31447714495 and 31552306338 both failed in `Run Preflight Checks` while `npm run test:ci` executed the scripts shard. The failing behavioral test was `scripts/tests/generate-settings-doc.test.ts`: `generateDocs(['--check'])` reported both `schemas/settings.schema.json` and `docs/cli/configuration.md` stale and set exit code 1.

The exact stale generated description originated from `packages/cli/src/config/settings-schema/schema-core.ts`, changed by PR #3201 (commit `62f5fcdf6e`, "Bound recorded sessions with a safe global janitor (Fixes #3164)"). It introduced the recording aggregate size-limit description whose generated documentation text drifted out of sync with the source. Separately, PR #3207 (merge commit `e4e6aa77be`) added `telemetry.perf.enabled` and `telemetry.perf.memory` to the facade `packages/cli/src/config/settingsSchema.ts` and committed a changed JSON schema without regenerating the configuration documentation; that change demonstrated the same selection gap and escaped scripts-shard CI before the first release failure, but it was not the exact stale line.

PR CI remained green in both cases because affected-test selection mapped package-scoped CLI source changes to the CLI/dependent shards but omitted the scripts shard, even though a scripts-shard synchronization test reads the settings schema sources — both the facade `packages/cli/src/config/settingsSchema.ts` and the modular sources under `packages/cli/src/config/settings-schema/` — without importing them. Consequently, the release workflow was the first post-merge workflow to run that check.

## Accepted behavior

1. Regenerate and commit settings artifacts so the current source schema, `schemas/settings.schema.json`, and `docs/cli/configuration.md` agree.
2. Treat both the settings schema facade (`packages/cli/src/config/settingsSchema.ts`) and every modular source under `packages/cli/src/config/settings-schema/` as explicitly observed inputs of the scripts test shard, via a checked-in path-observer rule (exact path + directory prefix). Any PR changing those sources must select the scripts shard, in addition to normal package-owner/reverse-dependency shards and package observers. This is source-specific, not a package-wide observer, so unrelated CLI files do not select scripts.
3. Keep the selector's existing package observer model and fail-closed behavior. Extend the data shape generically with a `pathObservers` field validated by the checker; do not add a package-wide `scripts` observer (too broad), a special CI workflow step, or duplicate settings-generation logic.
4. Add behavioral selector coverage proving both the facade and a modular schema source select scripts via a path-observer reason, and that an unrelated CLI production file does not select scripts, and retain the existing check-mode test as the end-to-end synchronization gate.
5. All changed tests use Bun and `bun:test`. Do not add or modify Vitest/Node suites.

## Test-first sequence

1. Add failing selector tests: a PR changing the facade `packages/cli/src/config/settingsSchema.ts` selects both `cli` and `scripts` with a `path-observer` reason; a PR changing a modular source `packages/cli/src/config/settings-schema/schema-core.ts` does the same; and an unrelated CLI production file does NOT select scripts. Assert each via the real selector.
2. Add a generic, checked-in path-observer model (exact paths + directory prefixes) to the affected-test-shard selector and its `GraphData` shape, covering both the facade and the modular schema sources. Extend the checker (`validatePathObservers`) to validate observer identity, selected shard, and on-disk existence of paths/prefixes. Do not use a package-wide observer (too broad) or a hard-coded workflow exception.
3. Run the affected-selector tests, the drift checker, and the generated-settings check-mode test.
4. Keep settings artifacts canonical; prove `bun scripts/generate-settings-doc.ts --check` succeeds.
5. Run full repository verification: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

## Scope boundaries

- No change to settings runtime semantics or telemetry behavior.
- No weakening, skipping, or suppression of generated-artifact checks.
- No lint/complexity threshold changes, ignore additions, eslint disables, or TypeScript suppression directives.
- No release workflow bypass and no unrelated project-plan edits.
