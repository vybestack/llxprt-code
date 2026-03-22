# Playbook: Reimplement Aggregate Evals Results for LLxprt

**Upstream SHA:** `66e7b479ae4`
**Upstream Subject:** Aggregate test results. (#16581)
**Upstream Stats:** 6 files changed, +295 −9 lines
**Batch:** B52 (REIMPLEMENT)

## What Upstream Does (Concrete)

Upstream commit `66e7b479ae4` does four things:

1. **Makes eval logging unconditional.**
   - `evals/test-helper.ts`: removes the `log?: boolean` property from `EvalCase` and the `if (evalCase.log)` guard — every eval now always writes its tool logs to `evals/logs/`.
   - `evals/save_memory.eval.ts`: removes the now-unnecessary `log: true` property.

2. **Adds a JSON vitest reporter for machine-readable results.**
   - `evals/vitest.config.ts`: adds `'json'` to the `reporters` array and sets `outputFile: { json: 'evals/logs/report.json' }`. This produces a structured `report.json` that the aggregation script consumes.

3. **Creates `scripts/aggregate_evals.js` — the aggregation script.**
   - Accepts an artifacts directory argument (default `.`).
   - Recursively finds all `report.json` files in the artifacts tree.
   - Parses vitest JSON output to extract per-test pass/fail/total counts.
   - Fetches up to 10 historical nightly workflow runs via `gh run list` + `gh run download`, downloads their `eval-logs-*` artifacts, and parses their `report.json` files.
   - Generates a GitHub-flavored Markdown summary table with per-test pass rates across historical runs plus the current run.
   - Outputs the Markdown to stdout (piped into `$GITHUB_STEP_SUMMARY` in CI).

4. **Updates the nightly workflow to run evals 3× and aggregate.**
   - `.github/workflows/evals-nightly.yml`: adds `actions: 'read'` permission, adds a `strategy.matrix.run_attempt: [1, 2, 3]` for 3 parallel runs, adds log-directory creation, artifact upload, and a new `aggregate-results` job that downloads all artifacts and runs `node scripts/aggregate_evals.js artifacts`.

## Why REIMPLEMENT (Not PICK)

1. `CHERRIES.md` marks this as **REIMPLEMENT** because the value is downstream from the behavioral evals framework which itself required reimplementation.
2. The nightly workflow references `gemini-cli-ubuntu-16-core` runner, `GEMINI_API_KEY` secret, and upstream GitHub URLs — all must be adapted for LLxprt.
3. `scripts/aggregate_evals.js` contains hardcoded upstream GitHub org/repo URLs in the generated Markdown (search links, evals README link) that must point to LLxprt's repository.
4. The copyright header must use Vybestack LLC rather than Google LLC.
5. The `evals/README.md` reporting section references upstream workflow URLs and repo paths.

## Dependency on Prior Batches

**B51 (`8030404b08b` — Behavioral evals framework) must land before B52.** B51 creates:
- `evals/vitest.config.ts` — this batch modifies it
- `evals/test-helper.ts` — this batch modifies it
- `evals/save_memory.eval.ts` — this batch modifies it
- `evals/README.md` — this batch appends to it
- `.github/workflows/evals-nightly.yml` — may or may not exist from B51 (B51 says "if neither workflow file exists, create a minimal evals-nightly.yml")

If B51 has not yet landed, this playbook cannot execute. The cherrypicker must verify B51 artifacts exist before proceeding.

## LLxprt File Existence Map

**Present after B51 lands (required before B52 starts):**
- `evals/vitest.config.ts` — vitest config with `reporters: ['default']` and `**/*.eval.ts` include
- `evals/test-helper.ts` — `evalTest()`, `EvalCase` with `log?: boolean`, `logToFile()`
- `evals/save_memory.eval.ts` — first eval with `log: true`
- `evals/README.md` — framework documentation
- `package.json` — has `test:always_passing_evals` and `test:all_evals` scripts from B51
- `scripts/` — existing repo-level tooling; `aggregate_evals.js` absent

**Absent (will be created by this batch):**
- `scripts/aggregate_evals.js`

**May or may not exist from B51:**
- `.github/workflows/evals-nightly.yml` — B51 conditionally creates this

## Branding Substitutions for This Commit

| Upstream | LLxprt |
| --- | --- |
| `Copyright 2026 Google LLC` | `Copyright 2025 Vybestack LLC` |
| `gemini-cli-ubuntu-16-core` runner | `ubuntu-latest` (LLxprt CI standard) |
| `GEMINI_API_KEY` | LLxprt's CI provider credential env var (check `.github/workflows/e2e.yml`) |
| `github.com/google-gemini/gemini-cli` URLs | LLxprt's actual repository URL (check `package.json` `repository` field) |
| `gemini-evals-` temp dir prefix | `llxprt-evals-` |

## Preflight Checks

```bash
# Confirm B51 artifacts exist
test -d evals && echo "evals exists" || echo "BLOCKER: evals missing — B51 must land first"
test -f evals/vitest.config.ts && echo "vitest config present" || echo "BLOCKER: vitest config missing"
test -f evals/test-helper.ts && echo "test-helper present" || echo "BLOCKER: test-helper missing"
test -f evals/save_memory.eval.ts && echo "save_memory eval present" || echo "BLOCKER: eval missing"

# Check current state of files this batch modifies
grep -n 'log?' evals/test-helper.ts || echo "log? already removed (unexpected)"
grep -n 'reporters' evals/vitest.config.ts
grep -n 'log: true' evals/save_memory.eval.ts || echo "log: true already removed (unexpected)"

# Confirm aggregate script does not already exist
test -f scripts/aggregate_evals.js && echo "WARNING: aggregate script already exists" || echo "aggregate script absent (expected)"

# Check for nightly workflow
test -f .github/workflows/evals-nightly.yml && echo "nightly workflow exists" || echo "nightly workflow absent"

# Check LLxprt repo URL for branding
grep -m1 '"repository"' package.json || grep -m1 '"url"' package.json | head -3

# Check CI credential env var name
grep -r 'API_KEY\|PROVIDER.*KEY' .github/workflows/e2e.yml | head -5
```

If any BLOCKER line appears, stop and report that B51 must land first.

## Implementation Record

Before writing any code, record the exact resolved values here (filled in during preflight):

- **Resolved repo URL:** _(e.g., `github.com/vybestack/llxprt-code` — from `package.json` repository field or `.git/config`)_
- **Resolved CI secret / env var name for model key:** _(e.g., `ANTHROPIC_API_KEY` — from `.github/workflows/e2e.yml`)_

These two values propagate into `scripts/aggregate_evals.js` Markdown links, `evals/README.md` URLs, and `.github/workflows/evals-nightly.yml` env block. All occurrences must use exactly the values recorded above.

## Implementation Steps

### Step 1: Make eval logging unconditional in `evals/test-helper.ts`

1. Remove the `log?: boolean` property from the `EvalCase` interface.
2. Remove the `if (evalCase.log)` conditional around the `logToFile()` call in the `finally` block — logging should always happen.

**Before** (from B51):
```typescript
    } finally {
      if (evalCase.log) {
        await logToFile(
          evalCase.name,
          JSON.stringify(rig.readToolLogs(), null, 2),
        );
      }
      await rig.cleanup();
    }
```

**After:**
```typescript
    } finally {
      await logToFile(
        evalCase.name,
        JSON.stringify(rig.readToolLogs(), null, 2),
      );
      await rig.cleanup();
    }
```

And remove from the interface:
```typescript
// Remove this line:
  log?: boolean;
```

### Step 2: Remove `log: true` from `evals/save_memory.eval.ts`

Delete the `log: true,` line from the `evalTest` call since logging is now unconditional.

### Step 3: Add JSON reporter to `evals/vitest.config.ts`

Add `'json'` to the reporters array and specify the output file:

**Before** (from B51):
```typescript
  test: {
    testTimeout: 300000, // 5 minutes
    reporters: ['default'],
    include: ['**/*.eval.ts'],
  },
```

**After:**
```typescript
  test: {
    testTimeout: 300000, // 5 minutes
    reporters: ['default', 'json'],
    outputFile: {
      json: 'evals/logs/report.json',
    },
    include: ['**/*.eval.ts'],
  },
```

### Step 4: Create `scripts/aggregate_evals.js`

Create the aggregation script adapted from upstream. Key adaptations:

1. Replace `Copyright 2026 Google LLC` → `Copyright 2025 Vybestack LLC`.
2. Replace temp dir prefix `gemini-evals-` → `llxprt-evals-`.
3. Replace all `github.com/google-gemini/gemini-cli` URLs with LLxprt's actual repo URL (determine from `package.json` repository field or `.git/config`).
4. Replace `evals/README.md` link to point to LLxprt's repo.
5. Replace test-name search URLs to point to LLxprt's repo.
6. Keep the same functional structure: `findReports()`, `getStats()`, `fetchHistoricalData()`, `generateMarkdown()`.
7. Keep the `gh` CLI integration for historical data fetching — this is the core value of the script.

The script must:
- Accept an artifacts directory as argv[2] (default `.`)
- Recursively find `report.json` files
- Parse vitest JSON reporter output (`testResults[].assertionResults[].{title, status}`)
- Compute per-test pass/fail/total from current run artifacts
- Fetch up to 10 historical completed nightly runs via `gh run list --workflow evals-nightly.yml`
- Download each historical run's `eval-logs-*` artifacts to a temp dir
- Parse historical `report.json` files
- Output a GitHub-flavored Markdown table with pass rates across history + current

### Step 5: Append reporting section to `evals/README.md`

Add a `## Reporting` section at the end of the existing README. Adapt from upstream:
- Replace upstream workflow URLs with LLxprt equivalents.
- Update branding-sensitive identifiers to LLxprt where appropriate, but preserve intentional compatibility/context wording when not branding-related.
- Keep the reporting format documentation (pass rate interpretation, history table, total pass rate).
- Reference the actual LLxprt workflow file names.

### Step 6: Update nightly workflow

If `.github/workflows/evals-nightly.yml` exists from B51:
1. Add `actions: 'read'` to the `permissions` block (needed for `gh run list`).
2. Add matrix strategy with `run_attempt: [1, 2, 3]` and `fail-fast: false` to the evals job.
3. Add a `'Create logs directory'` step: `mkdir -p evals/logs`.
4. Add artifact upload step after the eval run (`actions/upload-artifact@v4` with `name: 'eval-logs-${{ matrix.run_attempt }}'`, `path: 'evals/logs'`, `retention-days: 7`).
5. Add a new `aggregate-results` job that:
   - `needs: ['evals']`, `if: always()` — this is critical: the aggregate job must run even if one or more matrix legs fail, otherwise partial results are silently lost
   - runs on `ubuntu-latest` (LLxprt standard)
   - checks out the repo
   - downloads all artifacts via `actions/download-artifact@v4`
   - runs `node scripts/aggregate_evals.js artifacts >> "$GITHUB_STEP_SUMMARY"`
   - requires `GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}'`

If the workflow does not exist from B51, create a complete `evals-nightly.yml` incorporating both the B51 evals job and the B52 aggregation job. Use `ubuntu-latest` as the runner and check `.github/workflows/e2e.yml` for the correct API key secret name.

### Step 7: Verify no existing verification commands regressed

Run the standard verification suite to confirm nothing broke.

## Verification

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

**Format-step behavior:** If `npm run format` rewrites any files, stage the formatting changes and commit them (per standard runbook). Follow project policy for whether additional reruns are required after formatting; do not add extra reruns unless policy or observed formatter behavior in this repo requires them.

Additionally verify the B52-specific changes:

```bash
# Confirm vitest config now has JSON reporter
grep -A4 'reporters' evals/vitest.config.ts

# Confirm log is unconditional in test-helper
grep -c 'log?' evals/test-helper.ts  # should be 0
grep 'logToFile' evals/test-helper.ts  # should appear without if-guard

# Confirm save_memory.eval.ts has no log: true
grep 'log:' evals/save_memory.eval.ts  # should produce no output

# Confirm aggregate script exists and is valid JS
node --check scripts/aggregate_evals.js

# Confirm aggregate script can run with no artifacts (graceful empty case)
node scripts/aggregate_evals.js /tmp/nonexistent-dir 2>&1 || true
# Should print "No reports found." and exit 0

# If evals can run (requires model key), confirm report.json is generated
# npm run test:always_passing_evals
# test -f evals/logs/report.json && echo "report.json generated" || echo "report.json missing"
```

## Execution Notes / Risks

1. **B51 must land first.** This batch modifies files created by B51. If they don't exist, stop.
2. **The aggregation script uses `gh` CLI.** If `gh` is unavailable or authentication is missing, the script must still emit a current-run summary table derived from the local `report.json` file(s) and exit 0. Only the historical-comparison columns should be absent. The script must _not_ fail hard (non-zero exit, uncaught exception) solely because the historical lookup via `gh` failed. Guard all `gh` invocations with try/catch (or equivalent spawn-error handling) and log a warning to stderr when history is skipped.
3. **Hardcoded upstream URLs are the main branding risk.** The script contains multiple `github.com/google-gemini/gemini-cli` URLs in string templates. All must be found and replaced with LLxprt's repo URL.
4. **The `evals/logs/report.json` path must match between vitest config and the aggregation script.** Vitest writes to `evals/logs/report.json`; the script finds files named `report.json` recursively. This works as long as the vitest `outputFile` path is within the artifacts directory tree.
5. **Runner label:** Use `ubuntu-latest` consistently. LLxprt does not have a `gemini-cli-ubuntu-16-core` equivalent.
6. **Do not** copy upstream GitHub org URLs verbatim. The generated Markdown links must point to the correct repository.
7. **Scope boundary:** This playbook covers only `66e7b479ae4`. It builds on B51's framework but does not modify the core eval harness or TestRig beyond making logging unconditional.
