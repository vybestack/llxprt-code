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
