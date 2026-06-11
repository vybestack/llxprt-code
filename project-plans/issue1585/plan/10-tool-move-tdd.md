# Phase 10: Tool Move Behavioral Regression TDD

## Phase ID

`PLAN-20260608-ISSUE1585.P10`

## Purpose

Write or move behavioral tests proving moved tool groups work through packages/tools and existing core registry/scheduler integration. Tests must assert observable behavior — ToolResult content, filesystem state, provider formatted output, storage state, registry/scheduler execution, denial/error behavior. No constructor/interface/delegation-only tests.

## Prerequisites

- Required: P09a completed (move map verified, every file classified).
- **Critical prerequisite**: P06-P08 MUST have created a resolvable stub `packages/tools` package with `package.json`, `tsconfig.json`, and `src/index.ts` before P10 creates test files there. P10 CANNOT create test files in a non-existent or non-resolvable package. Verify module resolution works before proceeding:
  ```bash
  node -e "const p=require('./packages/tools/package.json'); if (!p.name || !p.exports) process.exit(1)"
  npm run typecheck --workspace @vybestack/llxprt-code-tools
  ```
  If this verification fails, P10 MUST NOT proceed — return to P06-P08 to fix the stub package scaffold. Use ESM dynamic import or source-level export manifest scan for verification (NOT CommonJS `require('./packages/tools')`, which fails against an ESM package).
- **Critical prerequisite**: P06-P08 MUST export stub classes/functions for every tool and utility referenced by P10 tests. Before P10 writes any test that imports a symbol from `@vybestack/llxprt-code-tools`, the corresponding stub must exist in `packages/tools/src/`. Stubs may throw `NotYetImplemented`, but import resolution and constructor signatures must match the target public API. Verify via `analysis/tools-public-export-manifest.md` (created in P06-P08) which maps every tested symbol to its export path:
  ```bash
  # Verify all P10-tested symbols have stub exports using ESM dynamic import (NOT CommonJS require)
  # packages/tools is ESM (type: "module"); CommonJS require('./packages/tools') will NOT work
  npm run build --workspace @vybestack/llxprt-code-tools
  node --input-type=module -e "import * as m from '@vybestack/llxprt-code-tools'; const manifest = (await import('./project-plans/issue1585/analysis/tools-public-export-manifest.json', { assert: { type: 'json' } })).default; for (const sym of manifest.symbols) { if (!m[sym]) { console.error('Missing stub: ' + sym); process.exit(1); } }"
  ```
  **Alternative**: If build + dynamic ESM import is not feasible for the test environment, verify exports via source-level export manifest scan instead:
  ```bash
  # Verify all P10-tested symbols have stub exports by scanning source exports
  node -e "const manifest = require('./project-plans/issue1585/analysis/tools-public-export-manifest.json'); for (const sym of manifest.symbols) { const p = require('path'); const fs = require('fs'); const exportFile = p.join('packages', 'tools', 'src', 'index.ts'); if (!fs.existsSync(exportFile)) { console.error('Missing: ' + exportFile); process.exit(1); } const content = fs.readFileSync(exportFile, 'utf8'); if (!content.includes(sym)) { console.error('Missing export: ' + sym + ' in tools/index.ts'); process.exit(1); } }"
  ```
- Artifacts: move-map-final.md, interface/adapter contracts, dependency-relocation-final.md.

## Requirements Implemented

### REQ-TEST-001, REQ-MOVE-001

**Full requirement blocks**: See `plan/requirements-appendix.md` → REQ-BEHAVIORAL-TDD, REQ-BEHAVIOR-PRESERVATION, REQ-TEST-FIXTURE-COUPLING

**Behavior specification**:
- GIVEN: Tool code is still in packages/core (pre-extraction state)
- WHEN: Behavioral regression tests are written before any code moves
- THEN: Tests assert observable ToolResult content, filesystem state, storage state, and provider formatting output; primary assertions are NOT method-call/delegation checks; shell/todo/key-storage tests would fail if the real tool logic is broken

**Why it matters**: If tests only verify delegation, a no-op adapter returns empty values and the test passes, masking real regressions during the move.

## Pre-Extraction Characterization Fixtures

Before any code moves in P11, capture pre-extraction behavioral fixtures as golden outputs. These fixtures serve as baseline assertions that post-extraction behavior must match exactly. **Golden values MUST be captured from actual current tool output before any code moves — do not use placeholder or synthetic values.** All `{ /* captured from actual ... */ }` comments below indicate where real runtime-captured values must be inserted during P10 execution.

### Fixture 1: Provider Formatting Characterization

Capture the exact output of `ToolFormatter.formatToolDeclaration()`, `normalizeToOpenAIToolId()`, `normalizeToHistoryToolId()`, `processToolParameters()`, `doubleEscapeUtils`, and `toolIdNormalization` for representative inputs. **All fixture values MUST be captured from actual current tool execution output at P10 time — they are never hand-authored or placeholder values. The capture script overwrites any initial scaffold content with real output.**

```typescript
// packages/tools/src/__tests__/fixtures/provider-formatting-fixtures.ts
// WARNING: All values in this file MUST be overwritten by the capture script.
// Never hand-author expected values — they must come from actual tool output.
export const TOOL_FORMATTER_FIXTURES = {
  anthropicToolDeclaration: { /* overwritten by capture script output */ },
  openAIToolDeclaration: { /* overwritten by capture script output */ },
  toolIdNormalizationCases: [ /* overwritten by capture script output */ ],
  doubleEscapeCases: [ /* overwritten by capture script output */ ],
};
```

### Fixture 2: Filesystem Tool Output Characterization

Capture the exact ToolResult structure for read/write/edit/glob/grep tools on controlled temp files. **All fixture values MUST be captured from actual current tool execution output at P10 time — they are never hand-authored or placeholder values. The capture script overwrites any initial scaffold content with real output.**

```typescript
// packages/tools/src/__tests__/fixtures/filesystem-tool-fixtures.ts
// WARNING: All values in this file MUST be overwritten by the capture script.
// Never hand-author expected values — they must come from actual tool output.
export const READ_FILE_FIXTURE = { /* overwritten by capture script output */ };
export const WRITE_FILE_FIXTURE = { /* overwritten by capture script output */ };
export const GLOB_FIXTURE = { /* overwritten by capture script output */ };
```

### Fixture 3: Key Storage And Memory Path Characterization

**All fixture values MUST be captured from actual current key storage and memory path behavior at P10 time — they are never hand-authored or placeholder values. The capture script overwrites any initial scaffold content with real output.**

```typescript
// packages/tools/src/__tests__/fixtures/key-storage-fixtures.ts
// WARNING: All values in this file MUST be overwritten by the capture script.
// Never hand-author expected values — they must come from actual tool output.
export const MASK_KEY_FIXTURES = [ /* overwritten by capture script output */ ];
export const SUPPORTED_TOOL_NAMES_FIXTURE = [ /* overwritten by capture script output */ ];
```

## Required Behavioral Regression Tests

### Filesystem Tool Group

Tests in `packages/tools/src/__tests__/filesystem-tools.test.ts`:
- ReadFileTool reads a real temp file and returns content with correct ToolResult.llmContent and ToolResult.returnDisplay
- WriteFileTool writes to a real temp file and filesystem reflects the written content
- DeleteLineRangeTool deletes specified lines from a real temp file and filesystem reflects the deletion
- InsertAtLineTool inserts content at a line in a real temp file and filesystem reflects the insertion
- ReadLineRangeTool reads a specific line range and returns correct content
- GlobTool matches a real temp directory structure and returns ToolResult with file list
- GrepTool searches real temp files and returns matching results
- LsTool lists a real temp directory and returns directory contents

Assert: `ToolResult.llmContent` contains expected content, `ToolResult.returnDisplay` matches pre-extraction fixture, filesystem state after tool execution matches expected state.

### Edit/Apply-Patch/AST Tool Group

Tests in `packages/tools/src/__tests__/edit-ast-tools.test.ts`:
- EditTool applies exact text replacement and returns ToolResult with diff display
- ApplyPatchTool applies unified diff and FileDiff.applied is true after execution
- ASTEditTool performs ast-edit and returns ToolResult with modified content
- ASTGrepTool searches for structural patterns and returns matching AST nodes
- StructuralAnalysisTool performs structural analysis queries and returns results

Assert: `ToolResult.returnDisplay` matches pre-extraction provider formatting fixture, filesystem state reflects edit, diff stats are correct.

### Registry/Scheduler Integration Tests

Tests in `packages/core/src/__tests__/tools-registry-scheduler.test.ts`:
- ToolRegistry registers all built-in tools and `getAllTools()` returns expected names
- ToolRegistry discovers a specific tool by name and returns the correct tool
- CoreToolScheduler dispatches a tool call through registered tools and produces identical ToolResult types
- Tool execution through scheduler produces the same ToolResult.llmContent as direct execution

Assert: Registry returns expected tool names, scheduler execution produces same ToolResult structure as pre-extraction.

### Provider Formatting/ID Normalization Tests

Tests in `packages/providers/src/__tests__/tools-formatting.test.ts`:
- ToolFormatter formats tool declarations for Anthropic and output matches pre-extraction fixture exactly
- ToolFormatter formats tool declarations for OpenAI and output matches pre-extraction fixture exactly
- ToolIdStrategy maps between provider and history IDs and outputs match fixture
- toolIdNormalization normalizes tool names and output matches fixture (snake_case, etc.)
- doubleEscapeUtils processes tool parameters and output matches fixture
- Behavior matches pre-extraction characterization fixture byte-for-byte

Assert: Formatted output matches `provider-formatting-fixtures.ts` exactly.

### Shell Tool Group

Tests in `packages/tools/src/__tests__/shell-tool.test.ts`:
- ShellTool executes through injected IShellExecutionService adapter and returns ToolResult with exit code and output
- ShellTool denial: when IShellExecutionService.isCommandAllowed returns false, tool returns ToolResult with error
- Shell approval/confirmation flow: IToolMessageBus.requestConfirmation is invoked and cancellation produces ToolResult with cancel outcome

**Observable behavior requirements for shell tests:**
- **Primary assertion**: `ToolResult.llmContent` contains expected stdout/stderr content (observable output, not method-call trace)
- **Primary assertion**: `ToolResult.returnDisplay` reflects the shell execution output (observable display, not internal state)
- **Primary assertion**: denial produces `ToolResult` with error content describing the denial (observable error, not just `isCommandAllowed` was called)
- **Primary assertion**: cancel produces `ToolResult` or confirmation outcome reflecting cancellation (observable outcome, not just `requestConfirmation` was called)
- **`toHaveBeenCalled*` assertions are secondary evidence only** — they may appear to verify which adapter method was involved, but the test MUST fail if the real tool logic is broken even when the adapter call happens
- **Enforcement rule**: A valid test asserts: "when the command runs, the ToolResult contains the output and exit code", NOT "when the command runs, the execute method was called". If replacing the real ShellTool with a no-op stub that still calls `execute()` but returns empty ToolResult causes the test to pass, the test is insufficient.
- **Justification required**: Any `toHaveBeenCalled*` assertion must have a comment explaining why the observable behavior assertion alone is insufficient (e.g., "secondary: verifies the correct adapter method was invoked because multiple execution paths exist")

### Todo Tool Group

Tests in `packages/tools/src/__tests__/todo-tools.test.ts`:
- TodoWrite writes todo items and subsequent read returns the written items in ToolResult.llmContent (observable round-trip)
- TodoRead reads todo items and returns them in ToolResult.llmContent
- TodoPause pauses todo continuation; subsequent read reflects pause state or continuation is halted (observable behavioral effect)

**Observable behavior requirements for todo tests:**
- **Primary assertion**: after writing with TodoWrite, subsequent TodoRead returns the written items in `ToolResult.llmContent` (observable state change via round-trip, not just `addTodo` was called)
- **Primary assertion**: after pause with TodoPause, observable behavioral effect — either subsequent read reflects pause state, or the pause prevents continuation (observable outcome, not just `getContextTracker` was called)
- **Primary assertion**: `ToolResult.llmContent` contains the todo items as structured output (observable content output, not just "the method was called")
- **`toHaveBeenCalled*` assertions** (e.g., verifying ITodoService.getTodoStore was called) are **secondary evidence only** — justified only if the observable state change cannot be verified independently
- **Enforcement rule**: A valid test must fail if a no-op TodoService stub that returns empty arrays but still calls `getTodoStore()` is substituted. The test verifies the todo items actually appear in ToolResult, not that the service method was invoked.
- **Justification required**: Any `toHaveBeenCalled*` assertion must have a comment explaining why the observable behavior assertion alone is insufficient

### MCP Tool Group (If In Scope)

Tests in `packages/tools/src/__tests__/mcp-tool.test.ts`:
- DiscoveredMCPTool constructs with IMcpToolService (if moved)
- DiscoveredMCPToolInvocation executes through adapter and returns ToolResult with MCP tool output
- MCP tool name generation works correctly

Assert: ToolResult contains MCP tool response; name generation matches expected pattern.

### Task/List-Subagents/Check-Async-Tasks

Tests in `packages/tools/src/__tests__/subagent-tools.test.ts`:
- TaskTool executes through ISubagentService and returns ToolResult with subagent result
- ListSubagentsTool lists available subagents and returns them in ToolResult
- CheckAsyncTasksTool checks task status through IAsyncTaskService and returns status in ToolResult

Assert: ToolResult contains subagent list/task status; error behavior produces error ToolResult.

### Memory Tool

Tests in `packages/tools/src/__tests__/memory-tool.test.ts`:
- MemoryTool saves content through IStorageService and filesystem reflects the saved file
- MemoryTool reads content and returns it in ToolResult.llmContent
- Key storage path matches pre-extraction behavior (regression for LLXPRT dir/memory path)
- IToolKeyStorage adapter masking works correctly (maskKeyForDisplay fixture match)

Assert: ToolResult contains memory content; LLXPRT dir path resolution matches pre-extraction fixture; key masking matches pre-extraction fixture.

### Tool Key Storage Behavioral Tests

Tests in `packages/tools/src/__tests__/tool-key-storage.test.ts`:
- maskKeyForDisplay masks middle of keys correctly — primary assertion is that the returned string matches the expected masked value (observable string output, not method call count)
- getSupportedToolNames returns expected tool names — primary assertion is that the returned array matches expected names (observable collection content)
- isValidToolKeyName validates tool names correctly — primary assertion is that the returned boolean matches expectation for each input (observable boolean)
- IToolKeyStorage adapter round-trips: after saving a key via `saveKey`, reading it back with `getKey` returns the same key (observable round-trip, not just "saveKey was called")
- IToolKeyStorage adapter deletion: after deleting a key via `deleteKey`, reading it with `getKey` returns null (observable state change, not just "deleteKey was called")
- IToolKeyStorage resolveKey returns keys in the documented resolution order (keychain → encrypted file → keyfile → null) — verify by setting up specific key states and asserting the returned value

**Observable behavior requirements for key-storage tests:**
- **Primary assertion**: masking output string matches expected value (observable string output, not method call count)
- **Primary assertion**: after saving a key via IToolKeyStorage, reading it back returns the same key (observable round-trip, not just "saveKey was called")
- **Primary assertion**: after deleting a key via IToolKeyStorage, reading it returns null (observable state change, not just "deleteKey was called")
- **Primary assertion**: resolveKey returns keys in the documented resolution order (keychain → encrypted file → keyfile → null) — verify by setting up specific key states and asserting the returned value
- **`toHaveBeenCalled*` assertions** for adapter delegation are **secondary evidence only** — justified only if the observable state change cannot be verified independently (e.g., when testing that the adapter handles keychain unavailable by returning null — the observable assertion is "getKey returns null", the `toHaveBeenCalled` is secondary)
- **Enforcement rule**: A test that only asserts `adapter.saveKeytoHaveBeenCalled()` without verifying that `adapter.getKey()` returns the saved value is insufficient.
- **Justification required**: Any `toHaveBeenCalled*` assertion must have a comment explaining why the observable behavior assertion alone is insufficient

### Boundary Scan Tests

Tests in `packages/tools/src/__tests__/boundary-scan.test.ts`:
- packages/tools/src imports zero core/cli/providers modules
- No re-export shim files in packages/core/src/tools/ after cleanup
- packages/tools/package.json has no core/providers dependencies
- test-utils is devDependency-only

Assert: All forbidden import scans return zero; package metadata constraints pass.

## Implementation Tasks

### Step 1: Create Fixture Capture Script

Create `project-plans/issue1585/analysis/capture-pre-extraction-fixtures.mjs`. This script:
- Imports current core tool implementations (before P11 moves)
- Executes representative behavior against temp files/services
- Writes JSON fixtures to `packages/tools/src/__tests__/fixtures/`

Hand-authored placeholder fixture values are **forbidden**. Every golden value must be captured from actual tool execution. The P10 verification will reject placeholder markers:

```bash
# Run fixture capture
node project-plans/issue1585/analysis/capture-pre-extraction-fixtures.mjs
# Reject placeholder markers
! rg -n "captured from actual|placeholder|TODO|/\*" packages/tools/src/__tests__/fixtures
# Expected: exit code 0 (zero placeholder markers)
```

### Step 2: Create Pre-Extraction Characterization Fixtures

Capture current tool output for representative inputs before any code moves. These must compile-pass but may behavior-fail in RED state (see TDD expectations below).

### Step 3: Create/Move Test Files

For each test group above, create the test file in packages/tools or ensure existing tests move with their production code.

**TDD RED state expectations**: In the RED (tests-exist, code-not-yet-moved) state, tests MUST achieve:
- **Compile-pass**: All test files typecheck and compile successfully. Stubs export the correct constructor signatures and types. TypeScript compilation must succeed — failures caused by missing exports, wrong signatures, or unresolved imports are NOT acceptable RED failures.
- **Test-fail (behavior)**: Tests fail because the stubs throw `NotYetImplemented` or return empty/incorrect values at runtime. The failure must be a behavioral assertion failure (e.g., `expect(result.llmContent).toContain(...)` fails because the stub returns empty), NOT an import resolution error, syntax error, or missing export error.
- **Rationale**: Tests that fail due to compilation errors do not verify behavioral correctness — they only verify that imports exist. A test that cannot compile provides no information about whether the behavioral intent is correct. Only behavior-failing tests provide meaningful signal for the GREEN state implementation.

**P10 RED-state evidence requirement**: P10 MUST record and classify expected RED failures. After writing all tests, verify and document:

```bash
# Verify typecheck passes (GREEN state for compilation)
npm run typecheck --workspace @vybestack/llxprt-code-tools
# Expected: exit code 0

# Verify behavioral tests fail with expected RED reasons
npm run test --workspace @vybestack/llxprt-code-tools 2>&1 | tee project-plans/issue1585/.completed/P10-red-state-evidence.txt
# Expected: non-zero exit code, but failures must be behavioral (NotYetImplemented, assertion failures on stub output)
# NOT acceptable: import resolution errors, type errors, missing export errors
```

**RED failure classification**: Record each test failure as:
- **EXPECTED_BEHAVIORAL_RED**: Test fails because stub returns empty/throws NotYetImplemented; assertion on ToolResult.llmContent fails because stub output is wrong. This is the expected and correct RED state.
- **UNACCEPTABLE_COMPILE_RED**: Test fails because of missing export, unresolved import, type mismatch, or syntax error. This is a bug in the test or stub, not a valid RED state. Fix immediately.

**FORBIDDEN: Reverse tests asserting `NotYetImplemented`**: Tests MUST NOT assert that a stub throws `NotYetImplemented`. A test like `expect(() => tool.execute()).toThrow(NotYetImplemented)` is a reverse test — it passes when the stub is wrong and fails when implementation is correct. All RED-state failures must be behavioral assertion failures (e.g., `expect(result.llmContent).toContain(...)`) that fail because the stub returns incorrect/empty values, NOT because the stub throws. If a stub throws `NotYetImplemented`, the test must catch the exception and assert on the resulting error ToolResult — it must NOT assert that the exception was thrown.

P10 completion requires zero UNACCEPTABLE_COMPILE_RED failures and a written list of EXPECTED_BEHAVIORAL_RED classifications in the phase completion artifact.

### Step 3: Ensure Tests Assert Observable Behavior

Each test MUST:
- Assert `ToolResult.llmContent`, `ToolResult.returnDisplay`, `ToolResult.error`, or `ToolResult.suppressDisplay`
- Assert filesystem state (file exists, content matches, permissions)
- Assert provider formatted output matches pre-extraction fixture
- Assert storage state (key stored, key retrieved, key masked correctly)
- Assert registry/scheduler execution produces same ToolResult as direct invocation
- Assert denial/error behavior (unauthorized command, missing file, invalid key)

Each test MUST NOT:
- Assert constructor was called with specific interface type
- Assert adapter delegation method was called (that is mock theater)
- Assert only that files exist or exports are present
- Assert only that a class was instantiated without verifying its output
- Test delegation patterns rather than end-to-end observable outcomes

**Enforcement rule**: If a test can pass by replacing a real implementation with a no-op stub that returns the same type, the test is insufficient. Every test must fail if the real tool logic is broken.

### Mock Hygiene Rules (per review-05)

`packages/tools` tests MUST NOT `vi.mock` the tool, formatter, or registry under test. Infrastructure fakes are allowed only when primary assertions verify observable behavior. Provider mocks may remain only alongside non-mocked formatter integration coverage.

**Allowable infrastructure fakes**:
- Fake filesystem (temp directories, in-memory file services) when testing tool I/O behavior
- Fake IShellExecutionService that returns controlled stdout/stderr/exit codes
- Fake IToolMessageBus that returns confirmation responses
- Fake IToolKeyStorage that stores Keys in memory
- Fake ITodoService with controllable todo state

**Forbidden self-mocking**:
- `vi.mock('../tools/shell')` in shell-tool.test.ts (mocking the tool under test)
- `vi.mock('../formatters/ToolFormatter')` in any tools test (mocking the formatter under test)
- `vi.mock('../tools/tool-registry')` in any tools test (mocking the registry under test)

**Provider mock exception**: `vi.mock('@vybestack/llxprt-code-providers/...')` is allowed in tools tests only if the test includes non-mocked formatter integration coverage (i.e., at least one test path exercises the real ToolFormatter without any provider mocks). This exception exists because providers are a separate package and mocking provider types does not mock the tools code under test.

### Files To Create

- `project-plans/issue1585/analysis/capture-pre-extraction-fixtures.mjs`
- `packages/tools/src/__tests__/fixtures/provider-formatting-fixtures.ts`
- `packages/tools/src/__tests__/fixtures/filesystem-tool-fixtures.ts`
- `packages/tools/src/__tests__/fixtures/key-storage-fixtures.ts`
- `packages/tools/src/__tests__/filesystem-tools.test.ts`
- `packages/tools/src/__tests__/edit-ast-tools.test.ts`
- `packages/tools/src/__tests__/shell-tool.test.ts`
- `packages/tools/src/__tests__/todo-tools.test.ts`
- `packages/tools/src/__tests__/mcp-tool.test.ts`
- `packages/tools/src/__tests__/subagent-tools.test.ts`
- `packages/tools/src/__tests__/memory-tool.test.ts`
- `packages/tools/src/__tests__/tool-key-storage.test.ts`
- `packages/tools/src/__tests__/boundary-scan.test.ts`
- `packages/core/src/__tests__/tools-registry-scheduler.test.ts`
- `packages/providers/src/__tests__/tools-formatting.test.ts`

## Verification Commands

```bash
# Run tools behavioral tests
npm run test --workspace @vybestack/llxprt-code-tools
# Verify behavioral test count
ls packages/tools/src/__tests__/*.test.ts | wc -l
# Verify fixture files exist (not placeholders)
ls packages/tools/src/__tests__/fixtures/*.ts | wc -l
# Reject placeholder markers in fixtures
! rg -n "placeholder|TODO|FIXME|captured output|expected list" packages/tools/src/__tests__/fixtures -g "*.ts"
# Expected: exit code 0 (zero placeholder markers)
# Typecheck — MUST pass (GREEN for compilation)
npm run typecheck --workspace @vybestack/llxprt-code-tools
# Expected: exit code 0
# Record RED-state evidence: behavioral test failures (expected behavioral RED)
npm run test --workspace @vybestack/llxprt-code-tools 2>&1 | tee project-plans/issue1585/.completed/P10-red-state-evidence.txt
# Classify failures as EXPECTED_BEHAVIORAL_RED or UNACCEPTABLE_COMPILE_RED
```

## Semantic Verification Checklist

- [ ] Pre-extraction characterization fixtures captured for provider formatting, filesystem, key storage.
- [ ] Named behavioral regression tests exist for each tool group.
- [ ] Every test asserts observable ToolResult, filesystem state, storage state, or provider output.
- [ ] Zero constructor/interface/delegation-only tests.
- [ ] Tests would fail if real tool logic were broken (no no-op stub pass risk).
- [ ] Boundary scan tests cover forbidden imports and shims.
- [ ] Provider formatting tests verify exact pre-extraction behavior using fixtures.
- [ ] Typecheck passes (GREEN for compilation) — `npm run typecheck --workspace @vybestack/llxprt-code-tools` exits 0.
- [ ] Behavioral tests fail with EXPECTED_BEHAVIORAL_RED reasons only — zero UNACCEPTABLE_COMPILE_RED failures.
- [ ] RED-state evidence recorded in `.completed/P10-red-state-evidence.txt` with classification of each failure.

## Success Criteria

- All behavioral regression test files exist.
- Pre-extraction fixtures captured.
- Tests are ready to verify moved code in P11.

## Failure Recovery

Return to P10 to add missing test groups or tighten assertions.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P10.md` with test file listing, fixture capture evidence, and coverage assessment.
