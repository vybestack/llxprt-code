# Stryker Mutation Testing Guide

This project uses [Stryker](https://stryker-mutator.io/) to spot gaps in the `/set` and `/subagent` autocomplete migrations. The mutation suite is scoped to the CLI package and expects that you already have the repo bootstrapped (`npm install` at the root and workspace builds succeeding).

## TL;DR – Run It

```bash
cd packages/cli
npx stryker run
```

Stryker will:

- Instrument `src/ui/commands/schema/index.ts`
- Execute the focused Vitest test list from `vitest.config.mutation.ts`
- Drop JSON/HTML reports in `packages/cli/reports/mutation/`

Expect the run to take ~45s on a modern laptop. The CLI detects dumb terminals and automatically falls back to the append-only reporter, so you can pipe the output into a log file if needed.

## Test Selection

`packages/cli/vitest.config.mutation.ts` whitelists the fast, deterministic suites that hit the schema resolver:

- `schema/argumentResolver.test.ts`
- `commands/test/subagentCommand.schema.test.ts`
- `commands/test/setCommand.phase09.test.ts`
- `commands/test/setCommand.mutation.test.ts`

If you add new tests that specifically target schema branches or command action validation, include them here so Stryker can pick them up. Avoid slow filesystem-heavy suites; mutation analysis fans out multiple Vitest workers, so expensive setup quickly multiplies the runtime.

## Authoring Mutation Tests

1. **Cover both happy-path and guard rails** – boolean toggles, enum validation, and boundary checks are common survivors if only the positive case is tested.
2. **Prefer deterministic data** – e.g., mock `Config`/`SubagentManager` calls with fixed return values so mutants reproduce reliably.
3. **Assert the message payload** – a lot of mutants try to bypass validation; checking the resulting `messageType`/`content` catches them.
4. **Keep helpers local** – Stryker inlines mutants directly in the source file. If you factor critical logic into helpers outside of `index.ts`, either expand the mutation scope or add unit tests against those helpers separately.

## Reading the Report

- `reports/mutation/mutation.json` – machine-readable summary (consumed by CI or custom dashboards).
- `reports/mutation/mutation.html` – HTML UI with per-line mutation results.
- Survivors are grouped by operator type; focus on meaningful ones (e.g., logical operators in resolver code) before tackling equivalent mutants.

## Typical Workflow

1. Run targeted Vitest suites (`npx vitest run …`) until they are green.
2. Launch Stryker (`npx stryker run`).
3. Inspect the survivor list in the console or HTML report.
4. Add/adjust tests to kill the interesting survivors (log/console statements may remain).
5. Re-run Stryker and iterate until the score is above the 70% threshold agreed for the autocomplete phases.

If Stryker flags “static mutants” in compiled enums or feature flags, you can mark them with `// Stryker disable ...` comments, but only after evaluating whether a realistic test could kill them.

## Troubleshooting

- **Worker crashes** – ensure you are on Node 24+ and that `npm run build` succeeds first.
- **Timeouts** – add `vitest` retry logic or increase the `timeoutMS` inside `stryker.conf.json` if a deterministic test still needs more time.
- **Missing mutants** – double-check that the file you care about is listed in `mutate` inside `stryker.conf.json`. By default we only mutate `schema/index.ts`.

Feel free to expand this doc with command-specific tips as we migrate more slash commands into the schema-driven system.
