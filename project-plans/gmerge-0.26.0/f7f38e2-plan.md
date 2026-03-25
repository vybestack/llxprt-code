# Playbook: Make Merged Settings Non-Nullable (f7f38e2b9)

**Commit:** f7f38e2b9ef78fa0d4499ce442c8c633949efdba
**Risk Level:** HIGH
**Scope:** ~59 upstream files — mechanical type-safety cleanup
**Approach:** SCRIPTED — do not hand-edit each file

---

## Executive Summary

This commit makes merged settings non-nullable. All `settings.merged.X` properties now have guaranteed default values instead of being `| undefined`. This requires:
1. Ensuring `mergeSettings()` returns complete defaults for every setting
2. Introducing `createTestMergedSettings()` helper for tests
3. Removing defensive `?.`, `|| {}`, `|| []`, `?? []`, `|| defaultValue` patterns on merged settings access
4. Updating tests to use fully-initialized settings objects

This is a mechanical refactor. **Use scripts, not hand-editing.**

---

## Execution Strategy: Script-Then-Apply

### Guiding Principle

The implementer MUST NOT open files and hand-edit nullable patterns one by one. Instead:

1. **Write a transformation script** that finds and transforms patterns
2. **Run the script in dry-run mode** that only reports what it WOULD change (file, line, before → after)
3. **Review the dry-run output** — every proposed change must be validated against the schema default
4. **Apply the script** only after the dry-run is reviewed and approved
5. **Run the full verification suite** after applying
6. **Fix any remaining issues by hand** — the script handles the bulk, manual fixup is for edge cases only

### Why This Matters

- 59 files of hand-editing invites inconsistency and fatigue errors
- A script can be reviewed ONCE then applied consistently
- Dry-run output is a reviewable artifact
- If the script is wrong, you haven't touched any files yet

---

## Phase 0: Prerequisite — Audit Settings Schema

Before writing any script, build the ground truth of which settings are non-nullable candidates.

### Step 0.1: Extract the Schema Default Map

```bash
# Find every setting with a concrete default in settingsSchema.ts
grep -n "default:" packages/cli/src/config/settingsSchema.ts
```

Build a table from this output:

| Setting Path | Schema Default | Non-nullable? |
|-------------|---------------|---------------|
| *(from grep output)* | value / undefined | YES / NO |

**Rule:** A setting is a non-nullable candidate ONLY if its schema entry has a concrete default (not `undefined`). If a setting defaults to `undefined`, guards on it MUST be preserved.

### Step 0.2: Audit LLxprt-Specific Settings

LLxprt has settings that upstream doesn't. Each MUST have a schema default before guards can be removed:

| Setting | Current Default | Action |
|---------|----------------|--------|
| `providerApiKeys` | ? | Check and document |
| `providerBaseUrls` | ? | Check and document |
| `providerKeyfiles` | ? | Check and document |
| `defaultProfile` | ? | Check and document |
| `oauthEnabledProviders` | ? | Check and document |
| `shouldUseNodePtyShell` | ? | Check and document |
| `allowPtyThemeOverride` | ? | Check and document |
| `ptyScrollbackLimit` | ? | Check and document |
| `enableFuzzyFiltering` | ? | Check and document |
| `showProfileChangeInChat` | ? | Check and document |
| `enableTextToolCallParsing` | ? | Check and document |
| `textToolCallModels` | ? | Check and document |
| `openaiResponsesEnabled` | ? | Check and document |
| `shellReplacement` | ? | Check and document |

Populate from `settingsSchema.ts` BEFORE proceeding. If any lack a default and are accessed with guards in the codebase, add the default to the schema as part of this work.

---

## Phase 1: Core Infrastructure (Manual — 2 files)

These two changes are small and structural, not mechanical — do them by hand.

### Step 1.1: Update `mergeSettings()` to Guarantee Defaults

**File:** `packages/cli/src/config/settings.ts`

Ensure `mergeSettings()` spreads schema defaults so every property is populated. Verify `getSchemaDefaults()` covers all settings including LLxprt-specific ones.

### Step 1.2: Create `createTestMergedSettings()` Helper

**File:** `packages/cli/src/config/settings.ts`

```typescript
export function createTestMergedSettings(
  overrides: Partial<Settings> = {},
): Settings {
  return mergeSettings({}, {}, {}, {}, true, overrides);
}
```

Adjust signature to match LLxprt's actual `mergeSettings` parameters.

### Step 1.3: Verify Typecheck

```bash
npm run typecheck
```

This WILL fail — that's expected. The failures are the list of files that need updating.

---

## Phase 2: Build the Transformation Script

Create a TypeScript/Node script at `scripts/gmerge/f7f38e2-transform.ts` (or `.mjs`).

### Script Requirements

The script MUST:

1. **Accept a `--dry-run` flag** (default behavior) and a `--apply` flag
2. **Accept a `--schema-map` argument** pointing to a JSON file mapping setting paths → their defaults (produced from Phase 0)
3. **Find all files** matching `packages/{cli,core}/**/*.{ts,tsx}` (excluding `node_modules`)
4. **For each file**, detect and transform these patterns:

#### Pattern A: Optional chaining on merged settings
```
settings.merged.X?.Y  →  settings.merged.X.Y
```
Only if `X.Y` has a schema default.

#### Pattern B: Nullish coalescing fallbacks
```
settings.merged.X ?? defaultValue  →  settings.merged.X
settings.merged.X || defaultValue  →  settings.merged.X
```
Only if `X` has a schema default matching `defaultValue`.

#### Pattern C: Test settings stubs
```
{} as Settings                    →  createTestMergedSettings()
parseArguments({} as Settings)    →  parseArguments(createTestMergedSettings())
const settings: Settings = {};    →  const settings = createTestMergedSettings();
```

#### Pattern D: Conditional guards (AMBIGUOUS — manual review)
```
if (settings.merged.X && ...)    →  [AMBIGUOUS] — needs manual review
settings.merged.X ? ... : fallback  →  [AMBIGUOUS] — needs manual review
```
These are too risky for automated rewriting. The script should FLAG them, not transform them.

5. **In dry-run mode**: print each transformation as:
   ```
   [DRY-RUN] path/to/file.ts:42
     BEFORE: settings.merged.advanced?.excludedEnvVars ?? []
     AFTER:  settings.merged.advanced.excludedEnvVars
     REASON: advanced.excludedEnvVars has schema default []
   ```
6. **In apply mode**: write the transformed files
7. **Track statistics**: files scanned, transformations found, transformations applied
8. **NEVER transform** a pattern where the setting path is not in the schema map — log a warning instead:
   ```
   [SKIP] path/to/file.ts:87 — settings.merged.customThing?.foo — not in schema map, manual review needed
   ```

### Implementation Method: AST-First

The script SHOULD use an AST-based approach (e.g., `ts-morph`, `jscodeshift`, or TypeScript compiler API) rather than regex. At this scale with conditional/ternary rewriting, regex is too fragile.

If a simpler regex approach is used, limit auto-transforms to the safe set:
- **Safe for regex:** optional chaining removal (`?.` → `.`), `?? defaultValue` removal, test helper replacement
- **Unsafe for regex (→ AMBIGUOUS):** ternary collapsing, `||` removal (falsy vs nullish), conditional guard removal

### Idempotency Requirement

Running the script with `--apply` a second time MUST produce zero additional changes.

### Script Skeleton

```typescript
#!/usr/bin/env tsx
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

const DRY_RUN = !process.argv.includes('--apply');
const schemaMap = JSON.parse(fs.readFileSync(process.argv.find(a => a.startsWith('--schema-map='))?.split('=')[1] || 'schema-defaults.json', 'utf8'));

interface Transform {
  file: string;
  line: number;
  before: string;
  after: string;
  reason: string;
}

const transforms: Transform[] = [];
const skips: Transform[] = [];

// ... pattern matching logic ...

if (DRY_RUN) {
  console.log(`\n=== DRY RUN: ${transforms.length} transformations found, ${skips.length} skipped ===\n`);
  for (const t of transforms) {
    console.log(`[DRY-RUN] ${t.file}:${t.line}`);
    console.log(`  BEFORE: ${t.before.trim()}`);
    console.log(`  AFTER:  ${t.after.trim()}`);
    console.log(`  REASON: ${t.reason}\n`);
  }
  for (const s of skips) {
    console.log(`[SKIP] ${s.file}:${s.line} — ${s.before.trim()} — ${s.reason}`);
  }
} else {
  // Apply transforms grouped by file
  console.log(`\nApplying ${transforms.length} transformations...`);
  // ... write files ...
}
```

---

## Phase 3: Dry-Run, Review, Apply

### Step 3.1: Generate Schema Defaults Map

```bash
# Extract defaults from settingsSchema.ts into JSON
npx tsx scripts/gmerge/extract-schema-defaults.ts > schema-defaults.json
```

### Step 3.2: Run Dry-Run

```bash
npx tsx scripts/gmerge/f7f38e2-transform.ts --schema-map=schema-defaults.json
```

Review the output. For EVERY `[DRY-RUN]` line, verify:
- The setting path IS in the schema with a concrete default
- The transformation preserves the semantic meaning
- No false positives (e.g., non-settings objects that happen to have `?.`)

For EVERY `[SKIP]` line, decide:
- Add to schema map if it should be non-nullable
- Leave as-is if intentionally nullable
- Flag for manual fixup

### Step 3.3: Apply

```bash
npx tsx scripts/gmerge/f7f38e2-transform.ts --schema-map=schema-defaults.json --apply
```

### Step 3.4: Add `createTestMergedSettings()` Imports

The script should also handle adding the import to files that now use `createTestMergedSettings()`:

```typescript
import { createTestMergedSettings } from '../../config/settings';
```

Adjust the relative path per file location.

### Step 3.5: Manual Fixup

After the script runs, some edge cases will remain. Fix these by hand:
- Complex conditional expressions the regex couldn't parse
- Files the script skipped
- Any new typecheck errors

---

## Phase 4: Verification

### Step 4.1: Full Suite

```bash
npm run typecheck && npm run test && npm run lint && npm run format && npm run build
```

### Step 4.2: Smoke Test

```bash
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

### Step 4.3: Grep for Residual Guards

```bash
# These should return ZERO results for settings with schema defaults:
grep -rn 'settings\.merged\.\w*?\.' packages/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v '\.test\.' | head -20
```

Any remaining hits need manual review — either the script missed them or they're intentionally nullable.

---

## LLxprt-Specific Considerations

1. **Brand paths**: `@vybestack/llxprt-code-core`, `LLXPRT_DIR` — no impact on this refactor
2. **LLxprt-only settings**: Must have schema defaults added (Phase 0.2) before guards can be removed
3. **Prerequisite for**: 211d2c5 (hooks schema split) — do this first

---

## Rollback

```bash
git checkout -- packages/
```

The script is non-destructive in dry-run mode. If the applied changes break things, revert and iterate on the script.

---

## Cleanup

After verification, delete the transformation script:
```bash
rm scripts/gmerge/f7f38e2-transform.ts scripts/gmerge/extract-schema-defaults.ts schema-defaults.json
```

Or keep them as reference — they don't ship in the build.
