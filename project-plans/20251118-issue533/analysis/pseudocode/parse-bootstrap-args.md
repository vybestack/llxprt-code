# Pseudocode: parseBootstrapArgs() Extension

## Purpose
Extend `parseBootstrapArgs()` to recognize and parse `--profile` flag with inline JSON.

## Input
- `argv`: Array of command-line argument strings (process.argv.slice(2))

## Output
- `BootstrapProfileArgs` object with populated `profileJson` field

## Algorithm

```
001: FUNCTION parseBootstrapArgs() RETURNS ParsedBootstrapArgs
002:   DECLARE argv AS string array = process.argv.slice(2)
003:   DECLARE bootstrapArgs AS BootstrapProfileArgs = {
004:     profileName: null,
005:     profileJson: null,  // NEW FIELD
006:     providerOverride: null,
007:     modelOverride: null,
008:     keyOverride: null,
009:     keyfileOverride: null,
010:     baseurlOverride: null,
011:     setOverrides: null
012:   }
013:   DECLARE profileLoadUsed AS boolean = false  // Track for mutual exclusivity
014:   DECLARE profileUsed AS boolean = false      // Track for mutual exclusivity
015: 
016:   FOR index FROM 0 TO argv.length - 1 DO
017:     DECLARE token AS string = argv[index]
018:     IF NOT token.startsWith('-') THEN
019:       CONTINUE  // Skip non-flag tokens
020:     END IF
021: 
022:     DECLARE flag AS string = token
023:     DECLARE inline AS string | undefined = undefined
024:     DECLARE equalsIndex AS number = token.indexOf('=')
025:     IF equalsIndex !== -1 THEN
026:       SET flag = token.slice(0, equalsIndex)
027:       SET inline = token.slice(equalsIndex + 1)
028:     END IF
029: 
030:     SWITCH flag DO
031:       CASE '--profile':  // NEW CASE
032:         DECLARE result AS { value: string | null, nextIndex: number }
033:         SET result = consumeValue(argv, index, inline)
034:         IF result.value === null THEN
035:           THROW Error("--profile requires a value")
036:         END IF
037:         SET bootstrapArgs.profileJson = result.value
038:         SET profileUsed = true
039:         SET index = result.nextIndex
040:         BREAK
041: 
042:       CASE '--profile-load':  // Existing case, add tracking
043:         DECLARE result AS { value: string | null, nextIndex: number }
044:         SET result = consumeValue(argv, index, inline)
045:         SET bootstrapArgs.profileName = result.value
046:         SET profileLoadUsed = true
047:         SET index = result.nextIndex
048:         BREAK
049: 
050:       // ... other existing cases unchanged ...
051:       CASE '--provider':
052:         // existing implementation
053:       CASE '--model':
054:         // existing implementation
055:       // etc.
056:     END SWITCH
057:   END FOR
058: 
059:   // Mutual Exclusivity Check (NEW)
060:   IF profileUsed AND profileLoadUsed THEN
061:     THROW Error(
062:       "Cannot use both --profile and --profile-load. " +
063:       "Choose one profile source:\n" +
064:       "  --profile for inline JSON (CI/CD)\n" +
065:       "  --profile-load for saved profiles (local dev)"
066:     )
067:   END IF
068: 
069:   // Size Limit Check (NEW)
070:   IF bootstrapArgs.profileJson !== null THEN
071:     IF bootstrapArgs.profileJson.length > 10240 THEN
072:       THROW Error("Profile JSON exceeds maximum size of 10KB")
073:     END IF
074:   END IF
075: 
076:   RETURN {
077:     args: bootstrapArgs,
078:     warnings: []  // Warnings populated by later validation
079:   }
080: END FUNCTION
081: 
082: // Helper function (existing, unchanged)
083: FUNCTION consumeValue(argv, index, inline) RETURNS { value, nextIndex }
084:   IF inline !== undefined THEN
085:     RETURN { value: inline, nextIndex: index }
086:   END IF
087:   IF index + 1 < argv.length AND NOT argv[index + 1].startsWith('-') THEN
088:     RETURN { value: argv[index + 1], nextIndex: index + 1 }
089:   END IF
090:   RETURN { value: null, nextIndex: index }
091: END FUNCTION
```

## Key Changes from Existing Code

1. **Line 005**: Add `profileJson: null` field to `BootstrapProfileArgs` initialization
2. **Lines 013-014**: Add boolean flags to track which profile method was used
3. **Lines 031-040**: NEW case for `--profile` flag parsing
4. **Lines 042-048**: Modified case for `--profile-load` to set tracking flag
5. **Lines 060-067**: NEW mutual exclusivity validation
6. **Lines 070-074**: NEW size limit validation

## Error Conditions

### E1: Missing --profile Value
**Trigger**: `--profile` flag without argument (line 034)
**Example**: `llxprt --profile --prompt "test"`
**Error**: "Error: --profile requires a value"

### E2: Mutual Exclusivity Violation
**Trigger**: Both flags present (line 060)
**Example**: `llxprt --profile '{"provider":"openai","model":"gpt-4"}' --profile-load my-profile`
**Error**: Multi-line error message (lines 061-066)

### E3: Size Limit Exceeded
**Trigger**: JSON string > 10KB (line 071)
**Example**: `llxprt --profile '{"provider":"openai","model":"gpt-4","data":"<9KB of text>"}'`
**Error**: "Error: Profile JSON exceeds maximum size of 10KB"

## Invariants

1. **At most one profile source**: `(profileUsed AND profileLoadUsed) == false` always true after line 067
2. **Value presence**: If `profileUsed == true`, then `profileJson !== null`
3. **Size constraint**: If `profileJson !== null`, then `profileJson.length <= 10240`

## Integration Points

- **Calls**: `consumeValue()` - Existing helper function, unchanged
- **Returns to**: `bootstrapProviderRuntimeWithProfile()` - Caller, minimal changes needed
- **Type Contract**: Returns `ParsedBootstrapArgs` matching existing interface

## Testing Considerations

### Test Scenarios for Lines 031-040
1. `--profile '{"provider":"openai","model":"gpt-4"}'` → profileJson populated
2. `--profile={"provider":"openai","model":"gpt-4"}` → profileJson populated (inline syntax)
3. `--profile` (no value) → Error E1
4. `--profile ''` (empty string) → profileJson = '' (validation fails later)

### Test Scenarios for Lines 060-067
1. `--profile {...} --profile-load name` → Error E2
2. `--profile-load name --profile {...}` → Error E2 (order independent)
3. `--profile {...}` only → No error
4. `--profile-load name` only → No error
5. Neither flag → No error

### Test Scenarios for Lines 070-074
1. JSON string with 10240 bytes → OK
2. JSON string with 10241 bytes → Error E3
3. profileJson = null → Skip check (line 070 guard)

## Notes

- **No JSON parsing yet**: This function only EXTRACTS the JSON string. Parsing happens in `bootstrapProviderRuntimeWithProfile()`.
- **No validation yet**: Schema validation happens later in pipeline. This function validates structure only.
- **Backwards compatible**: Existing behavior for all other flags unchanged.
