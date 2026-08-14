# Plan: Issue #3202 — Bounded Acquisition Memory Boundary (Parent)

## Overview

This is the parent-issue PR that completes the remaining accepted scope for
bounded acquisition across all tool subsystems. Prior child issues (#3200,
#3201, #3203, #3204, #3205) established the acquisition primitives
(`packages/tools/src/acquisition`), bounded subprocess output, bounded
external HTTP acquisition, and bounded workspace analysis (references,
dependencies, exports). This PR ties up the remaining blocker and in-scope
findings.

## Accepted Behavior Summary

### A. Shared Acquisition Boundary
- `packages/tools/src/acquisition` is the explicit package subpath for
  acquisition primitives and LLxprt-owned read-loop adapters.
- HTTP response adapter moves from `src/utils` → `src/acquisition`.
- Shared acquisition code may create/validate immutable finite byte budgets
  but must NOT interpret raw settings policy. Move `-1`, default, invalid-string,
  and disabled-value semantics into existing owning core/CLI boundaries.

### B. Grep/Ripgrep and Discovered Tools
- Direct-file grep/ripgrep and JavaScript fallback must not `readFile` and
  `split` whole files before limits. Reuse streaming line framing and semantic
  budget primitives.
- Preserve subprocess early-stop/process-lifecycle ownership and correctness.
- Attach additive structured partial metadata to grep/ripgrep results.

### C. Structural Analysis
- Definitions, hierarchy, callers, and callees must receive `AnalysisBudget`,
  use lazy bounded file traversal, apply the shared pre-read file-size policy,
  enforce finite file and record/result budgets, hard-clamp `maxNodes`,
  preserve exact-boundary/one-over semantics, and report abort/budget partial
  metadata truthfully.

### D. AST Grep
- Hard-validate/cap `maxResults`; bound include/exclude discovery.
- Apply the shared pre-read file-size gate before reading/parsing.
- Report partial results for result, file, oversized-file, and abort limits.

### E. MCP
- Enforce one aggregate finite byte budget across every result field/variant:
  `content`, compatibility `toolResult`, `structuredContent`, `_meta`, and
  extension payloads.
- Reject overflow atomically before display/model transformation; avoid full
  `JSON.stringify` before budget validation.

### F. Read-Many-Files
- Resolve finite hard-clamped file/record and aggregate byte budgets before
  discovery. Use streaming/bounded discovery rather than accumulating all
  paths and limiting later. Report one-over partial discovery explicitly.
- Maintain a finite aggregate acquisition byte budget independent of
  `tool-output-max-tokens`.

## Boundary Cases and Behavioral Evidence Required

- Exact budget and one byte over.
- Empty input.
- One huge source/chunk/line and many tiny chunks/lines/files.
- UTF-8 multibyte characters split at chunk boundaries and CRLF.
- Broad include/exclude globs and discovery one-over.
- Oversized file before parse/read.
- Pre-abort and abort during traversal/read.
- Truthfully partial metadata and non-exhaustive wording end-to-end.
- MCP `toolResult`, `structuredContent`, metadata/extensions, mixed aggregate,
  exact/one-over, atomic failure.
- Structural definitions/hierarchy/callers/callees file/record budgets,
  `maxNodes` hard cap, abort.
- Read-many-files permissive token settings still bounded by byte acquisition
  budget.
- Package subpath/boundary tests.

## Review Finding Classification

### Blocker-Fix
1. Grep/ripgrep direct-file and JS fallback materialization
2. Four unbounded structural modes (definitions, hierarchy, callers, callees)
3. AST-grep unbounded path/match acquisition (pre-read file-size gate)
4. MCP non-content bypass (budget toolResult, structuredContent, _meta)
5. Read-many-files discovery/aggregate token-boundary reliance

### In-scope-Fix
6. Local subprocess/search structured partial metadata
7. Raw setting policy in shared layer
8. HTTP adapter location

### Defer
- True pre-materialization MCP frame cap (SDK has no option)

### Reject
- Replacing specialized prompt/event queues with generic collector
- Defensive open/fstat wrappers for speculative post-stat races
- Workflow redesign

## Implementation Order

1. HTTP adapter relocation (structural, low risk)
2. Raw setting policy move (removes settings coupling from acquisition)
3. Grep direct-file streaming (TDD: failing test → implementation)
4. Grep structured partial metadata
5. Structural analysis four bounded modes
6. AST-grep pre-read file-size gate
7. MCP aggregate budget for all variants
8. Read-many-files streaming discovery + byte budget
