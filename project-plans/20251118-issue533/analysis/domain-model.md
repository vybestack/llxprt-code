# Domain Analysis: --profile CLI Flag

## Domain Entities

### 1. CLI Argument (Input Domain)
**Definition**: Raw string passed to the CLI via `--profile` flag.

**Properties**:
- Format: `--profile <json-string>` or `--profile=<json-string>`
- Source: Command-line invocation, shell script, CI/CD pipeline
- Characteristics: May contain special characters, shell escaping, whitespace
- Constraints: Must be valid JSON syntax

**State Transitions**:
```
Raw CLI Argument → Tokenized → Parsed → Validated → Applied
```

**Variants**:
- Inline value: `--profile='{...}'`
- Space-separated: `--profile '{...}'`
- Environment variable: `--profile "$PROFILE_JSON"`

### 2. Profile JSON (Intermediate Domain)
**Definition**: Parsed JavaScript object representing provider configuration.

**Properties**:
- Structure: Matches `ProfileConfig` schema
- Required fields: `provider`, `model`
- Optional fields: `key`, `baseUrl`, temperature, max_tokens, etc.
- Validation: Must pass Zod schema validation

**State Transitions**:
```
JSON String → Parsed Object → Validated Profile → ProfileApplicationResult
```

**Business Rules**:
1. Provider must be in supported provider list
2. Model must be valid for specified provider
3. Numeric parameters within valid ranges
4. Unknown fields rejected (strict mode)

### 3. Bootstrap Arguments (Context Domain)
**Definition**: Aggregated command-line arguments used to initialize the runtime.

**Properties**:
- Collection: All `--profile*`, `--provider`, `--model`, `--key`, etc.
- Mutual Exclusivity: Only one profile source (`--profile` XOR `--profile-load`)
- Override Hierarchy: Defaults → Profile → CLI Flags

**State**:
- `profileName: string | null` - From `--profile-load`
- `profileJson: string | null` - From `--profile` (NEW)
- `providerOverride: string | null` - From `--provider`
- `modelOverride: string | null` - From `--model`
- Other overrides...

**Invariants**:
- At most one of `profileName` or `profileJson` is non-null
- If both are non-null, ERROR state
- All override fields can coexist with profile source

### 4. Profile Application Result (Output Domain)
**Definition**: Fully resolved configuration ready for provider initialization.

**Properties**:
- Merged settings from: defaults → profile → overrides
- Validation status: Success | Error with messages
- Warnings: Non-fatal issues (deprecated fields, etc.)

**State Transitions**:
```
BootstrapArgs → Resolve Profile Source → Merge Layers → Validate → RuntimeContext
```

## Entity Relationships

```
CLIArgument (1) --[tokenizes]--> (1) ParsedArgs
ParsedArgs (1) --[contains]--> (0..1) ProfileJsonString
ProfileJsonString (1) --[parses to]--> (1) ProfileObject
ProfileObject (1) --[validates to]--> (1) ProfileApplicationResult
ProfileApplicationResult (1) --[initializes]--> (1) ProviderRuntimeContext
```

**Key Relationship**: `--profile` and `--profile-load` are MUTUALLY EXCLUSIVE inputs that produce the SAME output type (ProfileApplicationResult).

## Business Rules

### BR-001: Profile Source Selection
**Rule**: Exactly one profile source method must be used per invocation.

**Logic**:
```
IF profileName IS NOT NULL AND profileJson IS NOT NULL THEN
  THROW MutualExclusivityError
ELSE IF profileName IS NOT NULL THEN
  USE FILE-BASED PROFILE LOADING
ELSE IF profileJson IS NOT NULL THEN
  USE INLINE PROFILE PARSING
ELSE
  NO PROFILE (use defaults)
END IF
```

**Rationale**: Ambiguity in configuration leads to user errors. Clear error message guides correction.

### BR-002: Override Precedence
**Rule**: CLI flags override profile values, profile overrides defaults.

**Application Order**:
1. Load defaults (from provider definition)
2. Apply profile (file-based OR inline)
3. Apply CLI overrides (`--provider`, `--model`, `--key`, etc.)

**Example**:
```json
Default: { temperature: 1.0 }
Profile: { temperature: 0.7, max_tokens: 2048 }
CLI: --temperature 0.9
Result: { temperature: 0.9, max_tokens: 2048 }
```

**Rationale**: Users expect CLI flags to have highest priority. Profile sets base configuration.

### BR-003: JSON Validation Strictness
**Rule**: Unknown fields in profile JSON are rejected.

**Logic**:
```
FOR EACH field IN profileJson DO
  IF field NOT IN ProfileConfigSchema THEN
    THROW ValidationError("Unknown field: " + field)
  END IF
END FOR
```

**Rationale**: Prevents typos (e.g., `temperture` instead of `temperature`). Fail-fast on misconfiguration.

### BR-004: Required Field Enforcement
**Rule**: Profile must contain `provider` and `model` at minimum.

**Validation**:
```
IF profileJson.provider IS NULL OR profileJson.model IS NULL THEN
  THROW ValidationError("Profile must specify 'provider' and 'model'")
END IF
```

**Rationale**: Profile without provider/model is meaningless. Explicit error better than runtime failure.

### BR-005: Security - No Logging of Sensitive Data
**Rule**: Profile JSON string must never be logged.

**Implementation**:
```
WHEN parsing profileJson DO
  LOG("Parsing inline profile")  # Safe
  DO NOT LOG(profileJson)        # May contain API keys
  ON ERROR LOG("Profile validation failed: " + error.message)  # Safe
END WHEN
```

**Rationale**: API keys in profile JSON could leak to logs, CI/CD outputs, or error reports.

## Edge Cases

### Edge Case 1: Empty JSON Object
**Input**: `--profile '{}'`
**Expected Behavior**: Validation error (missing required fields `provider`, `model`)
**Business Rule**: BR-004
**Error Message**: "Profile must specify 'provider' and 'model'"

### Edge Case 2: JSON with Only Provider
**Input**: `--profile '{"provider":"openai"}'`
**Expected Behavior**: Validation error (missing required field `model`)
**Business Rule**: BR-004
**Error Message**: "Profile must specify 'model'"

### Edge Case 3: Both --profile and --profile-load
**Input**: `--profile '{"provider":"openai","model":"gpt-4"}' --profile-load my-profile`
**Expected Behavior**: Mutual exclusivity error
**Business Rule**: BR-001
**Error Message**: "Cannot use both --profile and --profile-load. Choose one profile source."

### Edge Case 4: Malformed JSON (Missing Closing Brace)
**Input**: `--profile '{"provider":"openai","model":"gpt-4"'`
**Expected Behavior**: JSON syntax error
**Business Rule**: JSON parsing
**Error Message**: "Invalid JSON in --profile: Unexpected end of JSON input at position 42"

### Edge Case 5: Malformed JSON (Trailing Comma)
**Input**: `--profile '{"provider":"openai","model":"gpt-4",}'`
**Expected Behavior**: JSON syntax error (in strict parsers)
**Business Rule**: JSON parsing
**Error Message**: "Invalid JSON in --profile: Unexpected token } at position 44"

### Edge Case 6: Invalid Provider Name
**Input**: `--profile '{"provider":"invalid-provider","model":"gpt-4"}'`
**Expected Behavior**: Validation error (unknown provider)
**Business Rule**: BR-003 + Provider validation
**Error Message**: "Unknown provider 'invalid-provider'. Supported: openai, anthropic, google, ..."

### Edge Case 7: Type Mismatch (Temperature as String)
**Input**: `--profile '{"provider":"openai","model":"gpt-4","temperature":"0.7"}'`
**Expected Behavior**: Validation error (temperature must be number)
**Business Rule**: Zod schema validation
**Error Message**: "Profile validation failed: 'temperature' must be a number"

### Edge Case 8: Out-of-Range Parameter
**Input**: `--profile '{"provider":"openai","model":"gpt-4","temperature":5.0}'`
**Expected Behavior**: Validation error (temperature range 0-2)
**Business Rule**: Schema constraints
**Error Message**: "Profile validation failed: 'temperature' must be between 0 and 2"

### Edge Case 9: Profile Override Interaction
**Input**: `--profile '{"provider":"openai","model":"gpt-3.5-turbo"}' --model gpt-4`
**Expected Behavior**: Profile applied, then overridden (final: gpt-4)
**Business Rule**: BR-002
**Result**: Provider: openai (from profile), Model: gpt-4 (override)

### Edge Case 10: Shell Escaping Issues (Unquoted)
**Input**: `--profile {"provider":"openai","model":"gpt-4"}`
**Expected Behavior**: Shell parsing error (shell interprets {} as glob)
**Mitigation**: Documentation emphasizes quoting
**Platform**: Bash/Zsh

### Edge Case 11: PowerShell Escaping
**Input**: `--profile '{"provider":"openai","model":"gpt-4"}'`
**Expected Behavior**: May work or may require double-quoting
**Mitigation**: Documentation provides PowerShell-specific examples
**Platform**: PowerShell

### Edge Case 12: Very Large Profile JSON (>10KB)
**Input**: Profile with thousands of unknown fields
**Expected Behavior**: Size limit error
**Business Rule**: Performance constraint (REQ-PROF-003.3)
**Error Message**: "Profile JSON exceeds maximum size of 10KB"

### Edge Case 13: Deeply Nested JSON
**Input**: `--profile '{"provider":"openai","model":"gpt-4","nested":{"level":{"depth":{"too":{"deep":{...}}}}}}'`
**Expected Behavior**: Nesting depth limit error
**Business Rule**: Performance constraint (REQ-PROF-003.3)
**Error Message**: "Profile JSON exceeds maximum nesting depth of 10 levels"

### Edge Case 14: Non-ASCII Characters in Model Name
**Input**: `--profile '{"provider":"openai","model":"gpt-4-日本語"}'`
**Expected Behavior**: Depends on provider support (likely validation error)
**Business Rule**: Provider-specific validation
**Error Message**: "Invalid model 'gpt-4-日本語' for provider 'openai'"

### Edge Case 15: Null Values in Profile
**Input**: `--profile '{"provider":"openai","model":"gpt-4","temperature":null}'`
**Expected Behavior**: Treat as unset (use default) OR validation error
**Business Rule**: Schema handling of nulls
**Implementation Decision**: Reject nulls (explicit undefined better than ambiguous null)

## Error Scenarios

### ES-001: Syntax Error in JSON
**Trigger**: Malformed JSON string
**Detection**: `JSON.parse()` throws `SyntaxError`
**Handling**:
1. Catch exception
2. Extract position/line information
3. Show context (characters around error)
4. Exit with code 1

**Error Message Template**:
```
Error: Invalid JSON in --profile flag
  Unexpected token } at position 44
  ...,"model":"gpt-4",}
                      ^
Ensure JSON is properly quoted and escaped for your shell.
```

### ES-002: Validation Error
**Trigger**: Valid JSON but invalid profile structure
**Detection**: Zod schema validation fails
**Handling**:
1. Collect all validation errors
2. Format as bullet list
3. Show corrected example
4. Exit with code 1

**Error Message Template**:
```
Error: Profile validation failed
  - Missing required field 'model'
  - Invalid value for 'temperature': must be between 0 and 2

Example valid profile:
  --profile '{"provider":"openai","model":"gpt-4","temperature":0.7}'
```

### ES-003: Mutual Exclusivity Violation
**Trigger**: Both `--profile` and `--profile-load` specified
**Detection**: Both fields non-null in `BootstrapProfileArgs`
**Handling**:
1. Check in `parseBootstrapArgs()` after parsing all flags
2. Show both values received
3. Guide to correct usage
4. Exit with code 1

**Error Message Template**:
```
Error: Cannot use both --profile and --profile-load
  --profile: {"provider":"openai","model":"gpt-4"}
  --profile-load: my-profile

Choose one profile source:
  - Use --profile for inline JSON (CI/CD)
  - Use --profile-load for saved profiles (local dev)
```

### ES-004: Unknown Provider
**Trigger**: Provider not in supported list
**Detection**: Provider validation logic
**Handling**:
1. Show invalid provider name
2. List all supported providers
3. Suggest closest match (Levenshtein distance)
4. Exit with code 1

**Error Message Template**:
```
Error: Unknown provider 'opena1' (did you mean 'openai'?)
Supported providers: openai, anthropic, google, azure, local
```

## State Transitions

### Argument Parsing State Machine

```
[START] 
  → TOKEN_START (encounter '--profile')
  → TOKEN_VALUE (consume next token or inline value)
  → PARSED (store in bootstrapArgs.profileJson)
  → VALIDATION_PENDING

VALIDATION_PENDING
  → JSON_PARSE (call JSON.parse())
    → SUCCESS: SCHEMA_VALIDATION
    → FAILURE: ERROR_STATE (ES-001)

SCHEMA_VALIDATION
  → VALIDATE (Zod schema)
    → SUCCESS: PROFILE_READY
    → FAILURE: ERROR_STATE (ES-002)

PROFILE_READY
  → MUTUAL_EXCLUSIVITY_CHECK
    → PASS: APPLICATION_READY
    → FAIL: ERROR_STATE (ES-003)

APPLICATION_READY
  → MERGE_PROFILE
  → APPLY_OVERRIDES
  → [COMPLETE]

ERROR_STATE
  → FORMAT_ERROR_MESSAGE
  → PRINT_TO_STDERR
  → EXIT(1)
```

### Profile Application State Transitions

```
[BOOTSTRAP_START]
  ↓
CHECK_PROFILE_SOURCE:
  IF profileJson NOT NULL:
    → INLINE_PROFILE_FLOW
  ELSE IF profileName NOT NULL:
    → FILE_PROFILE_FLOW
  ELSE:
    → DEFAULT_ONLY_FLOW

INLINE_PROFILE_FLOW:
  → PARSE_JSON
  → VALIDATE_SCHEMA
  → CREATE_PROFILE_RESULT
  → MERGE_WITH_DEFAULTS
  → APPLY_OVERRIDES
  → [RUNTIME_READY]

FILE_PROFILE_FLOW: (existing, unchanged)
  → LOAD_FILE
  → PARSE_JSON
  → VALIDATE_SCHEMA
  → CREATE_PROFILE_RESULT
  → MERGE_WITH_DEFAULTS
  → APPLY_OVERRIDES
  → [RUNTIME_READY]

DEFAULT_ONLY_FLOW: (existing, unchanged)
  → LOAD_DEFAULTS
  → APPLY_OVERRIDES
  → [RUNTIME_READY]
```

**Key Insight**: INLINE_PROFILE_FLOW and FILE_PROFILE_FLOW CONVERGE at "CREATE_PROFILE_RESULT". This means all downstream logic (merge, apply overrides) is UNCHANGED.

## Integration Points (Detailed)

### Integration Point 1: parseBootstrapArgs()
**Location**: `packages/cli/src/config/profileBootstrap.ts` line ~76
**Current Behavior**: Parses CLI args into `BootstrapProfileArgs`
**Modification Required**:
1. Add case for `--profile` in switch statement
2. Call `consumeValue()` to get JSON string
3. Store in `bootstrapArgs.profileJson` (NEW field)
4. Add mutual exclusivity check at end of function

**Pseudocode Reference**: Lines 10-25 (to be created)

### Integration Point 2: bootstrapProviderRuntimeWithProfile()
**Location**: `packages/cli/src/config/profileBootstrap.ts` line ~200+
**Current Behavior**: Loads profile from file if `profileName` exists
**Modification Required**:
1. Check `profileJson` BEFORE checking `profileName`
2. If `profileJson`: parse, validate, create `ProfileApplicationResult`
3. If `profileName`: existing file loading logic (unchanged)
4. If neither: defaults only (unchanged)

**Pseudocode Reference**: Lines 50-85 (to be created)

### Integration Point 3: BootstrapProfileArgs Type
**Location**: `packages/cli/src/config/profileBootstrap.ts` line ~34
**Current Definition**:
```typescript
export interface BootstrapProfileArgs {
  profileName: string | null;
  providerOverride: string | null;
  // ... other overrides
}
```
**Modification Required**: Add `profileJson: string | null;`

**Pseudocode Reference**: Line 5 (type extension)

### Integration Point 4: Error Handling
**Location**: Throughout parsing and validation
**Current Behavior**: File-loading errors, validation errors
**Modification Required**:
1. Add JSON syntax error handling
2. Add mutual exclusivity error
3. Format errors consistently with existing patterns

**Pseudocode Reference**: Lines 90-120 (error handling)

## Data Flow Diagram

```
┌─────────────────┐
│  CLI Invocation │
│  --profile {...}│
└────────┬────────┘
         │
         ↓
┌─────────────────────┐
│ parseBootstrapArgs()│ ← Integration Point 1
│   - Tokenize args   │
│   - Extract JSON    │
│   - Store in args   │
└────────┬────────────┘
         │
         ↓
┌────────────────────────────────┐
│ bootstrapProviderRuntime...()  │ ← Integration Point 2
│   - Check profileJson          │
│   - Parse JSON.parse()         │
│   - Validate with Zod          │
│   - Create ProfileAppResult    │
└────────┬───────────────────────┘
         │
         ↓
┌───────────────────────┐
│ Merge Configuration   │ (Existing logic - NO CHANGE)
│  - Defaults           │
│  - Profile            │
│  - CLI Overrides      │
└────────┬──────────────┘
         │
         ↓
┌─────────────────────────┐
│ ProviderRuntimeContext  │ (Existing - NO CHANGE)
│  - Provider initialized │
│  - Ready for use        │
└─────────────────────────┘
```

**Key Observation**: Changes are LIMITED to argument parsing and profile source resolution. All downstream logic (merge, provider initialization) is UNCHANGED.

## Validation Rules (Detailed)

### Schema Validation (Zod)
**Existing Schema**: `ProfileConfigSchema` (already exists in codebase)
**Required Validation**:
1. Type checking (string, number, boolean)
2. Required fields (`provider`, `model`)
3. Range checking (temperature 0-2, max_tokens > 0)
4. Enum checking (provider in supported list)
5. Unknown field rejection (strict mode)

**No New Validation Logic**: Use existing schema as-is.

### Mutual Exclusivity Validation
**Check**: At most one of `profileJson` or `profileName` is non-null
**Location**: End of `parseBootstrapArgs()`
**Logic**:
```typescript
if (bootstrapArgs.profileJson !== null && bootstrapArgs.profileName !== null) {
  throw new Error(
    'Cannot use both --profile and --profile-load. Choose one profile source.'
  );
}
```

### Size Limit Validation
**Check**: JSON string length ≤ 10KB
**Location**: Immediately after extracting JSON string
**Logic**:
```typescript
if (profileJson.length > 10240) {
  throw new Error('Profile JSON exceeds maximum size of 10KB');
}
```

**Rationale**: Prevent DoS through extremely large arguments.

### Nesting Depth Validation
**Check**: JSON nesting depth ≤ 10 levels
**Location**: After JSON.parse(), before schema validation
**Implementation**: Recursive depth counter
**Logic**:
```typescript
function checkDepth(obj: any, maxDepth: number, currentDepth = 0): void {
  if (currentDepth > maxDepth) {
    throw new Error(`Profile JSON exceeds maximum nesting depth of ${maxDepth}`);
  }
  if (typeof obj === 'object' && obj !== null) {
    for (const value of Object.values(obj)) {
      checkDepth(value, maxDepth, currentDepth + 1);
    }
  }
}
```

## Testing Strategy Considerations

### Unit Test Boundaries
**What to Unit Test**:
- JSON parsing (valid, invalid, edge cases)
- Schema validation (missing fields, wrong types, ranges)
- Mutual exclusivity check
- Size/depth limit checks
- Error message formatting

**What NOT to Unit Test**:
- Shell escaping (integration test)
- Actual provider initialization (integration test)
- End-to-end profile application (integration test)

### Integration Test Scenarios
**Required Tests**:
1. Full CLI invocation with `--profile` (end-to-end)
2. Profile + overrides precedence
3. Mutual exclusivity error
4. Shell escaping (Bash, PowerShell)
5. GitHub Actions simulation

### Property-Based Testing Opportunities
**Generators**:
- Random valid profiles (all permutations of fields)
- Random invalid profiles (type errors, missing fields)
- Random JSON with unknown fields

**Properties**:
1. Valid profile JSON always parses successfully
2. Invalid provider always fails validation
3. Override always takes precedence over profile
4. Mutual exclusivity always detected

## Glossary

- **Bootstrap**: Initialization process of CLI runtime
- **Profile**: Configuration object with provider/model settings
- **Inline Profile**: Profile passed as JSON string via `--profile`
- **File-Based Profile**: Profile loaded from `~/.llxprt/profiles/`
- **Mutual Exclusivity**: Constraint preventing two options from being used together
- **Override Precedence**: Order in which config sources are applied (defaults → profile → CLI flags)
- **Schema Validation**: Checking data structure against defined types/constraints
- **Zod**: TypeScript-first schema validation library
- **CI/CD**: Continuous Integration/Continuous Deployment pipelines
- **Shell Escaping**: Quoting/escaping special characters for shell interpretation
