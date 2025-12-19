# Implementation Plan: bcbcaeb8 - FAQ/Extensions Documentation + Branding Fixes

## Summary of Upstream Changes

Upstream commit `bcbcaeb8` ("fix(docs): Update docs/faq.md per Srinanth (#10667)"):
1. Fixed typo in `docs/extensions/index.md` (removed stray backtick)
2. Changed "Not seeing your question?" section to point to GitHub Q&A discussions

## Additional Branding Issues Discovered

During review, multiple gemini-cli/Gemini CLI branding issues were found in the same files being modified:

**In extension.md:**
- Lines 87-96: "Gemini CLI extensions" and "gemini-extension.json" references

**In troubleshooting.md:**
- Line 162: "gemini-cli" reference
- Line 163: "gemini-cli behavior" reference
- Line 164: ".gemini/.env" reference (should be ".llxprt/.env")
- Line 168: "Gemini CLI" reference

## Current State in LLxprt

| LLxprt File | Upstream Equivalent | Notes |
|-------------|---------------------|-------|
| `docs/troubleshooting.md` | `docs/faq.md` | Combined FAQ into troubleshooting |
| `docs/extension.md` | `docs/extensions/index.md` | Singular name |

## Detailed Analysis

### Change 1: Extension docs typo fix
**Status:** NOT APPLICABLE

**Verification:** The upstream change removed a stray backtick from `docs/extensions/index.md`. Reading `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/docs/extension.md` shows:
- Line 32: `"excludeTools": ["run_shell_command"]` - No stray backticks present
- Line 41: `"excludeTools": ["run_shell_command(rm -rf)"]` - No stray backticks present
- The text structure differs from upstream; the typo was in content we don't have

**Conclusion:** Skip this change as LLxprt's extension.md does not contain the problematic text.

### Change 2: FAQ "Not seeing your question?" section
**Status:** APPLICABLE

**Current state in troubleshooting.md:**
- Line 197 (LAST LINE of file): `If you encounter an issue not covered here, consider searching the project's issue tracker on GitHub or reporting a new issue with detailed information.`
- This is a single-line paragraph with no heading
- The file currently has 197 lines total (no trailing newline after line 197)

**Target state:**
- Replace the final unstructured sentence with a proper heading section
- Point users to GitHub Q&A discussions (vybestack/llxprt-code, not google-gemini)
- This is a **structural change**: converting a bullet-point-style final sentence into a proper `## Not seeing your question?` heading with formatted links

### Change 3: Extension.md branding fixes
**Status:** APPLICABLE (newly identified)

**Current state:**
- Line 87: `# Variables` heading followed by problematic section
- Lines 87-96: Contains "Gemini CLI extensions" and "gemini-extension.json" references
- Table includes `${extensionPath}` description mentioning `.gemini/extensions/example-extension`

**Target state:**
- Replace "Gemini CLI extensions" with "LLxprt Code extensions"
- Replace "gemini-extension.json" with "llxprt-extension.json"
- Replace `.gemini/extensions/example-extension` with `.llxprt/extensions/example-extension`

### Change 4: Troubleshooting.md branding fixes
**Status:** APPLICABLE (newly identified)

**Current state:**
- Line 162: "doesn't enable debug mode for gemini-cli"
- Line 163: "prevent interference with gemini-cli behavior"
- Line 164: "Use a `.gemini/.env` file instead"
- Line 168: "The Gemini CLI uses specific exit codes"

**Target state:**
- Replace "gemini-cli" with "llxprt" (lines 162, 163)
- Replace ".gemini/.env" with ".llxprt/.env" (line 164)
- Replace "The Gemini CLI" with "LLxprt Code" (line 168)

## Implementation Steps

### Step 1: Fix extension.md branding (Lines 87-96)

**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/docs/extension.md`

**Operation 1:** Fix paragraph on line 87

**Exact old_string:**
```
Gemini CLI extensions allow variable substitution in `gemini-extension.json`. This can be useful if e.g., you need the current directory to run an MCP server using `"cwd": "${extensionPath}${/}run.ts"`.
```

**Exact new_string:**
```
LLxprt Code extensions allow variable substitution in `llxprt-extension.json`. This can be useful if e.g., you need the current directory to run an MCP server using `"cwd": "${extensionPath}${/}run.ts"`.
```

**Operation 2:** Fix table row with .gemini reference

**Exact old_string:**
```
| `${extensionPath}`         | The fully-qualified path of the extension in the user's filesystem e.g., '/Users/username/.gemini/extensions/example-extension'. This will not unwrap symlinks. |
```

**Exact new_string:**
```
| `${extensionPath}`         | The fully-qualified path of the extension in the user's filesystem e.g., '/Users/username/.llxprt/extensions/example-extension'. This will not unwrap symlinks. |
```

### Step 2: Fix troubleshooting.md branding (Lines 162-164)

**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/docs/troubleshooting.md`

**Operation 1:** Fix line 162

**Exact old_string:**
```
  - **Issue:** Setting `DEBUG=true` in a project's `.env` file doesn't enable debug mode for gemini-cli.
```

**Exact new_string:**
```
  - **Issue:** Setting `DEBUG=true` in a project's `.env` file doesn't enable debug mode for llxprt.
```

**Operation 2:** Fix line 163

**Exact old_string:**
```
  - **Cause:** The `DEBUG` and `DEBUG_MODE` variables are automatically excluded from project `.env` files to prevent interference with gemini-cli behavior.
```

**Exact new_string:**
```
  - **Cause:** The `DEBUG` and `DEBUG_MODE` variables are automatically excluded from project `.env` files to prevent interference with llxprt behavior.
```

**Operation 3:** Fix line 164

**Exact old_string:**
```
  - **Solution:** Use a `.gemini/.env` file instead, or configure the `excludedProjectEnvVars` setting in your `settings.json` to exclude fewer variables.
```

**Exact new_string:**
```
  - **Solution:** Use a `.llxprt/.env` file instead, or configure the `excludedProjectEnvVars` setting in your `settings.json` to exclude fewer variables.
```

### Step 3: Fix troubleshooting.md branding (Line 168)

**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/docs/troubleshooting.md`

**Operation:** Fix exit codes section heading

**Exact old_string:**
```
The Gemini CLI uses specific exit codes to indicate the reason for termination. This is especially useful for scripting and automation.
```

**Exact new_string:**
```
LLxprt Code uses specific exit codes to indicate the reason for termination. This is especially useful for scripting and automation.
```

### Step 4: Update troubleshooting.md FAQ section (Line 197)

**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/docs/troubleshooting.md`

**Current line count:** 197 lines (no trailing newline)

**Operation:** Use Edit tool to replace the final paragraph

**Exact old_string (line 197):**
```
If you encounter an issue not covered here, consider searching the project's issue tracker on GitHub or reporting a new issue with detailed information.
```

**Exact new_string:**
```
## Not seeing your question?

Search the [LLxprt Code Q&A discussions on GitHub](https://github.com/vybestack/llxprt-code/discussions/categories/q-a) or [start a new discussion](https://github.com/vybestack/llxprt-code/discussions/new?category=q-a)
```

**Technical details:**
- The old_string is the complete final line of content (line 197)
- The new_string adds a level-2 heading followed by formatted links
- This transforms an unstructured final paragraph into a proper FAQ section
- The file will grow from 197 lines to 199 lines (assuming Edit adds trailing newline)
- Links point to `vybestack/llxprt-code` (NOT `google-gemini/gemini-cli`)

### Step 5: Verify Final State

**Files to verify:**

**extension.md:**
1. Line 85: Heading should still be `# Variables`
2. Line 86: Should be blank line
3. Line 87: Should start with "LLxprt Code extensions allow variable substitution in `llxprt-extension.json`"
4. Line 93: Table row for `${extensionPath}` should reference `.llxprt/extensions/example-extension`
5. No occurrences of "Gemini CLI" or "gemini-extension.json" in the Variables section

**troubleshooting.md:**
1. Line 162: Should reference "llxprt" not "gemini-cli"
2. Line 163: Should reference "llxprt behavior" not "gemini-cli behavior"
3. Line 164: Should reference ".llxprt/.env" not ".gemini/.env"
4. Line 168: Should start with "LLxprt Code uses specific exit codes"
5. Line 197: Should contain `## Not seeing your question?`
6. Line 199: Should contain the GitHub discussions links
7. Total line count: 199 lines (with the FAQ section expansion)
8. All links point to `vybestack/llxprt-code` repositories
9. No new references to `gemini-cli` or `.gemini` were introduced

## Files to Modify

| File | Changes | Line Count Change |
|------|---------|-------------------|
| `docs/extension.md` | Fix branding: "Gemini CLI" → "LLxprt Code", "gemini-extension.json" → "llxprt-extension.json", ".gemini" → ".llxprt" | No change (95 lines) |
| `docs/troubleshooting.md` | Fix branding in 4 locations + replace final paragraph with "Not seeing your question?" section | 197 → 199 lines |

## Acceptance Criteria

### Upstream Changes
- [ ] troubleshooting.md line 197 contains `## Not seeing your question?`
- [ ] troubleshooting.md contains formatted links to GitHub Q&A discussions
- [ ] All links point to `vybestack/llxprt-code` (not `google-gemini`)
- [ ] Final line count of troubleshooting.md is 199 lines
- [ ] Structural change documented: converted unstructured paragraph to proper heading section

### Branding Fixes
- [ ] extension.md line 87: "LLxprt Code extensions" (not "Gemini CLI extensions")
- [ ] extension.md line 87: "llxprt-extension.json" (not "gemini-extension.json")
- [ ] extension.md line 93: ".llxprt/extensions/example-extension" (not ".gemini")
- [ ] troubleshooting.md line 162: "llxprt" (not "gemini-cli")
- [ ] troubleshooting.md line 163: "llxprt behavior" (not "gemini-cli behavior")
- [ ] troubleshooting.md line 164: ".llxprt/.env" (not ".gemini/.env")
- [ ] troubleshooting.md line 168: "LLxprt Code uses" (not "The Gemini CLI uses")
- [ ] No new references to `gemini-cli`, `Gemini CLI`, or `.gemini` introduced in modified sections
- [ ] Grep verification: no "gemini-extension.json" references in extension.md
- [ ] Grep verification: no ".gemini" references in modified sections of troubleshooting.md

## Rationale for Adaptations

1. **Repository links:** Changed from `google-gemini/gemini-cli` to `vybestack/llxprt-code` to match our fork
2. **File structure:** Applied to `docs/troubleshooting.md` instead of `docs/faq.md` because LLxprt consolidated FAQ content into troubleshooting
3. **Extension docs typo:** Skipped because LLxprt's `docs/extension.md` structure differs and doesn't contain the upstream typo
4. **Structural improvement:** The change adds proper document structure by converting a loose final sentence into a dedicated section with a heading
5. **Branding consistency:** Fixed all discovered gemini-cli/Gemini CLI references to maintain consistent LLxprt branding throughout modified files
6. **Extension naming:** Changed gemini-extension.json to llxprt-extension.json to match our extension system naming
7. **Path consistency:** Changed .gemini to .llxprt to match our configuration directory structure
