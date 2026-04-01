# Playbook: Rename disable* → enable* Settings (608da23)

**Commit:** 608da2339377a9823f109167200dc68d6aee66be
**Risk Level:** HIGH
**Scope:** ~25 files — setting rename with boolean inversion
**Approach:** SCRIPTED — do not hand-edit each file
**Migration:** NONE — no backward compatibility migration layer. Old setting names are removed outright.

---

## Executive Summary

This commit renames negative-setting names to positive ones with inverted boolean logic:
- `disableAutoUpdate` → `enableAutoUpdate` (default: `true`)
- `disableUpdateNag` → `enableAutoUpdateNotification` (default: `true`)
- `disableFuzzySearch` → `enableFuzzySearch` (default: `true`)
- `disableLoadingPhrases` → `enableLoadingPhrases` (default: `true`)

**No migration layer.** Users with old setting names in their config files will simply get the new defaults. The old keys are removed from the schema entirely.

---

## Rename Matrix

| Old Key | New Key | Old Default | New Default | Inversion |
|---------|---------|-------------|-------------|-----------|
| `disableAutoUpdate` | `enableAutoUpdate` | `false` | `true` | `enable = !disable` |
| `disableUpdateNag` | `enableAutoUpdateNotification` | `false` | `true` | `enable = !disable` |
| `disableFuzzySearch` | `enableFuzzySearch` | `false` | `true` | `enable = !disable` |
| `disableLoadingPhrases` | `enableLoadingPhrases` | `false` | `true` | `enable = !disable` |

**Inversion semantics:** `disableX: true` (feature off) → `enableX: false`. `disableX: false` (feature on, the common default) → `enableX: true`.

### LLxprt-Specific Key Locations

LLxprt has flattened and duplicated paths for some of these:

| Setting | LLxprt Location(s) |
|---------|-------------------|
| `disableAutoUpdate` | Root-flat (`settings.disableAutoUpdate`) AND `general.disableAutoUpdate` |
| `disableUpdateNag` | Root-flat AND `general.disableUpdateNag` |
| `disableFuzzySearch` | `fileFiltering.disableFuzzySearch` (root, NOT under `context`) AND `context.fileFiltering.disableFuzzySearch` |
| `disableLoadingPhrases` | **TWO independent definitions**: `accessibility.disableLoadingPhrases` AND `ui.disableLoadingPhrases` |

ALL locations must be renamed by the script.

---

## Execution Strategy: Script-Then-Apply

### Guiding Principle

Do NOT hand-edit 25+ files. Write a rename/invert script, dry-run it, review, then apply.

---

## Phase 0: Manual Schema + Interface Changes (4 files)

These are structural changes that define the new shape. Do them by hand FIRST so that typecheck failures after the script runs are limited to consumer callsites.

### Step 0.1: Update `packages/cli/src/config/settingsSchema.ts`

For each of the 4 settings (plus the duplicate `ui.disableLoadingPhrases`):
- Rename the key
- Change `label` from "Disable X" to "Enable X"
- Change `default` from `false` to `true`
- Update `description` to positive phrasing

### Step 0.2: Update `packages/cli/src/config/settings.ts`

- Rename `disableLoadingPhrases` in `AccessibilitySettings` interface to `enableLoadingPhrases`
- Remove any migration function (do NOT add `migrateDeprecatedSettings`)

### Step 0.3: Update `packages/core/src/config/config.ts`

- Rename `disableLoadingPhrases` in `AccessibilitySettings` interface
- Rename `disableFuzzySearch` in `ConfigParameters.fileFiltering` and the private field
- Rename `getFileFilteringDisableFuzzySearch()` → `getFileFilteringEnableFuzzySearch()`
- Update constructor defaults: `disableFuzzySearch: false` → `enableFuzzySearch: true`

### Step 0.4: Update `packages/core/src/utils/filesearch/fileSearch.ts`

- Rename `disableFuzzySearch` in `FileSearchOptions` interface to `enableFuzzySearch`
- Invert the boolean logic at all usage sites

### Step 0.5: Regenerate Schema Artifact

```bash
npm run schema:settings
```

Verify:
```bash
grep -c "enableAutoUpdate\|enableFuzzySearch\|enableLoadingPhrases\|enableAutoUpdateNotification" schemas/settings.schema.json
# Should return 4+
grep -c "disableAutoUpdate\|disableFuzzySearch\|disableLoadingPhrases\|disableUpdateNag" schemas/settings.schema.json
# Should return 0
```

---

## Phase 1: Build the Rename/Invert Script

Create `scripts/gmerge/608da23-rename.ts` (or `.mjs`).

### Script Requirements

The script MUST:

1. **Accept `--dry-run` (default) and `--apply` flags**
2. **Define the rename map:**
   ```typescript
   const RENAMES = [
     { old: 'disableAutoUpdate', new: 'enableAutoUpdate' },
     { old: 'disableUpdateNag', new: 'enableAutoUpdateNotification' },
     { old: 'disableFuzzySearch', new: 'enableFuzzySearch' },
     { old: 'disableLoadingPhrases', new: 'enableLoadingPhrases' },
   ];
   ```
3. **Find all files** matching `packages/{cli,core}/**/*.{ts,tsx}` (excluding `node_modules`)
4. **For each file**, detect and transform:

#### Pattern A: Property/variable name references
```
disableAutoUpdate  →  enableAutoUpdate
```
(as identifier, not substring — e.g., don't match `shouldDisableAutoUpdateCheck`)

#### Pattern B: Boolean logic inversion at callsites
```
if (settings.disableAutoUpdate)     →  if (!settings.enableAutoUpdate)
if (!settings.disableAutoUpdate)    →  if (settings.enableAutoUpdate)
settings.disableAutoUpdate ? A : B  →  !settings.enableAutoUpdate ? A : B
                                       OR  settings.enableAutoUpdate ? B : A
```

#### Pattern C: Test fixture values
```
disableAutoUpdate: true   →  enableAutoUpdate: false
disableAutoUpdate: false  →  enableAutoUpdate: true
disableFuzzySearch: false →  enableFuzzySearch: true
```

#### Pattern D: String literals (descriptions, labels)
```
'Disable Auto Update'     →  'Enable Auto Update'
'disableAutoUpdate'       →  'enableAutoUpdate'    (in test assertion strings)
```

5. **In dry-run mode**: print each transformation with context
6. **In apply mode**: write files
7. **Track and report** files changed, patterns found per type, skipped patterns
8. **Flag ambiguous cases** for manual review:
   ```
   [AMBIGUOUS] path/to/file.ts:42 — complex expression involving disableAutoUpdate — needs manual review
   ```

### Implementation Method: Two-Pass Strategy

The script SHOULD use two separate passes:

**Pass 1 — Identifier/Property Rename (safe, AST-preferred):**
Rename all identifier references: `disableFoo` → `enableFoo`. This is a mechanical name swap with no semantic change. AST tools (`ts-morph`, `jscodeshift`) handle this cleanly.

**Pass 2 — Semantic Inversion (limited safe set only):**
Only these patterns are safe for automated inversion:

| Old Pattern | New Pattern | Safe? |
|-------------|-------------|-------|
| `if (x.enableFoo)` (was disableFoo) | `if (!x.enableFoo)` | ✅ Simple condition |
| `if (!x.enableFoo)` (was !disableFoo) | `if (x.enableFoo)` | ✅ Simple negation |
| `enableFoo: true` (in object literal) | `enableFoo: false` | ✅ Literal value |
| `enableFoo: false` (in object literal) | `enableFoo: true` | ✅ Literal value |

Everything else is `[AMBIGUOUS]` — flag for manual review:
- Ternary expressions: `x.enableFoo ? A : B` — may need operand swap
- Logical combinations: `x.enableFoo || fallback` — semantics depend on context
- Nullish coalescing: `enableFoo ?? false` — default may need flipping
- Complex boolean: `!x.enableFoo && otherThing` — multiple inversions

### Do-Not-Touch Guard List

The script MUST NOT rename these similarly-named settings that are NOT part of this refactor:
- `enableFuzzyFiltering` — distinct LLxprt setting, unrelated to `disableFuzzySearch`
- Any setting not in the RENAMES map

Add a post-apply grep to verify these were not accidentally modified:
```bash
# Verify enableFuzzyFiltering was NOT changed:
git diff -- packages/ | grep -c 'enableFuzzyFiltering'
# Expected: 0
```

### Idempotency Requirement

Running the script with `--apply` a second time MUST produce zero additional changes.

### Additional Files Likely Affected

Beyond the files listed in the main "Files Expected to Change" section, grep may reveal these:
- `packages/cli/src/utils/settingsUtils.test.ts`
- `packages/cli/src/config/settings-validation.test.ts`
- `packages/cli/src/config/settingsSchema.test.ts`
- `packages/test-utils/src/test-rig.ts`
- `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` and tests

The script should discover these automatically. The implementer should verify the dry-run output covers them.



---

## Phase 2: Dry-Run, Review, Apply

### Step 2.1: Run Dry-Run

```bash
npx tsx scripts/gmerge/608da23-rename.ts
```

Review output carefully. Pay special attention to:
- `fileSearch.test.ts` (~30 occurrences of `disableFuzzySearch: false`)
- Logic inversions in `handleAutoUpdate.ts`, `installationInfo.ts`, `updateCheck.ts`
- The two separate `disableLoadingPhrases` locations

### Step 2.2: Apply

```bash
npx tsx scripts/gmerge/608da23-rename.ts --apply
```

### Step 2.3: Manual Fixup

Handle any `[AMBIGUOUS]` items from the dry-run. Typical cases:
- Complex ternary expressions
- Settings passed as function arguments where the parameter also needs renaming
- `installationInfo.ts` parameter rename (`isAutoUpdateDisabled` → `isAutoUpdateEnabled`) and logic flip

---

## Phase 3: Verification

### Step 3.1: Grep for Residuals

```bash
# All old names should be gone:
grep -rn 'disableAutoUpdate\|disableUpdateNag\|disableFuzzySearch\|disableLoadingPhrases' packages/ --include='*.ts' --include='*.tsx' | grep -v node_modules
# Expected: 0 results
```

### Step 3.2: Full Suite

```bash
npm run typecheck && npm run test && npm run lint && npm run format && npm run build
```

### Step 3.3: Smoke Test

```bash
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

---

## Files Expected to Change

### Schema/Interface (Phase 0 — manual):
- `packages/cli/src/config/settingsSchema.ts`
- `packages/cli/src/config/settings.ts`
- `packages/core/src/config/config.ts`
- `packages/core/src/utils/filesearch/fileSearch.ts`
- `schemas/settings.schema.json` (regenerated)

### Consumer Code (Phase 1-2 — scripted):
- `packages/cli/src/ui/components/Composer.tsx`
- `packages/cli/src/ui/hooks/useAtCompletion.ts`
- `packages/cli/src/ui/utils/updateCheck.ts`
- `packages/cli/src/utils/handleAutoUpdate.ts`
- `packages/cli/src/utils/installationInfo.ts`

### Tests (Phase 1-2 — scripted):
- `packages/cli/src/config/config.test.ts`
- `packages/cli/src/config/settings.test.ts`
- `packages/core/src/utils/filesearch/fileSearch.test.ts` (~30 occurrences)
- `packages/cli/src/ui/hooks/useAtCompletion.test.ts`
- Various other test files with settings fixtures

---

## Risk Areas

### Critical
- **Logic inversion errors** — `if (disableX)` becoming `if (enableX)` instead of `if (!enableX)` breaks behavior silently
- The script's inversion logic is the highest-risk component — review it thoroughly before `--apply`

### High
- **fileSearch.ts chain** — `FileSearchOptions.disableFuzzySearch` → getter → `useAtCompletion.ts` → all must be renamed consistently or runtime breaks

### Medium
- **Schema artifact** — must regenerate `settings.schema.json` after changes

---

## Rollback

```bash
git checkout -- packages/ schemas/
```

---

## Cleanup

```bash
rm scripts/gmerge/608da23-rename.ts
```

---

## Notes

- **No migration layer.** This is a breaking change for users who had `disableX` set in their config files. They will silently get the new defaults. This is intentional — we are not maintaining backward compatibility for this rename.
- **Hard prerequisite:** f7f38e2 (non-nullable settings) MUST be completed before this. The non-nullable guarantees simplify the inversion logic (no need to worry about undefined-vs-false confusion)
- Prerequisite for: 211d2c5 (hooks schema split) depends on the naming conventions being settled
