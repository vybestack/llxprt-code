=== PHASE: 13-key-commands-stub.md ===
# Phase 13: /key Commands Stub

## Phase ID

`PLAN-20260211-SECURESTORE.P13`

## Prerequisites

- Required: Phase 12a completed
- Verification: `ls .completed/P12a.md`
- Expected: ProviderKeyStorage implemented and tested

## Requirements Implemented (Expanded)

### R12.1: Subcommand Parsing

**Full Text**: When the user enters `/key` followed by arguments, the command handler shall split the arguments by whitespace and check the first token against the subcommand names: `save`, `load`, `show`, `list`, `delete`.
**Behavior (stub)**: Parsing logic structure exists, subcommand dispatch is skeletal.

## Implementation Tasks

### Files to Modify

- `packages/cli/src/ui/commands/keyCommand.ts` — UPDATE existing command
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P13`
  - ADD: Subcommand parsing structure
  - ADD: Handler function stubs for save, load, show, list, delete
  - KEEP: Existing legacy behavior (lines 19-50) as fallback path
  - Handler stubs throw NotYetImplemented or return with placeholder message
  - Maximum ~80 lines added

### Stub Structure

The existing keyCommand.ts has ~51 lines handling `/key <raw-key>`. Extend it with:

```typescript
// Subcommand dispatch structure (stub)
const SUBCOMMANDS = ['save', 'load', 'show', 'list', 'delete'] as const;

// In action handler:
// 1. Trim args
// 2. Split by whitespace
// 3. Check first token against SUBCOMMANDS
// 4. If match → dispatch to handler (stub)
// 5. If no match → existing legacy behavior
```

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-SECURESTORE.P13
 * @requirement R12.1
 */
```

## Verification Commands

```bash
# 1. File modified
grep -c "@plan.*SECURESTORE.P13" packages/cli/src/ui/commands/keyCommand.ts
# Expected: 2+

# 2. Subcommand names present
grep "save.*load.*show.*list.*delete\|SUBCOMMANDS" packages/cli/src/ui/commands/keyCommand.ts

# 3. TypeScript compiles
npm run typecheck

# 4. Legacy behavior preserved
grep -c "updateActiveProviderApiKey\|legacyKey\|setApiKey" packages/cli/src/ui/commands/keyCommand.ts
# Expected: 1+ (legacy path still exists)

# 5. No TODO comments
grep "TODO" packages/cli/src/ui/commands/keyCommand.ts
```

## Structural Verification Checklist

- [ ] keyCommand.ts modified (not replaced)
- [ ] Subcommand parsing structure present
- [ ] Legacy behavior preserved as fallback
- [ ] TypeScript compiles
- [ ] Plan markers present

## Semantic Verification Checklist (MANDATORY)

1. **Is the subcommand dispatch structure correct?**
   - [ ] `SUBCOMMANDS` array/constant contains `save`, `load`, `show`, `list`, `delete`
   - [ ] Argument string is trimmed before parsing (R12.6)
   - [ ] First token is matched case-sensitively against subcommand names (R12.5)
   - [ ] Matched token dispatches to corresponding handler function

2. **Do all handler stubs exist with correct signatures?**
   - [ ] `handleSave(args, context)` stub present
   - [ ] `handleLoad(args, context)` stub present
   - [ ] `handleShow(args, context)` stub present
   - [ ] `handleList(args, context)` stub present
   - [ ] `handleDelete(args, context)` stub present
   - [ ] Each accepts the expected arguments (remaining tokens, command context)

3. **Is the legacy fallback path preserved?**
   - [ ] When first token does not match a subcommand → existing `/key <raw-key>` behavior runs (R12.3)
   - [ ] When no arguments → existing status display runs (R12.4)
   - [ ] Legacy code lines NOT deleted or commented out

4. **Do handler stubs throw NotYetImplemented?**
   - [ ] Each handler stub throws or returns a "not yet implemented" indicator
   - [ ] Stubs do NOT contain placeholder logic that could be mistaken for real implementation
   - [ ] No `console.log("TODO")` patterns

5. **Is the autocomplete stub present?**
   - [ ] Autocomplete function exists or has a stub entry point
   - [ ] Returns empty array (no suggestions yet)

6. **Are TDD tests writable against this stub?**
   - [ ] Dispatch structure is testable (subcommand → handler mapping)
   - [ ] Legacy fallback path is testable
   - [ ] Handler stubs produce predictable outputs (errors/throws) that tests can assert on

## Failure Recovery

1. `git checkout -- packages/cli/src/ui/commands/keyCommand.ts`
2. Re-run Phase 13

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P13.md`

=== PHASE: 14-key-commands-tdd.md ===
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

=== PHASE: 15-key-commands-impl.md ===
# Phase 15: /key Commands Implementation

## Phase ID

`PLAN-20260211-SECURESTORE.P15`

## Prerequisites

- Required: Phase 14a completed
- Verification: `ls .completed/P14a.md`
- Expected files:
  - `packages/cli/src/ui/commands/keyCommand.ts` (stub from P13)
  - `packages/cli/src/ui/commands/keyCommand.test.ts` (tests from P14)

## Requirements Implemented (Expanded)

### R12: /key Commands — Subcommand Parsing

#### R12.1 — Event-Driven
**Full Text**: When the user enters `/key` followed by arguments, the command handler shall split the arguments by whitespace and check the first token against the subcommand names: `save`, `load`, `show`, `list`, `delete`.
**Behavior**:
- GIVEN: User enters `/key save mykey sk-abc`
- WHEN: The command handler receives the argument string
- THEN: It splits by whitespace, identifies `save` as a known subcommand, and dispatches to the save handler
**Why This Matters**: Defines the fundamental parsing contract for the new subcommand system.

#### R12.2 — Event-Driven
**Full Text**: When the first token matches a subcommand name, the command handler shall dispatch to the corresponding subcommand handler.
**Behavior**:
- GIVEN: First token is `load`
- WHEN: Token is checked against subcommand names
- THEN: Dispatch routes to the load handler function
**Why This Matters**: Ensures a clean dispatch table connects parsed tokens to handler functions.

#### R12.3 — Event-Driven
**Full Text**: When the first token does not match any subcommand name, the command handler shall treat the entire argument string as a raw API key and invoke the existing legacy behavior (ephemeral session key set).
**Behavior**:
- GIVEN: User enters `/key sk-abc123` (not a subcommand)
- WHEN: `sk-abc123` does not match any subcommand name
- THEN: The entire string is treated as a raw API key via the legacy path
**Why This Matters**: Backward compatibility — existing `/key <raw-key>` usage must not break.

#### R12.4 — Event-Driven
**Full Text**: When `/key` is entered with no arguments, the command handler shall show the current key status for the active provider.
**Behavior**:
- GIVEN: User enters `/key` with no arguments
- WHEN: The command handler receives an empty argument string
- THEN: It displays the current key status for the active provider
**Why This Matters**: Provides discoverability — users can check their current key state.

#### R12.5 — Ubiquitous
**Full Text**: Subcommand name matching shall be case-sensitive. `save` is a subcommand; `SAVE` is treated as a raw key via the legacy path.
**Behavior**:
- GIVEN: User enters `/key SAVE mykey sk-abc`
- WHEN: `SAVE` is checked against subcommand names
- THEN: No match found; entire string treated as raw key via legacy path
**Why This Matters**: Prevents ambiguity — uppercase strings that look like API keys aren't accidentally intercepted as subcommands.

#### R12.6 — Ubiquitous
**Full Text**: The command handler shall trim leading and trailing whitespace from the argument string before parsing tokens.
**Behavior**:
- GIVEN: User enters `/key   save  mykey  sk-abc  ` (extra whitespace)
- WHEN: The argument string is received
- THEN: Leading/trailing whitespace is trimmed before splitting into tokens
**Why This Matters**: Robustness — users shouldn't get errors from stray whitespace.

### R13: /key save

#### R13.1 — Event-Driven
**Full Text**: When `/key save <name> <api-key>` is entered, the command handler shall validate the name, then store the key via `ProviderKeyStorage.saveKey()`, and confirm with a masked display using `maskKeyForDisplay`.
**Behavior**:
- GIVEN: User enters `/key save mykey sk-abc123`
- WHEN: The save handler runs
- THEN: Name is validated, key is stored via `ProviderKeyStorage.saveKey('mykey', 'sk-abc123')`, and confirmation shows masked key
**Why This Matters**: Core save functionality — the primary way users persist named keys.

#### R13.2 — Event-Driven
**Full Text**: When `/key save <name>` is entered for a name that already exists in the keyring and the session is interactive, the command handler shall prompt the user for confirmation before overwriting.
**Behavior**:
- GIVEN: Key `mykey` already exists and session is interactive
- WHEN: User enters `/key save mykey new-sk-abc`
- THEN: A confirmation prompt is shown before overwriting
**Why This Matters**: Prevents accidental overwrites of saved credentials.

#### R13.3 — State-Driven
**Full Text**: While the session is non-interactive (piped input, `--prompt` flag), `/key save` with an existing name shall fail with an error. Overwriting requires interactive confirmation.
**Behavior**:
- GIVEN: Key `mykey` already exists and session is non-interactive
- WHEN: User enters `/key save mykey new-sk-abc`
- THEN: Operation fails with an error (cannot prompt for confirmation)
**Why This Matters**: Safety — scripted/piped sessions must not silently overwrite keys.

#### R13.4 — Unwanted Behavior
**Full Text**: If `/key save <name>` is entered without an API key value, the command handler shall return an error: `API key value cannot be empty.`
**Behavior**:
- GIVEN: User enters `/key save mykey` (no key value)
- WHEN: The save handler parses arguments
- THEN: Returns error: `API key value cannot be empty.`
**Why This Matters**: Clear error message for a common user mistake.

#### R13.5 — Unwanted Behavior
**Full Text**: If `/key save` is entered without a name or key, the command handler shall return an error with a usage hint.
**Behavior**:
- GIVEN: User enters `/key save` (no name or key)
- WHEN: The save handler parses arguments
- THEN: Returns error with usage hint
**Why This Matters**: Guides users to the correct syntax.

### R14: /key load

#### R14.1 — Event-Driven
**Full Text**: When `/key load <name>` is entered and the named key exists, the command handler shall retrieve the key via `ProviderKeyStorage.getKey()` and set it as the active provider API key for the session (same effect as `/key <raw-key>`).
**Behavior**:
- GIVEN: Key `mykey` exists with value `sk-abc123`
- WHEN: User enters `/key load mykey`
- THEN: Key is retrieved and set as the active session API key
**Why This Matters**: Core load functionality — how users activate a saved key.

#### R14.2 — Unwanted Behavior
**Full Text**: If `/key load <name>` is entered and the named key does not exist, the command handler shall return: `Key '<name>' not found. Use '/key list' to see saved keys.`
**Behavior**:
- GIVEN: Key `notexist` does not exist
- WHEN: User enters `/key load notexist`
- THEN: Returns: `Key 'notexist' not found. Use '/key list' to see saved keys.`
**Why This Matters**: Actionable error — tells users how to find valid key names.

#### R14.3 — Unwanted Behavior
**Full Text**: If `/key load` is entered without a name, the command handler shall return an error with a usage hint.
**Behavior**:
- GIVEN: User enters `/key load` (no name)
- WHEN: The load handler parses arguments
- THEN: Returns error with usage hint
**Why This Matters**: Guides users to the correct syntax.

### R15: /key show

#### R15.1 — Event-Driven
**Full Text**: When `/key show <name>` is entered and the named key exists, the command handler shall display a masked preview of the key using `maskKeyForDisplay` and the key length: `<name>: <masked> (<length> chars)`.
**Behavior**:
- GIVEN: Key `mykey` exists with value `sk-abc123`
- WHEN: User enters `/key show mykey`
- THEN: Displays `mykey: sk-a•••23 (10 chars)` (masked preview with length)
**Why This Matters**: Allows users to verify which key is stored without exposing the full value.

#### R15.2 — Unwanted Behavior
**Full Text**: If `/key show <name>` is entered and the named key does not exist, the command handler shall return: `Key '<name>' not found. Use '/key list' to see saved keys.`
**Behavior**:
- GIVEN: Key `notexist` does not exist
- WHEN: User enters `/key show notexist`
- THEN: Returns: `Key 'notexist' not found. Use '/key list' to see saved keys.`
**Why This Matters**: Consistent not-found error with actionable guidance.

### R16: /key list

#### R16.1 — Event-Driven
**Full Text**: When `/key list` is entered, the command handler shall retrieve all key names via `ProviderKeyStorage.listKeys()` and display each name with its masked value using `maskKeyForDisplay`, sorted alphabetically.
**Behavior**:
- GIVEN: Keys `alpha` and `beta` exist
- WHEN: User enters `/key list`
- THEN: Both keys displayed alphabetically with masked values
**Why This Matters**: Provides inventory of all saved keys.

#### R16.2 — Event-Driven
**Full Text**: When `/key list` is entered and no keys are stored, the command handler shall display a message indicating no saved keys exist.
**Behavior**:
- GIVEN: No keys are stored
- WHEN: User enters `/key list`
- THEN: Displays message indicating no saved keys exist
**Why This Matters**: Distinguishes "empty store" from "error accessing store."

### R17: /key delete

#### R17.1 — Event-Driven
**Full Text**: When `/key delete <name>` is entered in an interactive session and the named key exists, the command handler shall prompt for confirmation, then remove the key via `ProviderKeyStorage.deleteKey()` and confirm: `Deleted key '<name>'`.
**Behavior**:
- GIVEN: Key `mykey` exists and session is interactive
- WHEN: User enters `/key delete mykey` and confirms
- THEN: Key is deleted and confirmation shown: `Deleted key 'mykey'`
**Why This Matters**: Destructive operation requires confirmation.

#### R17.2 — State-Driven
**Full Text**: While the session is non-interactive, `/key delete` shall fail with an error. Deletion requires interactive confirmation.
**Behavior**:
- GIVEN: Session is non-interactive
- WHEN: User enters `/key delete mykey`
- THEN: Operation fails with error (cannot prompt for confirmation)
**Why This Matters**: Safety — scripted sessions must not silently delete keys.

#### R17.3 — Unwanted Behavior
**Full Text**: If `/key delete <name>` is entered and the named key does not exist, the command handler shall return: `Key '<name>' not found. Use '/key list' to see saved keys.`
**Behavior**:
- GIVEN: Key `notexist` does not exist
- WHEN: User enters `/key delete notexist`
- THEN: Returns: `Key 'notexist' not found. Use '/key list' to see saved keys.`
**Why This Matters**: Consistent not-found error across all subcommands.

#### R17.4 — Unwanted Behavior
**Full Text**: If `/key delete` is entered without a name, the command handler shall return an error with a usage hint.
**Behavior**:
- GIVEN: User enters `/key delete` (no name)
- WHEN: The delete handler parses arguments
- THEN: Returns error with usage hint
**Why This Matters**: Guides users to the correct syntax.

### R18: /key — Storage Failure

#### R18.1 — Unwanted Behavior
**Full Text**: If both the OS keyring and the encrypted file fallback are unavailable when any `/key` subcommand (`save`, `load`, `show`, `list`, `delete`) is invoked (i.e., `ProviderKeyStorage` operations throw), the command handler shall return an actionable error. When the keyring is unavailable but encrypted file fallback is functional, `/key` subcommands shall continue to work via the fallback path.
**Behavior**:
- GIVEN: Both OS keyring and encrypted file fallback are unavailable
- WHEN: User enters any `/key` subcommand
- THEN: Returns actionable error (not a stack trace)
**Why This Matters**: Users need guidance when storage is broken, not cryptic errors.

### R19: /key — Autocomplete

#### R19.1 — Event-Driven
**Full Text**: When the user is typing `/key load`, `/key show`, or `/key delete`, the command handler shall provide autocomplete suggestions from `ProviderKeyStorage.listKeys()`.
**Behavior**:
- GIVEN: Keys `alpha` and `beta` exist
- WHEN: User is typing `/key load ` (partial input)
- THEN: Autocomplete suggests `alpha` and `beta`
**Why This Matters**: Discoverability — users don't need to remember exact key names.

#### R19.2 — Event-Driven
**Full Text**: When the user is typing `/key save`, the command handler shall autocomplete the first argument against existing key names (for overwrite awareness).
**Behavior**:
- GIVEN: Key `mykey` already exists
- WHEN: User is typing `/key save `
- THEN: Autocomplete suggests `mykey` (overwrite awareness)
**Why This Matters**: Helps users know they're about to overwrite an existing key.

#### R19.3 — Unwanted Behavior
**Full Text**: If the keyring is unavailable during autocomplete, the command handler shall return an empty list rather than an error.
**Behavior**:
- GIVEN: Keyring is unavailable
- WHEN: Autocomplete is triggered for `/key load `
- THEN: Returns empty list (no error shown)
**Why This Matters**: Autocomplete failures should be silent — not disruptive.

### R20: /key — Secure Input Handling

#### R20.1 — Event-Driven
**Full Text**: When `/key save <name> <api-key>` is entered, the secure input handler shall mask the API key value (third token) in display/transcript while leaving the subcommand and name visible.
**Behavior**:
- GIVEN: User enters `/key save mykey sk-abc123`
- WHEN: Input is processed for display/transcript
- THEN: Displayed as `/key save mykey ••••••••••` (value masked, name visible)
**Why This Matters**: Prevents API keys from appearing in scrollback/transcripts.

#### R20.2 — Ubiquitous
**Full Text**: The existing secure input masking for `/key <raw-key>` (legacy path) shall continue to function unchanged.
**Behavior**:
- GIVEN: User enters `/key sk-abc123` (legacy path)
- WHEN: Input is processed for display/transcript
- THEN: Masking behavior is identical to current implementation
**Why This Matters**: Backward compatibility — existing security protections must not regress.

### R27.2: Table-Driven Parser Tests

#### R27.2 — Ubiquitous
**Full Text**: The `/key` command parser shall have table-driven tests covering each subcommand, the legacy fallback path, and edge cases including missing arguments, case sensitivity, and whitespace handling (per #1355 acceptance criteria).
**Behavior**:
- GIVEN: A table of test cases with input strings and expected parse results
- WHEN: Each test case is run through the parser
- THEN: All subcommands, legacy fallback, edge cases are covered systematically
**Why This Matters**: Explicit acceptance criterion from #1355 — ensures comprehensive parser coverage.

## Implementation Tasks

### MANDATORY: Follow Pseudocode Line-by-Line

From `analysis/pseudocode/key-commands.md`:

#### Main Handler (pseudocode lines 1–44)
- Lines 3–5: Trim args, split by whitespace
- Lines 7–12: Token matching against subcommand list
- Lines 14–24: Dispatch table: save/load/show/list/delete
- Lines 26–28: No args → show status
- Lines 30–33: No match → legacy behavior
- Lines 35–44: Error wrapping (R18.1)

#### /key save (pseudocode lines 46–90)
- Lines 48–50: Extract name and value from tokens
- Lines 52–56: Validate name
- Lines 58–60: Reject empty value
- Lines 62–72: Check existence + overwrite prompt (interactive/non-interactive)
- Lines 74–78: Store via ProviderKeyStorage
- Lines 80–84: Display confirmation with masked key

#### /key load (pseudocode lines 92–112)
- Lines 94–96: Extract name, reject empty
- Lines 98–104: Get key, fail if not found
- Lines 106–112: Set as active API key

#### /key show (pseudocode lines 114–132)
- Lines 116–118: Extract name, reject empty
- Lines 120–126: Get key, fail if not found
- Lines 128–132: Display masked preview with length

#### /key list (pseudocode lines 134–154)
- Lines 136–138: Get all keys
- Lines 140–146: Empty → message
- Lines 148–154: Display each with masked value

#### /key delete (pseudocode lines 156–186)
- Lines 158–160: Extract name, reject empty
- Lines 162–166: Non-interactive → error
- Lines 168–176: Confirm prompt
- Lines 178–182: Delete via ProviderKeyStorage
- Lines 184–186: Display confirmation

#### Autocomplete (pseudocode lines 210–248)
- Lines 212–218: First-level: subcommand names
- Lines 220–236: Second-level: key names for load/show/delete/save
- Lines 238–248: Error handling → empty list

#### Secure Input Masking (pseudocode lines 250–282)
- Lines 252–260: Pattern for `/key save <name> <value>` — mask only value
- Lines 262–270: Existing `/key <raw-key>` pattern preserved

### Files to Modify

- `packages/cli/src/ui/commands/keyCommand.ts` — UPDATE with full implementation
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P15`
  - MUST include: `@pseudocode lines X-Y` references
  - MUST include: `@requirement` markers

- `packages/cli/src/ui/utils/secureInputHandler.ts` — UPDATE regex for secure masking
  - Line ~189: Update pattern to handle `/key save <name> <value>` masking
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P15`
  - MUST include: `@requirement:R20.1`

### Key Design Decisions

1. **maskKeyForDisplay**: Import from `tool-key-storage.ts` — one function, shared across `/key` and `/toolkey`
2. **ProviderKeyStorage**: Access via `getProviderKeyStorage()` singleton from core package
3. **Interactive detection**: Use `CommandContext.isInteractive` or equivalent session flag
4. **Confirmation prompts**: Follow existing pattern from other commands (investigate `toolkeyCommand.ts` and other commands for I/O pattern)

## Verification Commands

```bash
# 1. All /key command tests pass
npm test -- packages/cli/src/ui/commands/keyCommand.test.ts
# Expected: ALL PASS

# 2. No test modifications
git diff packages/cli/src/ui/commands/keyCommand.test.ts | grep -E "^[+-]" | grep -v "^[+-]{3}"

# 3. Plan markers
grep -c "@plan.*SECURESTORE.P15" packages/cli/src/ui/commands/keyCommand.ts
# Expected: 5+

# 4. Pseudocode references
grep -c "@pseudocode" packages/cli/src/ui/commands/keyCommand.ts
# Expected: 5+

# 5. TypeScript compiles
npm run typecheck

# 6. Full test suite
npm test

# 7. Lint
npm run lint

# 8. Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/cli/src/ui/commands/keyCommand.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/cli/src/ui/commands/keyCommand.ts
# Expected: no matches

# 9. Secure input handler updated
grep "key.*save" packages/cli/src/ui/utils/secureInputHandler.ts

# 10. maskKeyForDisplay imported (not duplicated)
grep "maskKeyForDisplay" packages/cli/src/ui/commands/keyCommand.ts
grep "import.*maskKeyForDisplay" packages/cli/src/ui/commands/keyCommand.ts
```

## Structural Verification Checklist

- [ ] All P14 tests pass
- [ ] Tests not modified
- [ ] Plan markers present
- [ ] Pseudocode references present
- [ ] TypeScript compiles
- [ ] No deferred implementation patterns
- [ ] secureInputHandler.ts updated for R20.1
- [ ] maskKeyForDisplay imported (not duplicated)
- [ ] ProviderKeyStorage used via singleton

## Semantic Verification Checklist (MANDATORY)

1. **Does subcommand parsing work correctly?**
   - [ ] Case-sensitive matching (R12.5)
   - [ ] Whitespace trimming (R12.6)
   - [ ] Legacy fallback for unknown tokens (R12.3)
   - [ ] No-args shows status (R12.4)

2. **Does /key save handle all paths?**
   - [ ] New key saved successfully
   - [ ] Existing key prompts overwrite (interactive)
   - [ ] Existing key fails (non-interactive)
   - [ ] Missing value → error
   - [ ] Missing both → usage hint

3. **Does /key load set the active API key?**
   - [ ] Retrieved key becomes session key
   - [ ] Non-existent key → error

4. **Does /key list display correctly?**
   - [ ] Masked values shown
   - [ ] Empty state handled

5. **Does /key delete prompt confirmation?**
   - [ ] Interactive → prompt
   - [ ] Non-interactive → error
   - [ ] Non-existent → error

6. **Is autocomplete functional?**
   - [ ] Subcommand names suggested
   - [ ] Key names suggested for relevant subcommands
   - [ ] Error → empty list

7. **Is secure masking correct?**
   - [ ] `/key save name value` masks only value
   - [ ] `/key rawkey` masks the key

## Holistic Functionality Assessment

### What was implemented?
[Describe the complete /key command system]

### Does it satisfy R12-R20, R27.2?
[Explain how each requirement group is fulfilled]

### Data flow
[Trace: user types `/key save mykey sk-abc123` → parse → validate → store → confirm]

### Verdict
[PASS/FAIL]

## Failure Recovery

1. `git checkout -- packages/cli/src/ui/commands/keyCommand.ts packages/cli/src/ui/utils/secureInputHandler.ts`
2. Re-run Phase 15

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P15.md`

=== PHASE: 16-auth-key-name-stub.md ===
# Phase 16: auth-key-name + --key-name Stub

## Phase ID

`PLAN-20260211-SECURESTORE.P16`

## Prerequisites

- Required: Phase 15a completed
- Verification: `ls .completed/P15a.md`
- Expected: ProviderKeyStorage implemented, /key commands working

## Requirements Implemented (Expanded)

### R21.1: auth-key-name Profile Resolution

**Full Text**: When a profile containing `auth-key-name` is loaded, the system shall resolve the named key via `ProviderKeyStorage.getKey(name)` during `applyCliArgumentOverrides()`.
**Behavior (stub)**: Field recognized and passed through but not yet resolved.

### R22.1: --key-name CLI Flag

**Full Text**: When `--key-name <name>` is provided on the CLI, the system shall resolve the named key via `ProviderKeyStorage.getKey(name)` during `applyCliArgumentOverrides()`.
**Behavior (stub)**: Flag parsed and passed through but not yet resolved.

### R22.2: Bootstrap Arg Parsing

**Full Text**: `--key-name` shall be parsed by the bootstrap argument parser alongside `--key` and `--keyfile`, and stored in `BootstrapProfileArgs` as `keyNameOverride`.
**Behavior (stub)**: Parsing structure added.

## Implementation Tasks

### Files to Modify

#### 1. `packages/cli/src/config/profileBootstrap.ts`
- ADD `keyNameOverride: string | null` to `BootstrapProfileArgs` interface
- ADD `case '--key-name':` in argument parsing switch
- MUST include: `@plan:PLAN-20260211-SECURESTORE.P16`

#### 2. `packages/cli/src/config/config.ts`
- ADD `'auth-key-name'` to `VALID_EPHEMERAL_SETTINGS` / `ephemeralKeys` array
- ADD handling for `keyNameOverride` in synthetic profile creation
- MUST include: `@plan:PLAN-20260211-SECURESTORE.P16`

#### 3. `packages/cli/src/runtime/runtimeSettings.ts`
- ADD stub handler in `applyCliArgumentOverrides()` for `--key-name` / `auth-key-name`
- Position: between `--key` and `--keyfile` in precedence order
- Stub: throw NotYetImplemented or pass-through without resolution
- MUST include: `@plan:PLAN-20260211-SECURESTORE.P16`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-SECURESTORE.P16
 * @requirement R21.1, R22.1, R22.2
 */
```

## Verification Commands

```bash
# 1. Bootstrap args interface updated
grep "keyNameOverride" packages/cli/src/config/profileBootstrap.ts

# 2. --key-name parsing added
grep "key-name" packages/cli/src/config/profileBootstrap.ts

# 3. auth-key-name recognized as ephemeral setting
grep "auth-key-name" packages/cli/src/config/config.ts

# 4. runtimeSettings stub added
grep "keyName\|key-name\|auth-key-name" packages/cli/src/runtime/runtimeSettings.ts

# 5. TypeScript compiles
npm run typecheck

# 6. Full test suite still passes
npm test

# 7. Plan markers
grep -rn "@plan.*SECURESTORE.P16" packages/cli/src/config/ packages/cli/src/runtime/
```

## Structural Verification Checklist

- [ ] profileBootstrap.ts: `keyNameOverride` in interface, `--key-name` in parsing
- [ ] config.ts: `auth-key-name` in ephemeral settings
- [ ] runtimeSettings.ts: stub handler for key-name resolution
- [ ] TypeScript compiles
- [ ] Existing tests pass

## Semantic Verification Checklist (MANDATORY)

1. **Is `--key-name` case added to bootstrap arg parser?**
   - [ ] `case '--key-name':` exists in the argument parsing switch/if-chain
   - [ ] Next argument is consumed as the key name value
   - [ ] Missing value after `--key-name` produces an error (not silent null)

2. **Is `auth-key-name` added to VALID_EPHEMERAL_SETTINGS?**
   - [ ] `'auth-key-name'` is in the ephemeral settings array/set
   - [ ] Profile validation accepts `auth-key-name` without errors
   - [ ] No typos (`auth-key-name` not `auth-keyname` or `authKeyName`)

3. **Is `keyNameOverride` field added to BootstrapProfileArgs?**
   - [ ] `keyNameOverride: string | null` in the interface definition
   - [ ] Default value is `null` in initialization
   - [ ] Field is populated from `--key-name` parsing

4. **Is precedence resolution stub in applyCliArgumentOverrides?**
   - [ ] Stub code exists between `--key` handling and `--keyfile` handling (correct precedence position)
   - [ ] Stub throws NotYetImplemented or contains clear placeholder
   - [ ] Stub does NOT silently skip/no-op (must be detectable by tests)

5. **Is existing --key/--keyfile behavior unchanged?**
   - [ ] `--key` parsing code is not modified
   - [ ] `--keyfile` parsing code is not modified
   - [ ] `auth-key` and `auth-keyfile` profile handling unchanged
   - [ ] Existing tests for these features still pass

6. **Are TDD tests writable against this stub?**
   - [ ] `keyNameOverride` field is accessible for assertion
   - [ ] `--key-name` parsing produces testable output
   - [ ] `auth-key-name` in profile produces testable output
   - [ ] Stub behavior in applyCliArgumentOverrides is predictable (throws specific error)

## Failure Recovery

1. `git checkout -- packages/cli/src/config/profileBootstrap.ts packages/cli/src/config/config.ts packages/cli/src/runtime/runtimeSettings.ts`
2. Re-run Phase 16

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P16.md`

=== PHASE: 17-auth-key-name-tdd.md ===
# Phase 17: auth-key-name + --key-name TDD

## Phase ID

`PLAN-20260211-SECURESTORE.P17`

## Prerequisites

- Required: Phase 16a completed
- Verification: `ls .completed/P16a.md`
- Expected: Stub for `--key-name` parsing and `auth-key-name` field recognition

## Requirements Implemented (Expanded)

### R21: auth-key-name Profile Field

#### R21.1 — Event-Driven
**Full Text**: When a profile containing `auth-key-name` is loaded, the system shall resolve the named key via `ProviderKeyStorage.getKey(name)` during `applyCliArgumentOverrides()` and use it as the provider API key for the session.
**Behavior**:
- GIVEN: A profile with `"auth-key-name": "myanthropic"` and key stored in keyring
- WHEN: Profile is loaded and `applyCliArgumentOverrides()` runs
- THEN: The named key is resolved via `ProviderKeyStorage.getKey('myanthropic')` and set as the session API key
**Why This Matters**: Tests must verify end-to-end profile → keyring → active key flow.

#### R21.2 — Ubiquitous
**Full Text**: `auth-key-name` shall be recognized as a valid ephemeral setting in profile definitions.
**Behavior**:
- GIVEN: A profile JSON containing `"auth-key-name": "mykey"`
- WHEN: Profile validation runs
- THEN: `auth-key-name` is accepted as a valid ephemeral setting
**Why This Matters**: Tests must verify the field is not rejected during validation.

#### R21.3 — Ubiquitous
**Full Text**: Profile bootstrap shall parse `auth-key-name` from profile JSON and pass it through as metadata. It shall not resolve the named key — resolution happens in `runtimeSettings.ts` `applyCliArgumentOverrides()`.
**Behavior**:
- GIVEN: Profile bootstrap encounters `auth-key-name` in profile JSON
- WHEN: Bootstrap parsing runs
- THEN: Value is passed through as metadata; NO keyring lookup in bootstrap
**Why This Matters**: Tests must verify bootstrap does NOT call ProviderKeyStorage.

### R22: --key-name CLI Flag

#### R22.1 — Event-Driven
**Full Text**: When `--key-name <name>` is provided on the CLI, the system shall resolve the named key via `ProviderKeyStorage.getKey(name)` during `applyCliArgumentOverrides()` and use it as the provider API key for the session.
**Behavior**:
- GIVEN: CLI invoked with `--key-name myanthropic` and key stored in keyring
- WHEN: Bootstrap parses args and `applyCliArgumentOverrides()` runs
- THEN: `keyNameOverride` is resolved to the stored API key via ProviderKeyStorage
**Why This Matters**: Tests must verify CLI flag → resolution → active key flow.

#### R22.2 — Ubiquitous
**Full Text**: `--key-name` shall be parsed by the bootstrap argument parser alongside `--key` and `--keyfile`, and stored in `BootstrapProfileArgs` as `keyNameOverride`.
**Behavior**:
- GIVEN: CLI args include `--key-name mykey`
- WHEN: Bootstrap argument parser runs
- THEN: `BootstrapProfileArgs.keyNameOverride` is set to `'mykey'`
**Why This Matters**: Tests must verify parsing populates the correct field.

### R23: API Key Precedence

#### R23.1 — Ubiquitous
**Full Text**: The system shall determine the API key for a session using this precedence order (highest first): 1. `--key` (CLI flag, raw key), 2. `--key-name` (CLI flag, named key from keyring), 3. `auth-key-name` (profile field, named key from keyring), 4. `auth-keyfile` (profile field, read from file), 5. `auth-key` (profile field, inline in profile JSON), 6. Environment variables (`GEMINI_API_KEY`, etc.)
**Behavior** (test matrix):
- GIVEN: `--key` and `--key-name` both set → `--key` wins
- GIVEN: `--key-name` and profile `auth-key-name` both set → `--key-name` wins
- GIVEN: profile `auth-key-name` and `auth-keyfile` both set → `auth-key-name` wins
- GIVEN: profile `auth-key-name` and `auth-key` both set → `auth-key-name` wins
- GIVEN: profile `auth-key` and env var both set → `auth-key` wins
**Why This Matters**: Tests must cover every adjacent precedence pair and multi-source combinations.

#### R23.2 — Event-Driven
**Full Text**: When both `--key` and `--key-name` are specified on the CLI, `--key` shall win (explicit raw key beats named key lookup).
**Behavior**:
- GIVEN: CLI invoked with `--key raw-sk-abc --key-name mykey`
- WHEN: Precedence resolution runs
- THEN: `raw-sk-abc` is used; `--key-name` is ignored
**Why This Matters**: Tests must verify the highest-priority case explicitly.

#### R23.3 — Ubiquitous
**Full Text**: All precedence resolution shall happen in `runtimeSettings.ts` `applyCliArgumentOverrides()`. Profile bootstrap passes metadata only and does not resolve named keys.
**Behavior**:
- GIVEN: Any auth source combination
- WHEN: Resolution occurs
- THEN: All resolution logic is in `applyCliArgumentOverrides()`, nowhere else
**Why This Matters**: Tests must verify no resolution happens outside the single authoritative stage.

### R24: Named Key — Error Handling

#### R24.1 — Unwanted Behavior
**Full Text**: If `auth-key-name` or `--key-name` references a named key that does not exist in the keyring, the system shall fail with an actionable error: `Named key '<name>' not found. Use '/key save <name> <key>' to store it.` It shall NOT silently fall through to lower-precedence auth sources.
**Behavior**:
- GIVEN: `--key-name notexist` and key `notexist` is not stored
- WHEN: Resolution runs
- THEN: Throws: `Named key 'notexist' not found. Use '/key save notexist <key>' to store it.`
- AND: Does NOT try `auth-keyfile`, `auth-key`, or env vars
**Why This Matters**: Tests must verify both the error message AND the absence of fallthrough.

#### R24.2 — State-Driven
**Full Text**: While the session is non-interactive and a named key is not found, the system shall fail fast with an exit code and the same error message.
**Behavior**:
- GIVEN: Non-interactive session with `--key-name notexist`
- WHEN: Named key resolution fails
- THEN: Process exits with code 1 and error message to stderr
**Why This Matters**: Tests must verify fast-fail behavior in non-interactive mode.

### R25: Named Key — Startup Diagnostics

#### R25.1 — State-Driven
**Full Text**: While debug mode is enabled, the system shall emit a log line identifying the selected auth source by type (without the key value): `[auth] Using API key from: --key-name '<name>' (keyring)`.
**Behavior**:
- GIVEN: Debug enabled and `--key-name mykey` used successfully
- WHEN: Resolution runs
- THEN: Log line: `[auth] Using API key from: --key-name 'mykey' (keyring)`
**Why This Matters**: Tests must verify log format and content (source type, not key value).

#### R25.2 — State-Driven
**Full Text**: While debug mode is enabled and a lower-precedence auth source is present but overridden, the system shall log at debug level: `[auth] Ignoring profile auth-key (overridden by --key-name)`.
**Behavior**:
- GIVEN: Debug enabled, `--key-name mykey` and profile `auth-key` both set
- WHEN: Resolution runs
- THEN: Log line: `[auth] Ignoring profile auth-key (overridden by --key-name)`
- AND: Key values NEVER appear in log output
**Why This Matters**: Tests must verify override logging and absence of secret values.

### R26: No Deprecations

#### R26.1 — Ubiquitous
**Full Text**: `--key`, `--keyfile`, `auth-key`, and `auth-keyfile` shall remain fully supported and unchanged in behavior. The new `--key-name` and `auth-key-name` options are purely additive.
**Behavior**:
- GIVEN: Existing CLI invocations using `--key`, `--keyfile`, `auth-key`, or `auth-keyfile`
- WHEN: The auth-key-name feature is deployed
- THEN: All existing auth mechanisms work identically to before
**Why This Matters**: Tests must verify no regressions in existing auth paths.

### R27.3: Precedence Test Matrix

#### R27.3 — Ubiquitous
**Full Text**: The API key precedence resolution shall have a test matrix covering every combination of auth sources: CLI flags only (`--key`, `--key-name`), profile fields only (`auth-key-name`, `auth-keyfile`, `auth-key`), environment variables only, and combinations of multiple sources at different precedence levels (per #1356 acceptance criteria).
**Behavior**:
- GIVEN: A test matrix of auth source combinations
- WHEN: Each combination is run through `applyCliArgumentOverrides()`
- THEN: The correct winner is determined per R23.1 precedence order
**Why This Matters**: Explicit acceptance criterion from #1356 — table-driven tests ensure no precedence edge cases are missed.

## Implementation Tasks

### Files to Create

- `packages/cli/src/runtime/runtimeSettings.test.ts` or extend existing test file
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P17`
  - MUST include: `@requirement` markers for R21-R27

- `packages/cli/src/config/profileBootstrap.test.ts` or extend existing test file
  - Tests for `--key-name` parsing

### Required Tests (minimum 20 behavioral tests)

#### Bootstrap Parsing (R22.2)
1. `--key-name mykey` sets `keyNameOverride` to `'mykey'`
2. No `--key-name` → `keyNameOverride` is null
3. `--key-name` without value → error

#### Profile Field (R21.1–R21.3)
4. Profile with `auth-key-name` passes field through
5. Profile bootstrap does NOT resolve the key (just metadata)
6. `auth-key-name` recognized as valid ephemeral setting

#### Key Resolution (R21.1, R22.1)
7. `--key-name` resolves to stored key via ProviderKeyStorage
8. `auth-key-name` resolves to stored key via ProviderKeyStorage
9. Resolution happens in `applyCliArgumentOverrides()`

#### Precedence Matrix (R23.1-R23.3, R27.3)
```typescript
const precedenceMatrix = [
  { sources: { key: 'raw', keyName: 'named' }, winner: 'raw', reason: '--key beats --key-name' },
  { sources: { keyName: 'named', authKeyName: 'profile' }, winner: 'named', reason: '--key-name beats auth-key-name' },
  { sources: { authKeyName: 'profile', authKeyfile: '/path' }, winner: 'profile', reason: 'auth-key-name beats auth-keyfile' },
  { sources: { authKeyName: 'profile', authKey: 'inline' }, winner: 'profile', reason: 'auth-key-name beats auth-key' },
  { sources: { key: 'raw', authKeyName: 'profile', envVar: 'env' }, winner: 'raw', reason: '--key beats all' },
  { sources: { keyName: 'named', authKeyfile: '/path', envVar: 'env' }, winner: 'named', reason: '--key-name beats file and env' },
  { sources: { authKey: 'inline', envVar: 'env' }, winner: 'inline', reason: 'auth-key beats env' },
];
```
10-16. Each row of the precedence matrix is a test

#### Error Handling (R24.1-R24.2)
17. Named key not found → error with actionable message
18. Non-interactive + key not found → fast fail with exit code
19. Error message includes key name and `/key save` hint

#### Startup Diagnostics (R25.1-R25.2)
20. Debug mode logs selected auth source
21. Debug mode logs overridden sources
22. Key VALUES never appear in log output

#### No Deprecations (R26.1)
23. `--key raw` still works
24. `--keyfile /path` still works
25. `auth-key` in profile still works
26. `auth-keyfile` in profile still works

### Test Infrastructure

- ProviderKeyStorage backed by SecureStore with mock keytar (pre-populated with test keys)
- Capture log output for diagnostics tests
- Mock/capture `updateActiveProviderApiKey` to verify which key wins
- Environment variable manipulation for env var tests

## Verification Commands

```bash
# 1. Test files created/modified
grep -rl "@plan.*SECURESTORE.P17" packages/cli/src/

# 2. Test count
grep -c "it(" packages/cli/src/runtime/runtimeSettings.test.ts 2>/dev/null || echo "check test file location"

# 3. Precedence matrix
grep -c "precedenceMatrix\|\.each\|sources.*key\|winner" packages/cli/src/runtime/runtimeSettings.test.ts 2>/dev/null

# 4. Requirement coverage
for req in R21 R22 R23 R24 R25 R26 R27.3; do
  grep -rl "$req" packages/cli/src/ 2>/dev/null | head -1 || echo "MISSING: $req"
done

# 5. No mock theater
grep -c "toHaveBeenCalled\b" packages/cli/src/runtime/runtimeSettings.test.ts 2>/dev/null
# Expected: minimal (updateActiveProviderApiKey verification is OK)

# 6. Tests fail naturally
npm test -- runtimeSettings 2>&1 | tail -20
```

## Structural Verification Checklist

- [ ] Test files created
- [ ] 20+ behavioral tests
- [ ] Precedence matrix as table-driven tests (R27.3)
- [ ] Error messages tested
- [ ] Diagnostic logging tested
- [ ] No deprecation regressions tested
- [ ] Requirement markers present

## Semantic Verification Checklist (MANDATORY)

1. **Does the precedence matrix cover all combinations?**
   - [ ] Every level of R23.1 covered
   - [ ] Multiple-source combinations tested
   - [ ] Winner verified by checking which key ends up active

2. **Is the error handling tested correctly?**
   - [ ] Error message matches R24.1 format exactly
   - [ ] Non-interactive behavior tested separately
   - [ ] Error does NOT silently fall through

3. **Are diagnostics tested?**
   - [ ] Log messages match R25.1 format
   - [ ] Secret values never in logs (R25.2)

## Failure Recovery

1. `git checkout -- packages/cli/src/runtime/ packages/cli/src/config/`
2. Re-run Phase 17

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P17.md`

=== PHASE: 18-auth-key-name-impl.md ===
# Phase 18: auth-key-name + --key-name Implementation

## Phase ID

`PLAN-20260211-SECURESTORE.P18`

## Prerequisites

- Required: Phase 17a completed
- Verification: `ls .completed/P17a.md`
- Expected files:
  - `packages/cli/src/config/profileBootstrap.ts` (stub from P16)
  - `packages/cli/src/config/config.ts` (stub from P16)
  - `packages/cli/src/runtime/runtimeSettings.ts` (stub from P16)
  - Test files from P17

## Requirements Implemented (Expanded)

### R21: auth-key-name Profile Field

#### R21.1 — Event-Driven
**Full Text**: When a profile containing `auth-key-name` is loaded, the system shall resolve the named key via `ProviderKeyStorage.getKey(name)` during `applyCliArgumentOverrides()` and use it as the provider API key for the session.
**Behavior**:
- GIVEN: A profile with `"auth-key-name": "myanthropic"` and key `myanthropic` stored in keyring
- WHEN: Profile is loaded and `applyCliArgumentOverrides()` runs
- THEN: The named key is resolved via `ProviderKeyStorage.getKey('myanthropic')` and set as the session API key
**Why This Matters**: Core feature — profiles can reference named keys instead of embedding raw keys.

#### R21.2 — Ubiquitous
**Full Text**: `auth-key-name` shall be recognized as a valid ephemeral setting in profile definitions.
**Behavior**:
- GIVEN: A profile JSON containing `"auth-key-name": "mykey"`
- WHEN: Profile validation runs
- THEN: `auth-key-name` is accepted as a valid ephemeral setting (not rejected as unknown)
**Why This Matters**: Without this, profiles with `auth-key-name` would fail validation.

#### R21.3 — Ubiquitous
**Full Text**: Profile bootstrap shall parse `auth-key-name` from profile JSON and pass it through as metadata. It shall not resolve the named key — resolution happens in `runtimeSettings.ts` `applyCliArgumentOverrides()`.
**Behavior**:
- GIVEN: Profile bootstrap encounters `auth-key-name` in profile JSON
- WHEN: Bootstrap parsing runs
- THEN: The value is passed through as metadata; NO keyring lookup happens in bootstrap
**Why This Matters**: Separation of concerns — bootstrap is parsing only, runtime does resolution.

### R22: --key-name CLI Flag

#### R22.1 — Event-Driven
**Full Text**: When `--key-name <name>` is provided on the CLI, the system shall resolve the named key via `ProviderKeyStorage.getKey(name)` during `applyCliArgumentOverrides()` and use it as the provider API key for the session.
**Behavior**:
- GIVEN: CLI invoked with `--key-name myanthropic` and key `myanthropic` stored in keyring
- WHEN: Bootstrap parses args and `applyCliArgumentOverrides()` runs
- THEN: `keyNameOverride` is set and resolved to the stored API key
**Why This Matters**: CLI-level named key support — users can reference saved keys by name.

#### R22.2 — Ubiquitous
**Full Text**: `--key-name` shall be parsed by the bootstrap argument parser alongside `--key` and `--keyfile`, and stored in `BootstrapProfileArgs` as `keyNameOverride`.
**Behavior**:
- GIVEN: CLI args include `--key-name mykey`
- WHEN: Bootstrap argument parser runs
- THEN: `BootstrapProfileArgs.keyNameOverride` is set to `'mykey'`
**Why This Matters**: Integrates with existing argument parsing infrastructure.

### R23: API Key Precedence

#### R23.1 — Ubiquitous
**Full Text**: The system shall determine the API key for a session using this precedence order (highest first): 1. `--key` (CLI flag, raw key), 2. `--key-name` (CLI flag, named key from keyring), 3. `auth-key-name` (profile field, named key from keyring), 4. `auth-keyfile` (profile field, read from file), 5. `auth-key` (profile field, inline in profile JSON), 6. Environment variables (`GEMINI_API_KEY`, etc.)
**Behavior**:
- GIVEN: Multiple auth sources configured at different precedence levels
- WHEN: `applyCliArgumentOverrides()` resolves the API key
- THEN: The highest-precedence source wins
**Why This Matters**: Defines the authoritative precedence chain — the most critical contract for multi-source auth.

#### R23.2 — Event-Driven
**Full Text**: When both `--key` and `--key-name` are specified on the CLI, `--key` shall win (explicit raw key beats named key lookup).
**Behavior**:
- GIVEN: CLI invoked with `--key raw-sk-abc --key-name mykey`
- WHEN: Precedence resolution runs
- THEN: `raw-sk-abc` is used (--key wins); `--key-name` is ignored with debug log
**Why This Matters**: Explicit raw key is the most direct specification — it must always win.

#### R23.3 — Ubiquitous
**Full Text**: All precedence resolution shall happen in `runtimeSettings.ts` `applyCliArgumentOverrides()`. Profile bootstrap passes metadata only and does not resolve named keys.
**Behavior**:
- GIVEN: Any combination of auth sources
- WHEN: Resolution occurs
- THEN: All resolution logic is in `applyCliArgumentOverrides()`, nowhere else
**Why This Matters**: Single authoritative resolution stage prevents inconsistencies and bugs from duplicated logic.

### R24: Named Key — Error Handling

#### R24.1 — Unwanted Behavior
**Full Text**: If `auth-key-name` or `--key-name` references a named key that does not exist in the keyring, the system shall fail with an actionable error: `Named key '<name>' not found. Use '/key save <name> <key>' to store it.` It shall NOT silently fall through to lower-precedence auth sources.
**Behavior**:
- GIVEN: `--key-name notexist` and key `notexist` is not stored
- WHEN: Resolution runs
- THEN: Throws error: `Named key 'notexist' not found. Use '/key save notexist <key>' to store it.` — does NOT try auth-keyfile, auth-key, or env vars
**Why This Matters**: Silent fallthrough would mask configuration errors — users must know their named key reference is broken.

#### R24.2 — State-Driven
**Full Text**: While the session is non-interactive and a named key is not found, the system shall fail fast with an exit code and the same error message.
**Behavior**:
- GIVEN: Non-interactive session with `--key-name notexist`
- WHEN: Named key resolution fails
- THEN: Process exits with code 1 and error message to stderr
**Why This Matters**: CI/scripted environments need fast, clear failure signals.

### R25: Named Key — Startup Diagnostics

#### R25.1 — State-Driven
**Full Text**: While debug mode is enabled, the system shall emit a log line identifying the selected auth source by type (without the key value): `[auth] Using API key from: --key-name '<name>' (keyring)`, `[auth] Using API key from: profile '<profile>' auth-keyfile '<path>'`, `[auth] Using API key from: environment variable GEMINI_API_KEY`.
**Behavior**:
- GIVEN: Debug mode enabled and `--key-name mykey` used
- WHEN: Resolution runs successfully
- THEN: Log line: `[auth] Using API key from: --key-name 'mykey' (keyring)`
**Why This Matters**: Users debugging auth issues need to know which source was selected.

#### R25.2 — State-Driven
**Full Text**: While debug mode is enabled and a lower-precedence auth source is present but overridden, the system shall log at debug level: `[auth] Ignoring profile auth-key (overridden by --key-name)`.
**Behavior**:
- GIVEN: Debug mode enabled, `--key-name mykey` and profile `auth-key` both set
- WHEN: Resolution runs
- THEN: Log line: `[auth] Ignoring profile auth-key (overridden by --key-name)`
**Why This Matters**: Users need to see which sources were intentionally skipped.

### R26: No Deprecations

#### R26.1 — Ubiquitous
**Full Text**: `--key`, `--keyfile`, `auth-key`, and `auth-keyfile` shall remain fully supported and unchanged in behavior. The new `--key-name` and `auth-key-name` options are purely additive.
**Behavior**:
- GIVEN: Existing CLI invocations using `--key`, `--keyfile`, `auth-key`, or `auth-keyfile`
- WHEN: The auth-key-name feature is deployed
- THEN: All existing auth mechanisms work identically to before
**Why This Matters**: Zero regressions — existing users must not be broken by new features.

### R27.3: Precedence Test Matrix

#### R27.3 — Ubiquitous
**Full Text**: The API key precedence resolution shall have a test matrix covering every combination of auth sources: CLI flags only (`--key`, `--key-name`), profile fields only (`auth-key-name`, `auth-keyfile`, `auth-key`), environment variables only, and combinations of multiple sources at different precedence levels (per #1356 acceptance criteria).
**Behavior**:
- GIVEN: A test matrix of auth source combinations
- WHEN: Each combination is run through `applyCliArgumentOverrides()`
- THEN: The correct winner is determined per R23.1 precedence order for every combination
**Why This Matters**: Explicit acceptance criterion from #1356 — ensures no precedence edge cases are missed.

## Implementation Tasks

### MANDATORY: Follow Pseudocode Line-by-Line

From `analysis/pseudocode/auth-key-name.md`:

#### Bootstrap Arg Parsing (pseudocode lines 1–24)
- Lines 3–9: `--key-name` case in switch statement
- Lines 11–16: Validate value present
- Lines 18–24: Store in `keyNameOverride`

#### Profile Field Recognition (pseudocode lines 26–40)
- Lines 28–34: `auth-key-name` in ephemeral settings
- Lines 36–40: Synthetic profile creation with `keyNameOverride`

#### API Key Precedence Resolution (pseudocode lines 42–82)
- Lines 44–52: Check `--key` first (highest precedence)
- Lines 54–62: Check `--key-name` / `keyNameOverride`
- Lines 64–68: Check `auth-key-name` from profile ephemeral settings
- Lines 70–74: Check `auth-keyfile`
- Lines 76–78: Check `auth-key`
- Lines 80–82: Fall through to env vars

#### Named Key Resolution (pseudocode lines 84–108)
- Lines 86–92: Call `ProviderKeyStorage.getKey(name)`
- Lines 94–100: Key not found → throw with actionable message
- Lines 102–108: Key found → call `updateActiveProviderApiKey(resolvedKey)`

#### Startup Diagnostics (pseudocode lines 110–128)
- Lines 112–120: Debug log for selected auth source
- Lines 122–128: Debug log for overridden sources

#### Non-Interactive Failure (pseudocode lines 130–140)
- Lines 132–136: Detect non-interactive mode
- Lines 138–140: Fast fail with exit code

### Files to Modify

#### 1. `packages/cli/src/config/profileBootstrap.ts`
- COMPLETE the `--key-name` parsing (from stub to working)
- Lines ~222–232: full implementation of case
- MUST include: `@plan:PLAN-20260211-SECURESTORE.P18`
- MUST include: `@pseudocode lines 1-24`

#### 2. `packages/cli/src/config/config.ts`
- COMPLETE `auth-key-name` ephemeral setting handling
- COMPLETE synthetic profile creation with `keyNameOverride`
- MUST include: `@plan:PLAN-20260211-SECURESTORE.P18`
- MUST include: `@pseudocode lines 26-40`

#### 3. `packages/cli/src/runtime/runtimeSettings.ts`
- COMPLETE `applyCliArgumentOverrides()` with full precedence resolution
- Import `ProviderKeyStorage` / `getProviderKeyStorage`
- Add named key resolution: `getKey(name)` → `updateActiveProviderApiKey()`
- Add error handling for key not found
- Add debug logging for auth source selection
- MUST include: `@plan:PLAN-20260211-SECURESTORE.P18`
- MUST include: `@pseudocode lines 42-140`

### Key Design Decisions

1. **Resolution in one place**: `applyCliArgumentOverrides()` is the ONLY place named keys are resolved. Profile bootstrap passes metadata only.
2. **Precedence order**: `--key` → `--key-name` → `auth-key-name` → `auth-keyfile` → `auth-key` → env vars
3. **No silent fallthrough**: If `--key-name` or `auth-key-name` is set but key not found, error immediately (R24.1). Do NOT try lower-precedence sources.
4. **Debug logging**: Use existing debug infrastructure. Log auth source type, not key value.

## Verification Commands

```bash
# 1. All auth/precedence tests pass
npm test -- runtimeSettings 2>&1 | tail -20

# 2. All profile bootstrap tests pass  
npm test -- profileBootstrap 2>&1 | tail -20

# 3. No test modifications
git diff packages/cli/src/runtime/runtimeSettings.test.ts | grep -E "^[+-]" | grep -v "^[+-]{3}"

# 4. Plan markers
grep -c "@plan.*SECURESTORE.P18" packages/cli/src/config/profileBootstrap.ts packages/cli/src/config/config.ts packages/cli/src/runtime/runtimeSettings.ts

# 5. Pseudocode references
grep -c "@pseudocode" packages/cli/src/config/profileBootstrap.ts packages/cli/src/config/config.ts packages/cli/src/runtime/runtimeSettings.ts

# 6. TypeScript compiles
npm run typecheck

# 7. Full test suite
npm test

# 8. Lint
npm run lint

# 9. Deferred implementation detection
for f in packages/cli/src/config/profileBootstrap.ts packages/cli/src/config/config.ts packages/cli/src/runtime/runtimeSettings.ts; do
  grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" "$f"
  grep -rn -E "(in a real|in production|ideally|for now|placeholder)" "$f"
done

# 10. ProviderKeyStorage imported in runtimeSettings
grep "ProviderKeyStorage\|getProviderKeyStorage" packages/cli/src/runtime/runtimeSettings.ts

# 11. Build succeeds
npm run build
```

## Structural Verification Checklist

- [ ] All P17 tests pass
- [ ] Tests not modified
- [ ] Plan markers present in all three files
- [ ] Pseudocode references present
- [ ] TypeScript compiles
- [ ] No deferred implementation patterns
- [ ] ProviderKeyStorage imported in runtimeSettings
- [ ] Build succeeds

## Semantic Verification Checklist (MANDATORY)

1. **Does --key-name parsing work?**
   - [ ] `--key-name mykey` stores `keyNameOverride = 'mykey'`
   - [ ] Missing value → error

2. **Does auth-key-name work in profiles?**
   - [ ] Recognized as valid ephemeral setting
   - [ ] Passed through synthetic profile

3. **Does precedence resolution work?**
   - [ ] `--key` beats everything
   - [ ] `--key-name` beats `auth-key-name`, `auth-keyfile`, `auth-key`, env
   - [ ] `auth-key-name` beats `auth-keyfile`, `auth-key`, env
   - [ ] All resolved in `applyCliArgumentOverrides()`, nowhere else

4. **Does error handling work?**
   - [ ] Named key not found → specific error with `/key save` hint
   - [ ] No silent fallthrough to lower-precedence sources

5. **Do diagnostics work?**
   - [ ] Debug log shows auth source type
   - [ ] Debug log shows overridden sources
   - [ ] Key values NEVER logged

6. **No regressions?**
   - [ ] `--key`, `--keyfile`, `auth-key`, `auth-keyfile` all still work

## Holistic Functionality Assessment

### What was implemented?
[Describe the full auth resolution pipeline]

### Does it satisfy R21-R27?
[Explain precedence, error handling, diagnostics]

### Data flow
[Trace: `--key-name mykey` → bootstrap parse → profile metadata → applyCliArgumentOverrides → ProviderKeyStorage.getKey → updateActiveProviderApiKey]

### What could go wrong?
[Edge cases, async issues, race conditions]

### Verdict
[PASS/FAIL]

## Failure Recovery

1. `git checkout -- packages/cli/src/config/profileBootstrap.ts packages/cli/src/config/config.ts packages/cli/src/runtime/runtimeSettings.ts`
2. Re-run Phase 18

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P18.md`

=== PHASE: 19-final-verification.md ===
# Phase 19: Final Integration Verification

## Phase ID

`PLAN-20260211-SECURESTORE.P19`

## Prerequisites

- Required: ALL previous phases (P01–P18a) completed
- Verification: `ls .completed/P*.md | wc -l` should show all phase markers
- All 93 requirements implemented and tested

## Purpose

This phase performs comprehensive end-to-end verification across all components. It verifies that SecureStore, ProviderKeyStorage, /key commands, and auth-key-name integration work together as a cohesive system — not just as isolated components.

## Full Verification Suite

### 1. Complete Test Suite

```bash
# All tests pass
npm test
# Expected: ALL PASS, zero failures

# TypeScript compiles
npm run typecheck
# Expected: no errors

# Lint passes
npm run lint
# Expected: no errors

# Format check
npm run format
# Expected: no changes needed

# Build succeeds
npm run build
# Expected: clean build
```

### 2. Smoke Test

```bash
# Application starts and runs
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
# Expected: haiku output, clean exit
```

### 3. Plan Marker Audit

```bash
# All plan phases have markers in code
for phase in P01 P04 P05 P06 P07 P08 P09 P10 P11 P12 P13 P14 P15 P16 P17 P18; do
  count=$(grep -r "@plan.*SECURESTORE.$phase\b" packages/ --include="*.ts" | wc -l)
  echo "$phase: $count markers"
done

# All requirements have markers
for req in R1 R2 R3 R4 R5 R6 R7 R8 R9 R10 R11 R12 R13 R14 R15 R16 R17 R18 R19 R20 R21 R22 R23 R24 R25 R26 R27; do
  count=$(grep -r "@requirement.*$req" packages/ --include="*.ts" | wc -l)
  echo "$req: $count markers"
done
```

### 4. Deferred Implementation Detection (ALL FILES)

```bash
# Scan ALL implementation files for deferred work
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" \
  packages/core/src/storage/ \
  packages/core/src/tools/tool-key-storage.ts \
  packages/core/src/mcp/token-storage/ \
  packages/cli/src/ui/commands/keyCommand.ts \
  packages/cli/src/config/profileBootstrap.ts \
  packages/cli/src/config/config.ts \
  packages/cli/src/runtime/runtimeSettings.ts \
  packages/cli/src/config/extensions/settingsStorage.ts \
  --include="*.ts" | grep -v ".test.ts" | grep -v node_modules

# Scan for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" \
  packages/core/src/storage/ \
  packages/core/src/tools/tool-key-storage.ts \
  packages/core/src/mcp/token-storage/ \
  packages/cli/src/ui/commands/keyCommand.ts \
  packages/cli/src/config/ \
  packages/cli/src/runtime/runtimeSettings.ts \
  --include="*.ts" | grep -v ".test.ts" | grep -v node_modules
```

### 5. No Duplicate Keyring Code

```bash
# Only SecureStore should import @napi-rs/keyring
grep -rn "napi-rs/keyring" packages/ --include="*.ts" | grep -v ".test.ts" | grep -v node_modules | grep -v "secure-store.ts"
# Expected: 0 matches (R7.7)

# No duplicate keytar loading outside SecureStore
grep -rn "getKeytar\|keytarLoadAttempted\|keytarModule" packages/ --include="*.ts" | grep -v ".test.ts" | grep -v node_modules | grep -v "secure-store.ts"
# Expected: 0 matches
```

### 6. Eliminated Code Verification

```bash
# FileTokenStorage eliminated (R7.3)
ls packages/core/src/mcp/token-storage/file-token-storage.ts 2>/dev/null && echo "FAIL: FileTokenStorage still exists" || echo "OK: FileTokenStorage removed"

# HybridTokenStorage eliminated (R7.4)
ls packages/core/src/mcp/token-storage/hybrid-token-storage.ts 2>/dev/null && echo "FAIL: HybridTokenStorage still exists" || echo "OK: HybridTokenStorage removed"

# No references to eliminated code
grep -rn "FileTokenStorage\|HybridTokenStorage" packages/ --include="*.ts" | grep -v ".test.ts" | grep -v node_modules
# Expected: 0 matches
```

### 7. Integration Chain Verification

```bash
# SecureStore is used by ProviderKeyStorage
grep "SecureStore" packages/core/src/storage/provider-key-storage.ts

# SecureStore is used by ToolKeyStorage
grep "SecureStore" packages/core/src/tools/tool-key-storage.ts

# SecureStore is used by KeychainTokenStorage
grep "SecureStore" packages/core/src/mcp/token-storage/keychain-token-storage.ts

# SecureStore is used by ExtensionSettingsStorage
grep "SecureStore" packages/cli/src/config/extensions/settingsStorage.ts

# ProviderKeyStorage is used by keyCommand
grep "ProviderKeyStorage\|getProviderKeyStorage" packages/cli/src/ui/commands/keyCommand.ts

# ProviderKeyStorage is used by runtimeSettings
grep "ProviderKeyStorage\|getProviderKeyStorage" packages/cli/src/runtime/runtimeSettings.ts

# keyNameOverride flows through bootstrap → config → runtime
grep "keyNameOverride" packages/cli/src/config/profileBootstrap.ts packages/cli/src/config/config.ts packages/cli/src/runtime/runtimeSettings.ts
```

### 8. Export Verification

```bash
# SecureStore exported from core
grep "SecureStore" packages/core/src/index.ts 2>/dev/null || echo "Check export barrel"

# ProviderKeyStorage exported from core
grep "ProviderKeyStorage\|getProviderKeyStorage" packages/core/src/index.ts 2>/dev/null || echo "Check export barrel"

# maskKeyForDisplay available for import
grep "maskKeyForDisplay" packages/core/src/index.ts 2>/dev/null || echo "Check export barrel"
```

### 9. Security Verification

```bash
# No secret values logged
grep -rn "console.log\|console.debug\|console.info" packages/core/src/storage/ packages/cli/src/ui/commands/keyCommand.ts --include="*.ts" | grep -v ".test.ts"
# Manual review: none of these log API keys or tokens

# Fallback files use 0o600 permissions
grep "0o600\|0600\|384" packages/core/src/storage/secure-store.ts

# Fallback directory uses 0o700 permissions
grep "0o700\|0700\|448" packages/core/src/storage/secure-store.ts
```

### 10. Pseudocode Compliance Summary

Verify each implementation phase referenced its pseudocode:

```bash
echo "=== SecureStore ==="
grep -c "@pseudocode" packages/core/src/storage/secure-store.ts

echo "=== ProviderKeyStorage ==="
grep -c "@pseudocode" packages/core/src/storage/provider-key-storage.ts

echo "=== keyCommand ==="
grep -c "@pseudocode" packages/cli/src/ui/commands/keyCommand.ts

echo "=== profileBootstrap ==="
grep -c "@pseudocode" packages/cli/src/config/profileBootstrap.ts

echo "=== runtimeSettings ==="
grep -c "@pseudocode" packages/cli/src/runtime/runtimeSettings.ts
```

## Full Requirement Traceability Audit

For each requirement group, verify implementation exists AND tests exist:

| Req Group | Implementation File | Test File | All Tests Pass? |
|-----------|-------------------|-----------|----------------|
| R1 (Keyring Access) | secure-store.ts | secure-store.test.ts | [ ] |
| R2 (Availability Probe) | secure-store.ts | secure-store.test.ts | [ ] |
| R3 (CRUD) | secure-store.ts | secure-store.test.ts | [ ] |
| R4 (Encrypted Fallback) | secure-store.ts | secure-store.test.ts | [ ] |
| R5 (No Backward Compat) | secure-store.ts | secure-store.test.ts | [ ] |
| R6 (Error Taxonomy) | secure-store.ts | secure-store.test.ts | [ ] |
| R7 (Thin Wrappers) | tool-key-storage.ts, keychain-token-storage.ts, settingsStorage.ts | respective test files | [ ] |
| R7A (Behavioral Audit) | analysis/domain-model.md | N/A | [ ] |
| R7B (Resilience) | secure-store.ts | secure-store.test.ts | [ ] |
| R7C (Legacy Messaging) | Thin wrappers (tool-key-storage.ts, keychain-token-storage.ts) | wrapper contract tests (P07) | [ ] |
| R8 (Observability) | secure-store.ts | secure-store.test.ts | [ ] |
| R9 (PKS CRUD) | provider-key-storage.ts | provider-key-storage.test.ts | [ ] |
| R10 (Name Validation) | provider-key-storage.ts | provider-key-storage.test.ts | [ ] |
| R11 (Platform) | provider-key-storage.ts | provider-key-storage.test.ts | [ ] |
| R12 (Parsing) | keyCommand.ts | keyCommand.test.ts | [ ] |
| R13 (/key save) | keyCommand.ts | keyCommand.test.ts | [ ] |
| R14 (/key load) | keyCommand.ts | keyCommand.test.ts | [ ] |
| R15 (/key show) | keyCommand.ts | keyCommand.test.ts | [ ] |
| R16 (/key list) | keyCommand.ts | keyCommand.test.ts | [ ] |
| R17 (/key delete) | keyCommand.ts | keyCommand.test.ts | [ ] |
| R18 (Storage Failure) | keyCommand.ts | keyCommand.test.ts | [ ] |
| R19 (Autocomplete) | keyCommand.ts | keyCommand.test.ts | [ ] |
| R20 (Secure Input) | secureInputHandler.ts, keyCommand.ts | keyCommand.test.ts | [ ] |
| R21 (auth-key-name) | profileBootstrap.ts, config.ts, runtimeSettings.ts | runtimeSettings.test.ts | [ ] |
| R22 (--key-name) | profileBootstrap.ts, runtimeSettings.ts | runtimeSettings.test.ts | [ ] |
| R23 (Precedence) | runtimeSettings.ts | runtimeSettings.test.ts | [ ] |
| R24 (Error Handling) | runtimeSettings.ts | runtimeSettings.test.ts | [ ] |
| R25 (Diagnostics) | runtimeSettings.ts | runtimeSettings.test.ts | [ ] |
| R26 (No Deprecations) | all auth files | runtimeSettings.test.ts | [ ] |
| R27 (Test Acceptance) | test files | self-referential | [ ] |

## Holistic Functionality Assessment (MANDATORY)

### System Architecture Summary

The verifier MUST write a complete description of:
1. How SecureStore works (keyring + fallback)
2. How each thin wrapper delegates to SecureStore
3. How /key commands provide user access
4. How auth-key-name / --key-name integrate with session bootstrap
5. The complete data flow from CLI arg → stored key → active session

### Integration Health

The verifier MUST confirm:
- [ ] SecureStore is the ONLY component that touches keyring or encrypted files
- [ ] All four original implementations are refactored (R7) or eliminated (R7.3, R7.4)
- [ ] ProviderKeyStorage provides the bridge between SecureStore and CLI/profile
- [ ] /key commands are accessible to users in the CLI
- [ ] auth-key-name and --key-name are accessible to users in profiles/CLI
- [ ] The feature cannot be built in isolation — it modifies existing code paths

### What Could Go Wrong?

- [ ] Keyring unavailable + fallback policy 'deny' → error path tested
- [ ] Concurrent access to fallback files → atomic write tested
- [ ] Platform differences (macOS vs Linux vs Windows) → documented
- [ ] Missing named key → error not silent fallthrough

### Final Verdict

[PASS/FAIL with comprehensive explanation]

## Success Criteria

- ALL tests pass (npm test, npm run typecheck, npm run lint, npm run format, npm run build)
- Smoke test succeeds
- No deferred implementation patterns found
- No duplicate keyring code outside SecureStore
- FileTokenStorage and HybridTokenStorage eliminated
- All 93 requirements traceable to implementation + tests
- Full integration chain verified
- No secret values in logs

## Failure Recovery

If final verification fails:
1. Identify which requirement/component is deficient
2. Return to the relevant implementation phase
3. Fix the issue following the Stub → TDD → Impl cycle
4. Re-run final verification

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P19.md`
Contents must include:
- Full holistic functionality assessment
- All verification command outputs
- Requirement traceability table (filled in)
- Final verdict with explanation
