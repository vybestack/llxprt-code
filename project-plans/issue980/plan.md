# Issue #980: Consistent Tool Path Handling

## Problem Statement

Tools have inconsistent path/directory parameter semantics, causing models (especially weaker ones) to waste tokens on avoidable path-format errors:

1. **Shell tool** (`shell.ts`) — accepts absolute paths within workspace OR workspace-root basenames. Rejects relative sub-paths like `src/utils` with `"Directory 'src/utils' is not a registered workspace directory."`. Execution resolves `path.resolve(targetDir, dirPath)` which *would* handle sub-paths correctly, but validation rejects them first.

2. **Grep/SearchText** (`grep.ts`, `ripGrep.ts`) — accepts absolute or relative directory paths. Rejects file paths with `"Path is not a directory"`. Models frequently pass file paths and get this error.

3. **Glob** (`glob.ts`) — accepts absolute or relative directory paths. Rejects file paths with `"Search path is not a directory"`.

4. **File tools** (read-file, write-file, edit, etc.) — require absolute file paths. This is correct and intentional for determinism; no change needed.

## Scope

This plan addresses changes ordered by impact:

- **Change A**: Grep/RipGrep accept file paths (high-frequency model error)
- **Change B**: Shell accepts relative sub-paths (moderate-frequency model error)
- **Change C**: Schema description and system prompt updates (clarity) — **ships only with A+B complete**
- **Out of scope**: Glob and ls file-path acceptance (follow-up issue; note `glob.ts:L364` has similar `isDirectory()` check — future candidate for shared resolver), making file tools accept relative paths (intentional design)

## Design Principles

- **Permissive input, strict canonical execution, explicit output** — accept reasonable path formats but always resolve to a canonical absolute path, validate against workspace boundaries, and use the canonical path for execution. Echo back the resolved path in output so models/users see exactly what was used.
- **Additive only** — all currently-valid inputs remain valid with identical behavior. No backward-incompatible changes.
- **Security boundary unchanged** — `workspaceContext.isPathWithinWorkspace()` remains the universal security gate. No path reaches execution without passing this check. Note: TOCTOU between validation and execution is a known inherent limitation of pathname-based workflows — documented but not solvable without fd-based APIs.
- **TDD per RULES.md** — every behavioral change starts with a failing test.

---

## Change A: Grep/SearchText Accept File Paths

### Current Behavior

Both `grep.ts` and `ripGrep.ts` have duplicated `resolveAndValidatePath` methods (4 copies total: grep invocation L138, grep tool L966, ripGrep invocation L74, ripGrep tool L444). All contain:

```typescript
const stats = fs.statSync(targetPath);
if (!stats.isDirectory()) {
  throw new Error(`Path is not a directory: ${targetPath}`);
}
```

#### Pre-Existing Bug (Fix During Extraction)

The current error handling has an inverted logic bug:
```typescript
catch (error: unknown) {
  if (isNodeError(error) && error.code !== 'ENOENT') {
    throw new Error(`Path does not exist: ${targetPath}`);
  }
  throw new Error(`Failed to access path stats for ${targetPath}: ${error}`);
}
```
This throws "Path does not exist" for errors that are **NOT** ENOENT (like EACCES), and the generic message for actual ENOENT. Additionally, the `"Path is not a directory"` throw from inside the try gets caught by this catch block (it's a plain Error, not a NodeError) and re-wrapped. The shared resolver must fix this.

### Target Behavior

When a file path is provided:
1. Resolve it (same as today: `path.resolve(targetDir, relativePath)`)
2. Validate workspace containment (same as today)
3. Detect it's a file via `stats.isFile()`
4. Return a discriminated union result indicating file-target mode
5. In execution, use **backend-specific file-target strategy** (not parent-dir + include)
6. If the caller also provided an explicit `include` parameter alongside a file path, include a note in the response: `"Note: include filter ignored because a specific file path was provided."` — not silently dropped.

### Refactoring: Extract Shared Search Target Resolver

The `resolveAndValidatePath` method is copy-pasted 4 times across `grep.ts` and `ripGrep.ts`. Before adding file-path logic, extract a shared utility to eliminate duplication. This utility is intentionally scoped to **text search tools only** (grep/ripGrep) — not a general-purpose path resolver. Named accordingly.

**New file: `packages/core/src/utils/resolveTextSearchTarget.ts`**

```typescript
type ResolvedSearchTarget =
  | { kind: 'all-workspaces' }
  | { kind: 'directory'; searchDir: string }
  | { kind: 'file'; filePath: string; parentDir: string; basename: string };

function resolveTextSearchTarget(
  targetDir: string,
  workspaceContext: WorkspaceContext,
  relativePath?: string,
): ResolvedSearchTarget {
  // Discriminated union — no null returns
  // Throws on validation failure (outside workspace, non-existent, etc.)
}
```

The discriminated union approach:
- Eliminates null checks at call sites
- Makes the three cases self-documenting and impossible to forget at call sites
- Aligns with RULES.md preference for explicit types over nullable returns
- Separates "file intent" from implementation detail (no longer buried as inferredInclude)

Parameters: `targetDir: string` and `workspaceContext: WorkspaceContext` (not full `Config`) to keep the utility decoupled.

### Backend-Specific File-Target Execution

When the resolver returns `{ kind: 'file' }`, each grep backend should search the file directly — **not** search the parent directory with an include filter. The parent-dir + include approach would walk potentially large directory trees unnecessarily.

| Backend | Directory mode (existing) | File mode (new) |
|---------|--------------------------|-----------------|
| `git grep` | `git grep -n -E pattern` in `cwd: searchDir` | `git grep -n -E pattern -- filePath` (exact pathspec) |
| System `grep` | `grep -r -n -H -E pattern .` in `cwd: searchDir` | `grep -n -H -E pattern filePath` (no `-r`, direct file) |
| Ripgrep | `rg --line-number pattern searchDir` | `rg --line-number pattern filePath` (direct file path) |
| JS fallback | Glob walk + regex match | `fs.readFile(filePath)` + regex match (skip glob entirely) |

This is more performant (no directory traversal) and semantically cleaner.

### Files Modified

| File | Change |
|------|--------|
| `packages/core/src/utils/resolveTextSearchTarget.ts` | **NEW** — shared search target resolver with fixed error handling |
| `packages/core/src/tools/grep.ts` | Replace both `resolveAndValidatePath` with `resolveTextSearchTarget`; branch `performGrepSearch` for file mode; update `getDescription()` for file paths |
| `packages/core/src/tools/ripGrep.ts` | Replace both `resolveAndValidatePath` with `resolveTextSearchTarget`; branch `performRipgrepSearch` for file mode; update `getDescription()` for file paths |
| `packages/core/src/tools/grep.test.ts` | Update L119 test ("should return error if path is a file") → now succeeds; add new tests |
| `packages/core/src/tools/ripGrep.test.ts` | Update L166 test → now succeeds; add new tests |
| `packages/core/src/utils/__tests__/resolveTextSearchTarget.test.ts` | **NEW** — unit tests for shared resolver |

### Test Plan (TDD Order)

#### Phase 1: Shared Resolver Tests (`resolveTextSearchTarget.test.ts`)

Tests focus on **observable behavior** — what the function returns or throws — not internal mechanisms like symlink resolution (which is `WorkspaceContext`'s responsibility).

1. **RED**: `should return kind 'all-workspaces' when no path provided`
2. **RED**: `should return kind 'directory' for valid directory path`
3. **RED**: `should return kind 'file' with filePath, parentDir, basename for valid file path`
4. **RED**: `should throw for path outside workspace`
5. **RED**: `should throw with clear message for non-existent path (ENOENT)`
6. **RED**: `should throw with clear message for permission denied (EACCES)`
7. **RED**: `should handle absolute directory path`
8. **RED**: `should handle absolute file path`
9. **RED**: `should handle relative path with dot prefix (e.g., "./src")`

After each RED, implement the minimal code in `resolveTextSearchTarget.ts` to go GREEN.

#### Phase 2: Grep Integration Tests (`grep.test.ts`)

1. **Update existing test** (L119): Change assertion from expecting error to expecting successful single-file search
2. **RED**: `should search within a specific file and return only matches from that file`
3. **RED**: `should emit note when file path provided alongside explicit include`
4. **RED**: `should handle file path in subdirectory correctly`
5. **RED**: `should display description as 'pattern' in filename when file path provided`

#### Phase 3: RipGrep Integration Tests (`ripGrep.test.ts`)

Mirror the grep test changes for ripGrep.

### Edge Cases

- **File at workspace root**: `parentDir` returns the workspace root. In file-target mode, the search targets the file directly, not the directory. No issue.
- **Binary file path**: Grep strategies already skip binaries (`-I` flag for system grep, ripgrep auto-skips). No special handling needed.
- **Include parameter with file path**: Not silently dropped — response includes a note explaining the include was ignored because a specific file was targeted. This prevents model confusion.

---

## Change B: Shell Accepts Relative Sub-Paths

### Current Behavior

`shell.ts` `validateToolParamValues` (L837-859):
- Absolute path → `isPathWithinWorkspace()` check → accept/reject
- Non-absolute → basename match against workspace root directories only → accept/reject

This means `dir_path: "src/utils"` fails because `"src/utils"` doesn't match any workspace root basename.

### Target Behavior

For non-absolute paths, add a resolution step before the basename fallback:

1. `path.resolve(targetDir, dirPath)` → get candidate absolute path
2. If path contains a separator (`/`): resolve and validate directly — do NOT fall back to basename matching (multi-segment paths are unambiguously relative sub-paths, never workspace root selectors)
3. If path is a single segment (no separator): try resolving first, then fall back to basename matching (preserves backward compat for workspace root selection like `"packages"`)
4. For resolved paths: `isPathWithinWorkspace(candidate)` → if true AND `fs.existsSync(candidate)` AND `fs.statSync(candidate).isDirectory()` → accept
5. Otherwise: clear error message

This eliminates the validation-execution semantic mismatch (execution already does `cwd = path.resolve(targetDir, dirPath)`) and prevents the subtle edge case where `dir_path: "foo"` intended as a relative subdir could accidentally match a workspace root named "foo" elsewhere.

### Files Modified

| File | Change |
|------|--------|
| `packages/core/src/tools/shell.ts` | Update `validateToolParamValues` (L846-858); note: `fs` is already imported |
| `packages/core/src/tools/shell.test.ts` | Update L171-177 test; add new tests; note: test mocks `fs` globally — `statSync` mock setup needed |
| `packages/core/src/tools/__tests__/shell-params.test.ts` | Possibly add relative sub-path test |

### Test Plan (TDD Order)

1. **Update existing test** (shell.test.ts L171): `"should throw an error for a non-existent directory"` — change from `'rel/path'` to verify it still produces an appropriate error for non-existent resolved paths
2. **RED**: `should accept relative sub-path that resolves within workspace` — e.g., `dir_path: "packages/core"` when workspace is the repo root
3. **RED**: `should reject relative path that resolves outside workspace` — e.g., `dir_path: "../../etc"`
4. **RED**: `should reject relative path to non-existent directory` — e.g., `dir_path: "nonexistent/path"`
5. **RED**: `should still accept workspace basename for backward compatibility` — existing behavior preserved
6. **RED**: `should still accept absolute path within workspace` — existing behavior preserved
7. **RED**: `should accept "." as dir_path resolving to target directory`
8. **RED**: `should handle trailing slashes in relative paths`

### Edge Cases

- **Trailing slashes**: `path.resolve` normalizes these. No issue.
- **`"."` as dir_path**: Resolves to `targetDir` which is always within workspace. Should work.
- **`".."` traversal**: `path.resolve(targetDir, "../../etc")` → `/etc` → fails `isPathWithinWorkspace`. Correctly rejected.
- **Multi-workspace same basename**: For single-segment inputs, basename fallback is preserved. For multi-segment paths (`a/b`), always resolve relative to targetDir — no basename ambiguity.
- **Multi-segment path matching workspace root by accident**: E.g., `dir_path: "foo/bar"` where a workspace root happens to be named "bar". Because it contains `/`, it's resolved relative to targetDir, never matched by basename. This is the correct behavior.

---

## Change C: Schema Descriptions and System Prompt Updates

**IMPORTANT**: Change C ships only when both A and B are complete. Updating descriptions before behavior changes would teach models wrong assumptions.

### Tool Schema Updates

**grep.ts L919-920** — `dir_path` description:
```
Current:  'Optional: The absolute path to the directory to search within. If omitted, searches the current working directory.'
Proposed: 'Optional: The path to search within — can be a directory (searches recursively) or a file (searches only that file). Accepts absolute or relative paths. If omitted, searches all workspace directories.'
```

**ripGrep.ts L422** — `path` description:
```
Current:  'Optional: The absolute path to the directory to search within. If omitted, searches the current working directory.'
Proposed: 'Optional: The path to search within — can be a directory (searches recursively) or a file (searches only that file). Accepts absolute or relative paths. If omitted, searches all workspace directories.'
```

**shell.ts L796-797** — `dir_path` description:
```
Current:  '(OPTIONAL) Directory to run the command in. Provide a workspace directory name (e.g., "packages") or an absolute path within the workspace.'
Proposed: '(OPTIONAL) Directory to run the command in. Provide a workspace directory name (e.g., "packages"), a relative path (e.g., "src/utils"), or an absolute path within the workspace.'
```

### System Prompt Updates

**`packages/core/src/prompt-config/defaults/core.md` L30**:
```
Current:  - **Path Construction:** Before using any file system tool, you must construct the full absolute path...
Proposed: - **Path Construction:** Before using file-modifying tools (e.g., read_file, write_file, replace, insert_at_line, delete_line_range, read_line_range), you must construct the full absolute path. Combine the project root with the file's path relative to the root. Search tools (search_file_content, glob) and run_shell_command also accept relative paths within the workspace.
```

**`packages/core/src/prompt-config/defaults/core.md` L57**:
```
Current:  - **File Operations:** Always construct absolute paths by combining project root with relative paths.
Proposed: - **File Operations:** Construct absolute paths for file read/write/edit tools. Search tools (search_file_content, glob) and run_shell_command also accept relative paths.
```

Provider-specific core.md files (gemini, flash) need analogous updates. Keep wording tool-specific to avoid overgeneralizing to glob/ls which are not yet updated.

### Files Modified

| File | Change |
|------|--------|
| `packages/core/src/tools/grep.ts` | Schema description update |
| `packages/core/src/tools/ripGrep.ts` | Schema description update |
| `packages/core/src/tools/shell.ts` | Schema description update |
| `packages/core/src/prompt-config/defaults/core.md` | L30, L57 |
| `packages/core/src/prompt-config/defaults/providers/gemini/core.md` | L29, L84 |
| `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-2.5-flash/core.md` | L29, L84 |
| `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-2.5-flash/gemini-2-5-flash/core.md` | L29, L84 |

---

## Implementation Order

1. **Extract `resolveTextSearchTarget.ts`** with tests — includes fixing the pre-existing error-handling bug (Change A foundation)
2. **Update `grep.ts`** to use shared resolver + accept file paths with backend-specific file mode, with tests
3. **Update `ripGrep.ts`** to use shared resolver + accept file paths with backend-specific file mode, with tests
4. **Update `shell.ts`** validation for relative sub-paths with separator-aware fallback rules, with tests (Change B)
5. **Update schema descriptions** across all three tools (Change C — only after A+B verified)
6. **Update system prompt `.md` files** (Change C — only after A+B verified)
7. **Run full verification cycle**: `npm run test && npm run lint && npm run typecheck && npm run format && npm run build`

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Security: path traversal via relative paths | Low | `isPathWithinWorkspace()` uses realpath-based containment check on all resolved paths |
| Security: TOCTOU between validation and execution | Low | Inherent to pathname-based workflows; documented, not solvable without fd-based APIs |
| Backward compatibility: existing valid inputs break | None | All changes are strictly additive |
| Test breakage: assertions on old error messages | Medium | Tests explicitly updated in plan |
| Multi-workspace ambiguity for shell sub-paths | Low | Separator-aware fallback: multi-segment paths never fall back to basename matching |
| Grep include parameter conflict with file path | Low | Explicit note in response when include is overridden; not silent |
| Performance: file-path grep in large dirs | None | Backend-specific file-target mode avoids directory traversal entirely |
| Shell `fs.statSync` in test mocks | Low | Tests already mock `fs` globally; add `statSync` mock setup |
| Platform differences (Windows paths) | Low | `path.resolve` and `isPathWithinWorkspace` handle platform normalization; add Windows-like input tests if cross-platform CI exists |

## Follow-Up Items (Not in This PR)

- Glob tool: migrate to use `resolveTextSearchTarget` or similar for file-path acceptance
- ls tool: consider accepting file paths to return single-file info
- Consider deprecating shell basename shorthand long-term (warn in docs first)

## Verification Checklist

- [ ] All existing tests pass (no regressions)
- [ ] New tests cover: file path in grep, file path in ripgrep, relative sub-path in shell, shared resolver edge cases
- [ ] `getDescription()` updated and tested for file-path display in grep/ripGrep
- [ ] Include-override note tested for grep/ripGrep file-path + include combo
- [ ] Pre-existing ENOENT error-handling bug fixed in shared resolver
- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run format` passes
- [ ] `npm run build` passes
- [ ] `node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"` completes successfully

---

## Review Feedback Integration

This plan incorporates feedback from both TypeScript Expert and Deep Thinker reviews:

### From TypeScript Expert (Approve with Changes)
- [OK] **Discriminated union** instead of `null` return — adopted (`ResolvedSearchTarget` with `kind` field)
- [OK] **Fix pre-existing ENOENT bug** — explicitly called out and will be fixed in shared resolver
- [OK] **Include override transparency** — changed from silent drop to explicit note in response
- [OK] **Remove symlink tests from Phase 1** — removed (symlink behavior is `WorkspaceContext`'s responsibility)
- [OK] **Add `getDescription()` test coverage** — added to Phase 2 test plan
- [OK] **Acknowledge extraction justification** — extraction pays for itself immediately since new behavior would need 4-way copy-paste otherwise

### From Deep Thinker (Approve with Revisions)
- [OK] **Narrow abstraction scope** — renamed to `resolveTextSearchTarget`, explicitly scoped to grep/ripGrep
- [OK] **Backend-specific file-target execution** — full strategy table added (direct file path, no dir traversal)
- [OK] **Tighter shell fallback rules** — separator-aware: multi-segment paths never fall back to basename
- [OK] **TOCTOU documented as inherent limitation** — not overpromised
- [OK] **Rollout ordering enforced** — Change C gated on A+B completion
- [OK] **Model-facing transparency** — include-override note in response, `getDescription()` updated for file paths
