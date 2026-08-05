# Issue 3035 Plan: Make `ast_edit` validation authoritative and its contract accurate

Plan ID: PLAN-20260804-AST-EDIT-AX
Generated: 2026-08-04
Issue: https://github.com/vybestack/llxprt-code/issues/3035

## Accepted behavior

### REQ-3035-1: Document the two-step contract

**Given** an agent inspects the `ast_edit` parameter schema,
**when** it reads the `force` parameter,
**then** the description states that an omitted/false value previews and `true` applies.

The existing preview/apply design remains; `force` is not repurposed as a validation bypass.

### REQ-3035-2: Refuse newly broken AST writes

**Given** apply mode receives an edit whose final candidate content introduces an AST syntax error,
**when** validation compares the candidate with the pre-edit file,
**then** the tool returns a typed failure before writing and the file remains byte-for-byte unchanged.

Pre-existing-only syntax errors do not block an otherwise valid edit. Unsupported file types are not treated as syntax failures. No public override parameter is added.

### REQ-3035-3: Report useful syntax locations

**Given** tree-sitter provides a specific error location,
**when** the tool reports the diagnostic,
**then** that location is preserved.

**Given** tree-sitter reports a whole-file recovery error beginning at line 1 for damage introduced later in the file,
**when** the tool reports the new error,
**then** it identifies the edited region rather than falsely pointing to line 1.

### REQ-3035-4: Keep validation messaging coherent

**Given** an edit resolves a pre-existing syntax error,
**when** apply succeeds,
**then** the result reports that validation passed/resolved the prior error and does not also claim pre-existing errors remain.

**Given** the post-edit file still has only pre-existing errors,
**when** apply succeeds,
**then** the result may identify those remaining errors without classifying them as newly introduced.

### REQ-3035-5: Distinguish unsupported files from validated files

**Given** the edited extension has no supported AST language,
**when** preview or apply reports validation,
**then** it says validation was skipped for an unsupported file type, not passed, and the edit remains writable.

### REQ-3035-6: Keep previews targeted

**Given** an ordinary preview,
**when** context is rendered,
**then** it omits `WORKING SET CONTEXT` and retains the target file's `ENHANCED CONTEXT ANALYSIS`.

No new opt-in schema, setting, or context subsystem is introduced.

### REQ-3035-7: Do not extract code symbols from prose

**Given** Markdown, YAML, text, or another unsupported file contains words such as `classification`, `default`, or `specifies`,
**when** declarations are extracted,
**then** no guessed code declarations are returned.

Fallback extraction for a supported code language that fails normal parsing may remain.

### REQ-3035-8: Report file creation as creation

**Given** apply mode creates a new file with an empty `old_string`,
**when** the write succeeds,
**then** the response identifies file creation and does not report zero replacements.

Existing-file edits continue to report replacement counts.

### REQ-3035-9: Make concurrency errors actionable

**Given** `last_modified` is stale,
**when** preview or apply rejects the edit,
**then** the error remains `FILE_MODIFIED_CONFLICT`, is a plain human-readable string rather than encoded JSON, includes supplied and current timestamps, and tells the caller to re-read and retry.

## Inputs and boundary cases

- Preview: `force` omitted or false; no disk mutation.
- Apply: `force: true`; validation applies to the exact final candidate content.
- Existing clean AST file becomes invalid: reject without mutation.
- Existing invalid AST file remains invalid without a new error: allow and identify pre-existing state.
- Existing invalid AST file becomes valid: allow and report resolution coherently.
- New AST file is invalid: reject and do not create it.
- Unsupported file type: validation is skipped, not failed, and writing remains allowed.
- Parser gives a precise error node: retain it.
- Parser gives a whole-program recovery node at 1:1: identify the edited region.
- IDE-accepted content, if present, is the candidate that must be validated before write.
- Stale mtime always wins over `force`; no write occurs.

## Test-first implementation sequence

1. Add or migrate Bun behavioral tests that fail against current behavior:
   - schema wording;
   - newly introduced broken-brace edit is rejected and the original file remains unchanged;
   - invalid new file is not created;
   - pre-existing-only errors remain writable;
   - error line for the reported brace fixture is near the edit, while already precise parser locations remain precise;
   - resolved/pre-existing messages do not contradict each other;
   - Markdown/text validation is skipped and remains writable;
   - preview omits working-set context but keeps enhanced target context;
   - prose extraction returns no declarations;
   - creation wording;
   - plain actionable mtime mismatch.
2. Run the focused tests and record the expected failures before production changes.
3. Implement the smallest production changes that satisfy the tests:
   - represent unsupported validation explicitly;
   - calculate validation against final candidate content before write;
   - reject newly introduced errors with the existing tool-result error path and a dedicated internal error type if needed;
   - refine whole-file parser recovery locations using the known edit region;
   - correct summary/message branches;
   - remove working-set rendering/collection from preview;
   - skip declaration extraction for unsupported languages;
   - branch apply success wording for creation;
   - replace encoded mtime JSON with actionable text;
   - update the schema description.
4. Run focused tests, the tools workspace suite, and the repository-wide verification gates.

## Integration contract

The existing `ASTEditTool` schema remains the user access point. `ASTEditToolInvocation` remains the preview/apply orchestrator. `calculateEdit`, AST validation, and validation categorization remain internal collaborators. No new registration, command, dependency, workflow, setting, or public abstraction is needed.

The authoritative operation order in apply mode is:

1. Verify path, parameters, occurrences, and `last_modified`.
2. Produce the final candidate content, including IDE-accepted content when applicable.
3. Compare candidate AST status with pre-edit AST status.
4. If a newly introduced syntax error exists, return an error without writing.
5. Otherwise write once and report an accurate outcome.

## Scope exclusions

- No syntax-validation bypass or new override parameter.
- No opt-in working-set-context configuration.
- No adjacent editor-tool cleanup.
- No new dependency, workflow, quality-tool, agent-memory, or lint/config changes.
- No unrelated refactor or test migration.

## Verification gates

- Focused Bun tests for every accepted behavior.
- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`
- DeepThinker review and Open Code Review, with every finding classified as Blocker-Fix, In-scope-Fix, Reject, or Defer.
- PR CI green, CodeRabbit threads triaged/resolved, branch conflict-free, and candidate head descended from current `origin/main`.
