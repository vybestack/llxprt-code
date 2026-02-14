# Phase 14: /key Commands TDD

## Phase ID

`PLAN-20260211-SECURESTORE.P14`

## Prerequisites

- Required: Phase 13a completed
- Verification: `ls .completed/P13a.md`
- Expected: keyCommand.ts with subcommand parsing structure

## Requirements Implemented (Expanded)

### R12: /key Commands — Subcommand Parsing

#### R12.1 — Event-Driven
**Full Text**: When the user enters `/key` followed by arguments, the command handler shall split the arguments by whitespace and check the first token against the subcommand names: `save`, `load`, `show`, `list`, `delete`.
**Behavior**:
- GIVEN: `/key save mykey sk-abc`
- WHEN: Command handler receives argument string
- THEN: Splits by whitespace, identifies `save` as subcommand, dispatches to save handler
**Why This Matters**: Foundational parsing test — validates the dispatch mechanism.

#### R12.2 — Event-Driven
**Full Text**: When the first token matches a subcommand name, the command handler shall dispatch to the corresponding subcommand handler.
**Behavior**:
- GIVEN: `/key load mykey`
- WHEN: First token `load` is matched
- THEN: Load handler is invoked with remaining args
**Why This Matters**: Ensures dispatch table routes correctly.

#### R12.3 — Event-Driven
**Full Text**: When the first token does not match any subcommand name, the command handler shall treat the entire argument string as a raw API key and invoke the existing legacy behavior (ephemeral session key set).
**Behavior**:
- GIVEN: `/key sk-abc123` (not a subcommand)
- WHEN: `sk-abc123` doesn't match any subcommand
- THEN: Entire string treated as raw API key via legacy path
**Why This Matters**: Backward compatibility — existing usage must not break.

#### R12.4 — Event-Driven
**Full Text**: When `/key` is entered with no arguments, the command handler shall show the current key status for the active provider.
**Behavior**:
- GIVEN: `/key` (no arguments)
- WHEN: Command handler receives empty args
- THEN: Shows current key status
**Why This Matters**: Discoverability — users check their key state.

#### R12.5 — Ubiquitous
**Full Text**: Subcommand name matching shall be case-sensitive. `save` is a subcommand; `SAVE` is treated as a raw key via the legacy path.
**Behavior**:
- GIVEN: `/key SAVE mykey sk-abc`
- WHEN: `SAVE` checked against subcommand names
- THEN: No match → legacy path (case-sensitive matching)
**Why This Matters**: Prevents uppercase API key prefixes from being intercepted as subcommands.

#### R12.6 — Ubiquitous
**Full Text**: The command handler shall trim leading and trailing whitespace from the argument string before parsing tokens.
**Behavior**:
- GIVEN: `/key   save  mykey  sk-abc  ` (extra whitespace)
- WHEN: Argument string is received
- THEN: Trimmed before splitting — dispatches to save handler correctly
**Why This Matters**: Robustness against stray whitespace.

### R13: /key save

#### R13.1 — Event-Driven
**Full Text**: When `/key save <name> <api-key>` is entered, the command handler shall validate the name, then store the key via `ProviderKeyStorage.saveKey()`, and confirm with a masked display using `maskKeyForDisplay`.
**Behavior**:
- GIVEN: `/key save mykey sk-abc123`
- WHEN: Save handler runs
- THEN: Key stored via `ProviderKeyStorage.saveKey()`, confirmation shown with masked key
**Why This Matters**: Core save — tests must verify round-trip storage and masked confirmation.

#### R13.2 — Event-Driven
**Full Text**: When `/key save <name>` is entered for a name that already exists in the keyring and the session is interactive, the command handler shall prompt the user for confirmation before overwriting.
**Behavior**:
- GIVEN: Key `mykey` already exists, session is interactive
- WHEN: `/key save mykey new-sk-abc`
- THEN: Confirmation prompt shown before overwriting
**Why This Matters**: Tests must verify interactive overwrite prompt flow.

#### R13.3 — State-Driven
**Full Text**: While the session is non-interactive (piped input, `--prompt` flag), `/key save` with an existing name shall fail with an error. Overwriting requires interactive confirmation.
**Behavior**:
- GIVEN: Key `mykey` already exists, session is non-interactive
- WHEN: `/key save mykey new-sk-abc`
- THEN: Operation fails with error
**Why This Matters**: Tests must verify non-interactive mode rejects overwrites.

#### R13.4 — Unwanted Behavior
**Full Text**: If `/key save <name>` is entered without an API key value, the command handler shall return an error: `API key value cannot be empty.`
**Behavior**:
- GIVEN: `/key save mykey` (no key value)
- WHEN: Save handler parses arguments
- THEN: Returns error: `API key value cannot be empty.`
**Why This Matters**: Tests must verify exact error message text.

#### R13.5 — Unwanted Behavior
**Full Text**: If `/key save` is entered without a name or key, the command handler shall return an error with a usage hint.
**Behavior**:
- GIVEN: `/key save` (no name or key)
- WHEN: Save handler parses arguments
- THEN: Returns error with usage hint
**Why This Matters**: Tests must verify usage hint is shown.

### R14: /key load

#### R14.1 — Event-Driven
**Full Text**: When `/key load <name>` is entered and the named key exists, the command handler shall retrieve the key via `ProviderKeyStorage.getKey()` and set it as the active provider API key for the session (same effect as `/key <raw-key>`).
**Behavior**:
- GIVEN: Key `mykey` exists with value `sk-abc123`
- WHEN: `/key load mykey`
- THEN: Key retrieved and set as active session API key
**Why This Matters**: Tests must verify the key actually becomes the active session key.

#### R14.2 — Unwanted Behavior
**Full Text**: If `/key load <name>` is entered and the named key does not exist, the command handler shall return: `Key '<name>' not found. Use '/key list' to see saved keys.`
**Behavior**:
- GIVEN: Key `notexist` does not exist
- WHEN: `/key load notexist`
- THEN: Returns: `Key 'notexist' not found. Use '/key list' to see saved keys.`
**Why This Matters**: Tests must verify exact error message text.

#### R14.3 — Unwanted Behavior
**Full Text**: If `/key load` is entered without a name, the command handler shall return an error with a usage hint.
**Behavior**:
- GIVEN: `/key load` (no name)
- WHEN: Load handler parses arguments
- THEN: Returns error with usage hint
**Why This Matters**: Tests must verify usage hint is shown.

### R15: /key show

#### R15.1 — Event-Driven
**Full Text**: When `/key show <name>` is entered and the named key exists, the command handler shall display a masked preview of the key using `maskKeyForDisplay` and the key length: `<name>: <masked> (<length> chars)`.
**Behavior**:
- GIVEN: Key `mykey` exists with value `sk-abc123`
- WHEN: `/key show mykey`
- THEN: Displays masked preview with length: `mykey: sk-a•••23 (10 chars)`
**Why This Matters**: Tests must verify masked output format and length display.

#### R15.2 — Unwanted Behavior
**Full Text**: If `/key show <name>` is entered and the named key does not exist, the command handler shall return: `Key '<name>' not found. Use '/key list' to see saved keys.`
**Behavior**:
- GIVEN: Key `notexist` does not exist
- WHEN: `/key show notexist`
- THEN: Returns: `Key 'notexist' not found. Use '/key list' to see saved keys.`
**Why This Matters**: Consistent not-found error — tests verify exact message.

### R16: /key list

#### R16.1 — Event-Driven
**Full Text**: When `/key list` is entered, the command handler shall retrieve all key names via `ProviderKeyStorage.listKeys()` and display each name with its masked value using `maskKeyForDisplay`, sorted alphabetically.
**Behavior**:
- GIVEN: Keys `beta` and `alpha` exist
- WHEN: `/key list`
- THEN: Both displayed alphabetically with masked values
**Why This Matters**: Tests must verify sort order and masked display.

#### R16.2 — Event-Driven
**Full Text**: When `/key list` is entered and no keys are stored, the command handler shall display a message indicating no saved keys exist.
**Behavior**:
- GIVEN: No keys stored
- WHEN: `/key list`
- THEN: Displays "no saved keys" message
**Why This Matters**: Tests must verify empty-state handling.

### R17: /key delete

#### R17.1 — Event-Driven
**Full Text**: When `/key delete <name>` is entered in an interactive session and the named key exists, the command handler shall prompt for confirmation, then remove the key via `ProviderKeyStorage.deleteKey()` and confirm: `Deleted key '<name>'`.
**Behavior**:
- GIVEN: Key `mykey` exists, session is interactive, user confirms
- WHEN: `/key delete mykey`
- THEN: Key deleted, confirmation: `Deleted key 'mykey'`
**Why This Matters**: Tests must verify confirmation prompt flow and deletion.

#### R17.2 — State-Driven
**Full Text**: While the session is non-interactive, `/key delete` shall fail with an error. Deletion requires interactive confirmation.
**Behavior**:
- GIVEN: Session is non-interactive
- WHEN: `/key delete mykey`
- THEN: Operation fails with error
**Why This Matters**: Tests must verify non-interactive mode rejects deletions.

#### R17.3 — Unwanted Behavior
**Full Text**: If `/key delete <name>` is entered and the named key does not exist, the command handler shall return: `Key '<name>' not found. Use '/key list' to see saved keys.`
**Behavior**:
- GIVEN: Key `notexist` does not exist
- WHEN: `/key delete notexist`
- THEN: Returns: `Key 'notexist' not found. Use '/key list' to see saved keys.`
**Why This Matters**: Consistent not-found error across all subcommands.

#### R17.4 — Unwanted Behavior
**Full Text**: If `/key delete` is entered without a name, the command handler shall return an error with a usage hint.
**Behavior**:
- GIVEN: `/key delete` (no name)
- WHEN: Delete handler parses arguments
- THEN: Returns error with usage hint
**Why This Matters**: Tests must verify usage hint is shown.

### R18: /key — Storage Failure

#### R18.1 — Unwanted Behavior
**Full Text**: If both the OS keyring and the encrypted file fallback are unavailable when any `/key` subcommand (`save`, `load`, `show`, `list`, `delete`) is invoked (i.e., `ProviderKeyStorage` operations throw), the command handler shall return an actionable error. When the keyring is unavailable but encrypted file fallback is functional, `/key` subcommands shall continue to work via the fallback path.
**Behavior**:
- GIVEN: Both OS keyring and fallback are unavailable
- WHEN: Any `/key` subcommand is invoked
- THEN: Returns actionable error (not a stack trace)
**Why This Matters**: Tests must verify graceful degradation with user-friendly messages.

### R19: /key — Autocomplete

#### R19.1 — Event-Driven
**Full Text**: When the user is typing `/key load`, `/key show`, or `/key delete`, the command handler shall provide autocomplete suggestions from `ProviderKeyStorage.listKeys()`.
**Behavior**:
- GIVEN: Keys `alpha` and `beta` exist
- WHEN: User is typing `/key load ` (requesting completions)
- THEN: Autocomplete returns `['alpha', 'beta']`
**Why This Matters**: Tests must verify correct suggestion list for load/show/delete.

#### R19.2 — Event-Driven
**Full Text**: When the user is typing `/key save`, the command handler shall autocomplete the first argument against existing key names (for overwrite awareness).
**Behavior**:
- GIVEN: Key `mykey` exists
- WHEN: User is typing `/key save ` (requesting completions)
- THEN: Autocomplete returns `['mykey']` (overwrite awareness)
**Why This Matters**: Tests must verify save also provides suggestions.

#### R19.3 — Unwanted Behavior
**Full Text**: If the keyring is unavailable during autocomplete, the command handler shall return an empty list rather than an error.
**Behavior**:
- GIVEN: Keyring is unavailable
- WHEN: Autocomplete triggered for `/key load `
- THEN: Returns empty list (no error)
**Why This Matters**: Tests must verify autocomplete fails silently.

### R20: /key — Secure Input Masking

#### R20.1 — Event-Driven
**Full Text**: When `/key save <name> <api-key>` is entered, the secure input handler shall mask the API key value (third token) in display/transcript while leaving the subcommand and name visible.
**Behavior**:
- GIVEN: User enters `/key save mykey sk-abc123`
- WHEN: Input processed for display/transcript
- THEN: Value masked; subcommand and name remain visible
**Why This Matters**: Tests must verify selective masking (name visible, value hidden).

#### R20.2 — Ubiquitous
**Full Text**: The existing secure input masking for `/key <raw-key>` (legacy path) shall continue to function unchanged.
**Behavior**:
- GIVEN: User enters `/key sk-abc123` (legacy path)
- WHEN: Input processed for display/transcript
- THEN: Masking behavior identical to current implementation
**Why This Matters**: Tests must verify legacy masking is not regressed.

### R27.2: Table-Driven Parser Tests

#### R27.2 — Ubiquitous
**Full Text**: The `/key` command parser shall have table-driven tests covering each subcommand, the legacy fallback path, and edge cases including missing arguments, case sensitivity, and whitespace handling (per #1355 acceptance criteria).
**Behavior**:
- GIVEN: A table of test cases with input strings and expected parse results
- WHEN: Each test case is run through the parser
- THEN: All subcommands, legacy fallback, edge cases covered systematically
**Why This Matters**: Explicit acceptance criterion from #1355 — ensures comprehensive parser coverage via parameterized tests.

## Implementation Tasks

### Files to Create

- `packages/cli/src/ui/commands/keyCommand.test.ts` — Comprehensive behavioral tests
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P14`
  - MUST include: `@requirement` markers for R12-R20, R27.2

### Required Tests (minimum 25 behavioral tests)

#### Table-Driven Parsing Tests (R27.2)
```typescript
const parsingTestCases = [
  { input: 'save mykey sk-abc', expected: { subcommand: 'save', name: 'mykey', value: 'sk-abc' } },
  { input: 'load mykey', expected: { subcommand: 'load', name: 'mykey' } },
  { input: 'show mykey', expected: { subcommand: 'show', name: 'mykey' } },
  { input: 'list', expected: { subcommand: 'list' } },
  { input: 'delete mykey', expected: { subcommand: 'delete', name: 'mykey' } },
  { input: 'sk-abc123', expected: { subcommand: null, legacyKey: 'sk-abc123' } },
  { input: 'SAVE mykey sk-abc', expected: { subcommand: null, legacyKey: 'SAVE mykey sk-abc' } },
  { input: '', expected: { subcommand: null, showStatus: true } },
  { input: '  save  mykey  sk-abc  ', expected: { subcommand: 'save', name: 'mykey', value: 'sk-abc' } },
];
```

#### /key save Tests
1. Save stores key, displays masked confirmation
2. Save with existing key prompts overwrite (interactive)
3. Save with existing key in non-interactive → error
4. Save overwrite confirmed → stores new value
5. Save overwrite cancelled → original preserved
6. Save missing API key → "API key value cannot be empty"
7. Save missing name and key → usage hint
8. Save invalid name → validation error message

#### /key load Tests
9. Load existing key sets session API key
10. Load non-existent key → not found error
11. Load missing name → usage hint

#### /key show Tests
12. Show existing key displays masked preview with length
13. Show non-existent key → not found error

#### /key list Tests
14. List shows all keys with masked values
15. List with no saved keys → empty message

#### /key delete Tests
16. Delete with confirmation removes key
17. Delete in non-interactive → error
18. Delete non-existent key → not found error
19. Delete missing name → usage hint
20. Delete cancelled → key preserved

#### Storage Failure (R18.1)
21. Storage unavailable → actionable error message

#### Autocomplete (R19)
22. Autocomplete subcommand names
23. Autocomplete key names for load/show/delete
24. Autocomplete returns empty on storage error

#### Secure Input (R20)
25. `/key save name value` masks the value in display
26. `/key rawkey` legacy masking unchanged

#### Legacy Path
27. Non-subcommand token → legacy set key behavior
28. Case-sensitive: SAVE treated as raw key

### Test Infrastructure

Tests need to simulate the CommandContext with:
- A ProviderKeyStorage backed by SecureStore with mock keytar
- A mock for `runtime.updateActiveProviderApiKey()`
- An `isInteractive` flag
- A `promptConfirm` function (for interactive prompts)
- Output capture for verifying displayed messages

## Verification Commands

```bash
# 1. Test file created
ls packages/cli/src/ui/commands/keyCommand.test.ts

# 2. Test count
grep -c "it(" packages/cli/src/ui/commands/keyCommand.test.ts
# Expected: 25+

# 3. Table-driven tests
grep -c "testCases\|cases\|\.each\|parsingTestCases" packages/cli/src/ui/commands/keyCommand.test.ts
# Expected: 1+ (table-driven structure)

# 4. No mock theater
grep -c "toHaveBeenCalled\b" packages/cli/src/ui/commands/keyCommand.test.ts
# Expected: 0 (or minimal — runtime.updateActiveProviderApiKey call verification is OK)

# 5. Behavioral assertions
grep -c "toBe(\|toEqual(\|toMatch(\|toContain(" packages/cli/src/ui/commands/keyCommand.test.ts
# Expected: 25+

# 6. Requirement coverage
for req in R12 R13 R14 R15 R16 R17 R18 R19 R20 R27.2; do
  grep -q "$req" packages/cli/src/ui/commands/keyCommand.test.ts && echo "COVERED: $req" || echo "MISSING: $req"
done
```

## Structural Verification Checklist

- [ ] Test file created
- [ ] 25+ behavioral tests
- [ ] Table-driven parsing tests (R27.2)
- [ ] No mock theater
- [ ] Coverage for all subcommands
- [ ] Legacy path tested
- [ ] Non-interactive behavior tested
- [ ] Autocomplete tested
- [ ] Secure input masking tested

## Semantic Verification Checklist (MANDATORY)

1. **Do tests verify displayed messages?**
   - [ ] Error messages match R13-R17 specifications
   - [ ] Masked output verified
   - [ ] Usage hints present

2. **Do tests exercise real ProviderKeyStorage?**
   - [ ] Not just mocked storage
   - [ ] Actual save/load round-trips

3. **Are interactive vs non-interactive behaviors tested?**
   - [ ] Interactive overwrite prompt
   - [ ] Non-interactive overwrite rejection
   - [ ] Interactive delete confirmation
   - [ ] Non-interactive delete rejection

## Failure Recovery

1. `git checkout -- packages/cli/src/ui/commands/keyCommand.test.ts`
2. Re-run Phase 14

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P14.md`
