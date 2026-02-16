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
