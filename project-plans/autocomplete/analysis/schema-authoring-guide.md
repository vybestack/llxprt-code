<!-- @plan:PLAN-20251013-AUTOCOMPLETE.P12 @requirement:REQ-006 -->

# Schema Authoring Guide

This guide captures the lessons from `PLAN-20250214-AUTOCOMPLETE` so future slash
commands can migrate to the schema resolver without reviving legacy helpers.

## 1. Decide The Contract

- **Locate the command**: identify the source file in `packages/cli/src/ui/commands`.
- **Define argument nodes**: describe every literal or value the user must enter.
  - *Example*: `packages/cli/src/ui/commands/setCommand.ts` builds literals such
    as `context-limit`, and wires value nodes like `modelparam`.
- **Consider async data**: when suggestions depend on services (e.g. profile
  lists), use a `completer` that accepts `(ctx, partialArg, tokenInfo)`.
  - `/subagent save` demonstrates this via profile lookups in
    `packages/cli/src/ui/commands/subagentCommand.ts`.

## 2. Author The Schema

```ts
const schema: CommandArgumentSchema = [
  literal('subcommand', 'Choose a mode', [
    value('name', 'Enter resource name', completerFn),
  ]),
];
```

**Best practices**

- Prefer descriptive `description` strings; the UI shows them as hints.
- Normalise inputs (`partialArg.toLowerCase()`) before filtering.
- Avoid side effects in completers; they can fire often.
- Remove any `completion` function once the schema exists.

## 3. Update The Command Definition

- Replace the `completion` property with `schema`.
- Keep command actions untouched; only autocomplete paths change.
- If the command exposes subcommands, ensure each leaf has its own schema or
  inherits via shared constants (see `/set`).

## 4. Extend Tests

- **Schema unit tests**: exercise the resolver with `createCompletionHandler`
  (see `packages/cli/src/ui/commands/test/setCommand.phase09.test.ts`).
- **Integration tests**: use Vitest to mock services and validate completer
  results (e.g. `packages/cli/src/ui/commands/restoreCommand.test.ts`).
- **Property expectations**: keep PBT coverage ≥ 30% of new tests (Phase 09).
- **Mutation testing**: ensure new schema paths are covered by
  `packages/cli/src/ui/commands/test/setCommand.mutation.test.ts` or similar.

## 5. UI Considerations

- `useSlashCompletion.tsx` now relies solely on `schema`; no manual fallback is
  available.
- Provide meaningful `description` strings so hints remain helpful.
- Confirm `/set`, `/subagent`, or your command behave interactively via manual
  CLI testing after automated suites pass.

## 6. Verification Checklist

- `npm run lint` / `npm run typecheck` / `npm run build`.
- Targeted `vitest run` suites covering the new schema.
- Optional: run `npx stryker run` if mutation thresholds are updated.

Document each completed migration in `.completed` phase notes to preserve the
audit trail.

<!-- @plan:PLAN-20251013-AUTOCOMPLETE.P12a @requirement:REQ-006 -->
Verification: Documentation reviewed on 2025-10-16 by Codex.
