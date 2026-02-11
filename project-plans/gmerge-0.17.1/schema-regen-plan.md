# Fix Plan: Regenerate settings.schema.json

## Context

Batches 4 and 8 of the gmerge/0.17.1 sync added new settings to `packages/cli/src/config/settingsSchema.ts`:

- **Batch 4** (86828bb56): `previewFeatures` — boolean, category General, requiresRestart true, default false
- **Batch 8** (ab11b2c27): `showProfileChangeInChat` — boolean, category General, requiresRestart false, default true

Both settings exist in `settingsSchema.ts` and are wired into runtime code (`config.ts`, `useGeminiStream.ts`), but the generated schema file `schemas/settings.schema.json` was never regenerated. This file is produced by `scripts/generate-settings-schema.ts` via `npm run schema:settings`.

CI does not currently enforce schema freshness, so this slipped through.

## What to do

1. Run `npm run schema:settings` to regenerate `schemas/settings.schema.json`.
2. Verify the regenerated file contains both `previewFeatures` and `showProfileChangeInChat`.
3. Run the schema check mode to confirm consistency: `npm run schema:settings -- --check` (should pass after regeneration).
4. Verify nothing else changed unexpectedly in the schema diff (no unrelated additions/removals).

## Verification

```bash
npm run schema:settings
grep -c "previewFeatures\|showProfileChangeInChat" schemas/settings.schema.json
# Expected: at least 2 matches (one per setting)

npm run schema:settings -- --check
# Expected: exits 0 (schema is fresh)

npm run lint
npm run typecheck
npm run build
```

## Negative checks

- Do **not** manually edit `schemas/settings.schema.json` — it is generated.
- Do **not** modify `settingsSchema.ts` — the settings are already correctly defined.
- Do **not** add or remove any settings — this is purely a regeneration step.

## Commit message

`fix: regenerate settings.schema.json after Batch 4/8 schema additions`
