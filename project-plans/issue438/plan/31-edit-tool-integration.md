# Phase 31: Edit Tool & Apply-Patch Integration

## Phase ID
`PLAN-20250212-LSP.P31`

## Prerequisites
- Required: Phase 30a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P30" packages/core/src/lsp/lsp-service-client.ts`
- Expected files from previous phase:
  - `packages/core/src/lsp/lsp-service-client.ts` (fully implemented)
  - `packages/core/src/lsp/types.ts` (shared types)
  - `packages/lsp/` fully implemented and tested (all P03-P26 complete)
- Preflight verification: Phase 00a MUST be completed before any implementation phase

## Requirements Implemented (Expanded)

### REQ-DIAG-010: Edit Tool Diagnostic Feedback
**Full Text**: When the LLM uses the edit tool to modify a file and an LSP server is available for that file's language, the system shall append any error-level diagnostics detected by the LSP server to the edit tool's `llmContent` response, after the success message.
**Behavior**:
- GIVEN: LLM edits `src/utils.ts` via the edit tool, and tsserver is available
- WHEN: The edit succeeds and `lspServiceClient.checkFile('src/utils.ts')` returns `[{severity:'error', line:42, character:5, message:'Type error', code:'ts2322'}]`
- THEN: `llmContent` contains the edit success message FOLLOWED BY `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="src/utils.ts">\nERROR [42:5] Type error (ts2322)\n</diagnostics>`
**Why This Matters**: This is the core value proposition — the LLM sees type errors immediately after editing, enabling self-correction without build commands.

### REQ-DIAG-015: Apply-Patch Tool Diagnostic Feedback
**Full Text**: When the LLM uses the apply-patch tool to modify file content and an LSP server is available for the affected file's language, the system shall append error-level diagnostics to the tool's `llmContent` response, using the same formatting and limits as the edit tool.
**Behavior**:
- GIVEN: LLM applies a patch that modifies `src/handler.ts`
- WHEN: The patch succeeds and diagnostics are available
- THEN: `llmContent` contains patch success message followed by diagnostics for `src/handler.ts`
**Why This Matters**: Apply-patch is another file mutation path; it needs the same diagnostic feedback as edit.

### REQ-DIAG-017: Apply-Patch Single-File Scope Per Modified File
**Full Text**: When apply-patch writes file content, the system shall collect diagnostics for each modified file using single-file scope. If apply-patch only renames or deletes files without writing content, then the system shall not collect diagnostics.
**Behavior**:
- GIVEN: A patch modifies `src/a.ts` and `src/b.ts` (writes content to both)
- WHEN: The patch succeeds
- THEN: Diagnostics collected separately for `src/a.ts` and `src/b.ts`, each with single-file scope
- GIVEN: A patch only renames `src/old.ts` to `src/new.ts` (no content writes)
- WHEN: The patch succeeds
- THEN: No diagnostic collection, no LSP server started
**Why This Matters**: Patches can modify multiple files; each needs independent diagnostic feedback. Rename/delete-only operations should not trigger unnecessary LSP work.

### REQ-DIAG-020: Success Before Diagnostics
**Full Text**: When a mutation tool (edit, write-file, or apply-patch) modifies a file, the system shall complete the file write and return a clear success confirmation before collecting or appending any diagnostics, so that diagnostics cannot be misinterpreted as a mutation failure.
**Behavior**:
- GIVEN: Edit tool modifies a file
- WHEN: File write completes
- THEN: The success message is built FIRST, then diagnostics are appended AFTER
**Why This Matters**: Prevents the LLM from interpreting diagnostics as indicating the edit failed.

### REQ-DIAG-030: Edit/Apply-Patch Single-File Scope
**Full Text**: When the edit or apply-patch tool modifies a file, the system shall report diagnostics only for the edited file (single-file scope).
**Behavior**:
- GIVEN: Edit to `src/types.ts` causes errors in `src/utils.ts`
- WHEN: Edit tool returns
- THEN: Only `src/types.ts` diagnostics shown (not `src/utils.ts`)
**Why This Matters**: Edit tool provides focused, single-file feedback to avoid context bloat.

### REQ-SCOPE-010: Binary Files Ignored
**Full Text**: The system shall collect diagnostics only for text/code files. Binary file writes shall be ignored by the LSP subsystem.
**Behavior**:
- GIVEN: Edit tool writes a binary file (e.g., `.png`)
- WHEN: Write completes
- THEN: No LSP interaction, no diagnostics appended

### REQ-SCOPE-020: No Diagnostics for Deletion/Rename
**Full Text**: The system shall not collect diagnostics for file deletion or rename operations. Only file content writes shall trigger diagnostic collection.

### REQ-SCOPE-025: Apply-Patch Rename/Delete Exclusion
**Full Text**: If an apply-patch operation only deletes or renames files without writing file content, then the system shall not trigger diagnostic collection and shall not start any LSP servers for that operation.
**Behavior**:
- GIVEN: Patch contains only `rename` and `delete` operations
- WHEN: Patch succeeds
- THEN: No `checkFile()` called, no servers started
**Why This Matters**: Prevents unnecessary server startup for non-content operations.

### REQ-SCOPE-030: String-Only Persistence
**Full Text**: The system shall store only the formatted diagnostic string in `llmContent`. Raw LSP diagnostic objects shall not be stored in session message metadata or history.

### REQ-FMT-090: Deterministic File Ordering
**Full Text**: When displaying multi-file diagnostics, the system shall order files deterministically: the edited/written file first, then other files sorted alphabetically by path.

### REQ-GRACE-050: LSP Failure Never Fails Edit
**Full Text**: The system shall wrap every call from mutation tools (edit, write-file, apply-patch) to the LSP service in a try/catch block. A crashing, hanging, or error-returning LSP service shall never cause a mutation tool invocation to fail.
**Behavior**:
- GIVEN: LSP service crashes during `checkFile()` call
- WHEN: Edit tool handles the exception
- THEN: Edit succeeds normally, no diagnostics appended, no error shown
**Why This Matters**: LSP is supplemental; it must never impair core editing functionality.

### REQ-GRACE-055: No User-Visible LSP Error Text on Failure
**Full Text**: If any LSP interaction fails during a file mutation (crash, timeout, error, or unavailability), then the system shall return the normal mutation success response with no user-visible LSP error or timeout text.
**Behavior**:
- GIVEN: `checkFile()` throws an error
- WHEN: Edit tool catches it
- THEN: `llmContent` contains ONLY the normal success message — no "LSP error", no "diagnostic timeout", no "service unavailable"
**Why This Matters**: The LLM should not be confused by error messages about a supplemental feature.

### REQ-TIME-020: Timeout Returns Success Without Diagnostics
**Full Text**: If the LSP server does not respond within the configured timeout, then the system shall return the edit/write success response without diagnostics and without an error or timeout message.

### REQ-GRACE-010: No LSP Server for Language
**Full Text**: If no LSP server is available for a file's language, then the system shall let the edit/write tool behave exactly as it does without LSP — no error, no degradation, no diagnostics appended.
**Behavior**:
- GIVEN: User edits a `.xyz` file for which no LSP server is configured
- WHEN: Edit completes
- THEN: Normal success message returned, no diagnostics, no error
**Why This Matters**: LSP is supplemental; languages without server support must not be penalized.

## Implementation Tasks

### Files to Modify

- `packages/core/src/tools/edit.ts`
  - MODIFY: Add diagnostic integration after file write succeeds
  - MUST include: `@plan:PLAN-20250212-LSP.P31`
  - MUST include: `@requirement:REQ-DIAG-010`, `@requirement:REQ-GRACE-050`
  - MUST follow pseudocode `edit-integration.md` line-by-line:
    - Lines 10-11: Get lspClient from config, check isAlive()
    - Lines 12-15: Try: checkFile(filePath), filter errors
    - Lines 17-25: Format single-file diagnostics with per-file cap
    - Lines 27-28: Catch: silently continue (REQ-GRACE-050/055)
  - LOCATION: After llmSuccessMessageParts construction, before ToolResult creation
  - DO NOT modify existing success message construction
  - DO NOT modify any other part of edit.ts

- `packages/core/src/tools/apply-patch.ts`
  - MODIFY: Add diagnostic integration after file content writes succeed
  - MUST include: `@plan:PLAN-20250212-LSP.P31`
  - MUST include: `@requirement:REQ-DIAG-015`, `@requirement:REQ-DIAG-017`, `@requirement:REQ-SCOPE-025`
  - MUST follow pseudocode `apply-patch-integration.md` line-by-line:
    - Lines 01-39: classifyPatchOperations — pure function that classifies each operation:
      - `create`/`modify` → always a content write
      - `delete` → never a content write
      - `rename` → only a content write if `hasContentChanges === true` (rename+modify)
      - Returns `{ contentWriteFiles: string[], hasAnyContentWrites: boolean }`
    - Lines 51-63: Guard checks and early return if no content writes (REQ-SCOPE-025)
    - Lines 65-90: Per-file diagnostic collection for each content-write file (single-file scope)
    - Lines 92-94: Catch block for graceful degradation (REQ-GRACE-050/055)
  - The classifyPatchOperations function MUST be a separate pure function, not inline logic
  - LOCATION: After patch application success, before returning result
  - DO NOT modify existing patch application logic

### Files to Create

- `packages/core/src/tools/__tests__/edit-lsp-integration.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P31`
  - MUST include: `@requirement:REQ-DIAG-010`
  - Tests (12+):
    1. Edit succeeds without LSP (lspClient undefined) — no diagnostics appended
    2. Edit succeeds with dead LSP client (isAlive=false) — no diagnostics
    3. Edit with live LSP, file has errors — diagnostics in `<diagnostics>` tags in llmContent
    4. Edit with live LSP, file has no errors — no diagnostics block
    5. Edit with live LSP, file has warnings only (default filter) — no diagnostics
    6. Per-file cap applied (maxDiagnosticsPerFile=20)
    7. Overflow suffix: `... and N more` shown when exceeding cap
    8. Only single-file diagnostics (edited file only, REQ-DIAG-030)
    9. LSP error caught silently — edit succeeds (REQ-GRACE-050)
    10. No LSP error text in output on failure (REQ-GRACE-055)
    11. Success message appears BEFORE diagnostics (REQ-DIAG-020)
    12. Binary file edit — no diagnostic collection (REQ-SCOPE-010)

- `packages/core/src/tools/__tests__/apply-patch-lsp-integration.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P31`
  - MUST include: `@requirement:REQ-DIAG-015`, `@requirement:REQ-DIAG-017`, `@requirement:REQ-SCOPE-025`
  - Tests (10+):
    1. Patch modifies one file — diagnostics for that file
    2. Patch modifies two files — diagnostics for each independently (single-file scope)
    3. Patch only renames files — no diagnostic collection (REQ-SCOPE-025)
    4. Patch only deletes files — no diagnostic collection (REQ-SCOPE-025)
    5. Patch renames AND modifies content — diagnostics only for modified files (REQ-DIAG-017)
    6. Patch rename-with-edits: rename A→B with content changes — diagnostics collected for B (new path)
    7. Patch mixed: rename A→B (pure) + modify C + delete D — diagnostics for C only
    8. Patch mixed: rename A→B (with edits) + delete C — diagnostics for B only
    9. Patch with no LSP client — succeeds without diagnostics
    10. Patch with dead LSP — succeeds without diagnostics
    11. LSP error during patch — caught silently, patch succeeds (REQ-GRACE-050)
    12. No LSP error text on failure (REQ-GRACE-055)
    13. Per-file cap and formatting applied same as edit tool (REQ-DIAG-015)
    14. classifyPatchOperations is a pure function: given ops, returns contentWriteFiles correctly

### Required Code Markers

Every function/class/test created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250212-LSP.P31
 * @requirement REQ-DIAG-010
 * @requirement REQ-DIAG-015
 * @requirement REQ-DIAG-017
 * @requirement REQ-GRACE-050
 * @requirement REQ-GRACE-055
 * @requirement REQ-SCOPE-025
 * @pseudocode edit-integration.md lines 10-28
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250212-LSP.P31" packages/core/src/tools/ | wc -l
# Expected: 3+ occurrences (edit.ts, apply-patch.ts, test files)

# Check requirements covered
grep -r "@requirement:REQ-DIAG-010" packages/core/ | wc -l
# Expected: 2+ occurrences

grep -r "@requirement:REQ-DIAG-015" packages/core/ | wc -l
# Expected: 1+ occurrences

grep -r "@requirement:REQ-SCOPE-025" packages/core/ | wc -l
# Expected: 1+ occurrences

# Run phase-specific tests
npx vitest run packages/core/src/tools/__tests__/edit-lsp-integration.test.ts
# Expected: All pass

npx vitest run packages/core/src/tools/__tests__/apply-patch-lsp-integration.test.ts
# Expected: All pass

# Existing edit tests still pass (no regression)
npx vitest run packages/core/src/tools/__tests__/edit.test.ts
# Expected: All pass

# TypeScript compiles
cd packages/core && npx tsc --noEmit
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK markers left in implementation
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/tools/edit.ts packages/core/src/tools/apply-patch.ts | grep -i "lsp\|diagnostic"
# Expected: No matches

# Check for "cop-out" comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/tools/edit.ts packages/core/src/tools/apply-patch.ts | grep -i "lsp\|diagnostic"
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/tools/edit.ts packages/core/src/tools/apply-patch.ts | grep -v "catch\|guard\|alive"
# Expected: No matches in LSP integration code
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] I read REQ-DIAG-010 text
   - [ ] I read the edit.ts implementation (not just checked file exists)
   - [ ] I can explain HOW the requirement is fulfilled: edit succeeds -> checkFile called -> diagnostics formatted -> appended to llmContent
   - [ ] I read REQ-DIAG-015/017 text
   - [ ] I read the apply-patch.ts implementation
   - [ ] I can explain HOW apply-patch collects per-modified-file diagnostics and skips rename/delete-only

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed (no TODO/HACK/STUB)
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments

3. **Would the test FAIL if implementation was removed?**
   - [ ] Edit LSP test verifies actual diagnostics appear in llmContent
   - [ ] Apply-patch LSP test verifies diagnostics per modified file
   - [ ] Tests would catch a broken implementation (not just checking code ran)

4. **Is the feature REACHABLE by users?**
   - [ ] Edit tool is called from the main agent loop
   - [ ] Apply-patch tool is called from the main agent loop
   - [ ] There is a direct path from LLM tool call to diagnostic output

5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] [gap 1 or "none"]
   - [ ] [gap 2 or "none"]

#### Feature Actually Works

```bash
# Manual test command (RUN THIS and paste actual output):
# Note: requires Bun + TypeScript project setup — may need E2E test in P36 for full validation
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "edit src/index.ts and introduce a type error, then check if diagnostics appear"
# Expected behavior: After edit, llmContent includes diagnostics
# Actual behavior: [paste what actually happens]
```

#### Integration Points Verified

- [ ] edit.ts calls config.getLspServiceClient() — verified by reading both files
- [ ] apply-patch.ts calls config.getLspServiceClient() — verified by reading both files
- [ ] checkFile() receives the correct absolute file path — verified by tracing the call
- [ ] Formatted diagnostics appended to llmSuccessMessageParts array — verified by checking array usage
- [ ] try/catch wraps all LSP code — verified by reading catch block

#### Lifecycle Verified

- [ ] Diagnostic collection happens AFTER file write (not before, not during)
- [ ] Async checkFile() is properly awaited (no fire-and-forget)
- [ ] No resource leaks (no open streams, no pending promises)

#### Edge Cases Verified

- [ ] Empty diagnostics list → no diagnostics block in output
- [ ] null/undefined lspServiceClient → graceful skip
- [ ] isAlive() returns false → graceful skip
- [ ] Binary file → no LSP interaction
- [ ] Apply-patch rename-only → no diagnostic collection

## Success Criteria

- Edit tool appends single-file diagnostics after successful edit
- Apply-patch tool appends single-file diagnostics per modified file
- Apply-patch skips diagnostics for rename/delete-only patches
- Existing edit/apply-patch tests still pass (no regression)
- LSP failure never fails the edit or apply-patch
- No LSP error text visible on failure
- 22+ tests pass (12 edit + 10 apply-patch)

## Failure Recovery

If this phase fails:

1. Rollback commands:
   ```bash
   git checkout -- packages/core/src/tools/edit.ts
   git checkout -- packages/core/src/tools/apply-patch.ts
   rm -f packages/core/src/tools/__tests__/edit-lsp-integration.test.ts
   rm -f packages/core/src/tools/__tests__/apply-patch-lsp-integration.test.ts
   ```
2. Files to revert: edit.ts, apply-patch.ts
3. Cannot proceed to Phase 32 until fixed

## Phase Completion Marker

Create: `project-plans/issue438/.completed/P31.md`
Contents:
```markdown
Phase: P31
Completed: YYYY-MM-DD HH:MM
Files Created: [list with line counts]
Files Modified: [list with diff stats]
Tests Added: [count]
Verification: [paste of verification command outputs]
```
