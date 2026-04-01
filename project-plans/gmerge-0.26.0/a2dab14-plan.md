# REIMPLEMENT Playbook: a2dab14 — Undeprecate the --prompt flag

## Upstream Change Summary

This commit undeprecates the `--prompt` (`-p`) CLI flag by removing the `.deprecateOption()` call
from the CLI argument parser. The flag is now fully supported without any deprecation warnings.

**Files changed upstream:**
- `packages/cli/src/config/config.ts` - Remove deprecateOption call
- `packages/cli/src/gemini.tsx` - Remove hasDeprecatedPromptArg parameter
- `packages/cli/src/nonInteractiveCli.test.ts` - Remove deprecation tests
- `packages/cli/src/nonInteractiveCli.ts` - Remove deprecation logic

## LLxprt Current State

**IMPORTANT**: LLxprt's `nonInteractiveCli.ts` and `gemini.tsx` do NOT have a
`hasDeprecatedPromptArg` field or any deprecation logic for `--prompt`. The only relevant
change is whether `packages/cli/src/config/config.ts` has a `.deprecateOption('prompt', ...)`
call.

## Adaptation Plan

### 1. Modify `packages/cli/src/config/config.ts` — the only required change

Read the file and search for `.deprecateOption`. If a `.deprecateOption('prompt', ...)` call
exists, remove it:

```typescript
// REMOVE this call (if present):
.deprecateOption(
  'prompt',
  'Use the positional prompt instead. This flag will be removed in a future version.',
)
```

The `.option('prompt', { ... })` definition itself must remain intact.

If no `.deprecateOption` call exists, this change is already complete (nothing to do).

### 2. No changes to `nonInteractiveCli.ts` or `gemini.tsx`

Do NOT add or remove `hasDeprecatedPromptArg` from these files — the field does not exist in
LLxprt's codebase. Making changes based on the upstream diff would introduce errors.

### 3. No deprecation test removal in `nonInteractiveCli.test.ts`

Do NOT remove tests from `nonInteractiveCli.test.ts` based on the upstream diff. LLxprt's test
file does not contain `hasDeprecatedPromptArg` deprecation tests. Read the file before touching
it; only remove a test if it explicitly tests a deprecation warning for `--prompt`.

## Files to Read

1. `packages/cli/src/config/config.ts` — check for `.deprecateOption('prompt', ...)`

## Files to Modify

1. `packages/cli/src/config/config.ts` — remove `.deprecateOption('prompt', ...)` if present

## Verification Suite

Run the full suite after making changes:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

Additionally verify:
- `--prompt` flag works without warnings in the built CLI
- No deprecation warning appears in stderr

## Notes

This is a targeted removal. If LLxprt never added the `.deprecateOption` call, there is nothing
to change and the playbook is already complete. Always read `config.ts` before editing.
