# Pseudocode: Profile Application with Inline JSON

## Purpose
Extend `prepareRuntimeForProfile()` to handle inline JSON profiles from `--profile` flag.

## Input
- `bootstrapArgs: BootstrapProfileArgs` - Contains either `profileName` OR `profileJson`
- `settingsService: SettingsService` - For loading defaults and applying settings
- `providerManager: ProviderManager` - For provider initialization

## Output
- `BootstrapResult` - Contains initialized runtime context

## Algorithm

```
001: FUNCTION prepareRuntimeForProfile(
002:   bootstrapArgs,
003:   settingsService,
004:   providerManager,
005:   oauthManager
006: ) RETURNS Promise<BootstrapRuntimeState>
007: 
008:   DECLARE profile AS ProfileApplicationResult | null = null
009:   DECLARE warnings AS string array = []
010: 
011:   // Determine profile source (NEW LOGIC)
012:   IF bootstrapArgs.profileJson !== null THEN
013:     // INLINE PROFILE FLOW (NEW)
014:     TRY
015:       SET profile = parseInlineProfile(bootstrapArgs.profileJson)
016:       IF profile.warnings.length > 0 THEN
017:         APPEND profile.warnings TO warnings
018:       END IF
019:     CATCH error AS JsonParseError
020:       THROW Error(
021:         "Invalid JSON in --profile flag:\n" +
022:         "  " + error.message + "\n" +
023:         "Ensure JSON is properly quoted and escaped for your shell."
024:       )
025:     CATCH error AS ValidationError
026:       THROW Error(
027:         "Profile validation failed:\n" +
028:         formatValidationErrors(error.errors) + "\n\n" +
029:         "Example valid profile:\n" +
030:         "  --profile '{\"provider\":\"openai\",\"model\":\"gpt-4\",\"temperature\":0.7}'"
031:       )
032:     END TRY
033: 
034:   ELSE IF bootstrapArgs.profileName !== null THEN
035:     // FILE-BASED PROFILE FLOW (EXISTING - UNCHANGED)
036:     SET profile = loadProfileFromFile(
037:       bootstrapArgs.profileName,
038:       settingsService
039:     )
040:     IF profile.warnings.length > 0 THEN
041:       APPEND profile.warnings TO warnings
042:     END IF
043: 
044:   ELSE
045:     // NO PROFILE FLOW (EXISTING - UNCHANGED)
046:     SET profile = null
047:   END IF
048: 
049:   // Merge configuration layers (EXISTING - UNCHANGED)
050:   DECLARE runtimeConfig AS ProviderRuntimeContext['config']
051:   IF profile !== null THEN
052:     SET runtimeConfig = mergeProfileWithDefaults(
053:       profile,
054:       settingsService.getDefaults()
055:     )
056:   ELSE
057:     SET runtimeConfig = settingsService.getDefaults()
058:   END IF
059: 
060:   // Apply CLI overrides (EXISTING - UNCHANGED)
061:   IF bootstrapArgs.providerOverride !== null THEN
062:     SET runtimeConfig.provider = bootstrapArgs.providerOverride
063:   END IF
064:   IF bootstrapArgs.modelOverride !== null THEN
065:     SET runtimeConfig.model = bootstrapArgs.modelOverride
066:   END IF
067:   IF bootstrapArgs.keyOverride !== null THEN
068:     SET runtimeConfig.apiKey = bootstrapArgs.keyOverride
069:   END IF
070:   // ... other overrides ...
071: 
072:   // Initialize provider runtime (EXISTING - UNCHANGED)
073:   DECLARE runtime AS ProviderRuntimeContext
074:   SET runtime = await providerManager.initializeRuntime(runtimeConfig)
075: 
076:   RETURN {
077:     runtime,
078:     providerManager,
079:     oauthManager,
080:     bootstrapArgs,
081:     profile
082:   }
083: END FUNCTION
084: 
085: // NEW HELPER FUNCTION: Parse and validate inline profile JSON
086: FUNCTION parseInlineProfile(jsonString) RETURNS ProfileApplicationResult
087:   DECLARE profileObject AS object
088:   DECLARE warnings AS string array = []
089: 
090:   // Step 1: Parse JSON syntax
091:   TRY
092:     SET profileObject = JSON.parse(jsonString)
093:   CATCH syntaxError
094:     THROW JsonParseError(syntaxError.message)
095:   END TRY
096: 
097:   // Step 2: Check nesting depth (security constraint)
098:   IF getMaxNestingDepth(profileObject) > 10 THEN
099:     THROW ValidationError({
100:       errors: [{
101:         field: 'root',
102:         message: 'Profile JSON exceeds maximum nesting depth of 10 levels'
103:       }]
104:     })
105:   END IF
106: 
107:   // Step 3: Validate against ProfileConfig schema (Zod)
108:   DECLARE validationResult AS ZodResult
109:   SET validationResult = ProfileConfigSchema.safeParse(profileObject)
110: 
111:   IF NOT validationResult.success THEN
112:     THROW ValidationError({
113:       errors: validationResult.error.issues.map(issue => ({
114:         field: issue.path.join('.'),
115:         message: issue.message,
116:         received: issue.received
117:       }))
118:     })
119:   END IF
120: 
121:   // Step 4: Check for deprecated fields (warnings only)
122:   IF profileObject.hasOwnProperty('deprecatedField') THEN
123:     APPEND "Field 'deprecatedField' is deprecated and will be removed in v2.0" TO warnings
124:   END IF
125: 
126:   // Step 5: Validate provider-specific constraints
127:   TRY
128:     VALIDATE providerSpecificRules(validationResult.data)
129:   CATCH error AS ProviderValidationError
130:     THROW ValidationError({
131:       errors: [{

132:         field: error.field,
133:         message: error.message
134:       }]
135:     })
136:   END TRY
137: 
138:   // Step 6: Return validated profile as BootstrapRuntimeState
139:   // WARNING: IMPORTANT: Use actual field names from BootstrapRuntimeState
140:   // (profileBootstrap.ts:47-52)
141:   RETURN {
142:     providerName: validationResult.data.provider,  // ← 'providerName', not 'provider'
143:     modelName: validationResult.data.model,        // ← 'modelName', not 'model'
144:     warnings: warnings
145:   }
146: END FUNCTION
150: 
151: // HELPER FUNCTION: Calculate max nesting depth
152: FUNCTION getMaxNestingDepth(obj, currentDepth = 0) RETURNS number
153:   IF obj IS NOT object OR obj IS null THEN
154:     RETURN currentDepth
155:   END IF
156: 
157:   DECLARE maxChildDepth AS number = currentDepth
158:   FOR EACH value IN Object.values(obj) DO
159:     DECLARE childDepth AS number = getMaxNestingDepth(value, currentDepth + 1)
160:     IF childDepth > maxChildDepth THEN
161:       SET maxChildDepth = childDepth
162:     END IF
163:   END FOR
164: 
165:   RETURN maxChildDepth
166: END FUNCTION
167: 
168: // HELPER FUNCTION: Format validation errors for user display
169: FUNCTION formatValidationErrors(errors) RETURNS string
170:   DECLARE formatted AS string array = []
171:   FOR EACH error IN errors DO
172:     IF error.field THEN
173:       APPEND "  - " + error.field + ": " + error.message TO formatted
174:     ELSE
175:       APPEND "  - " + error.message TO formatted
176:     END IF
177:     IF error.received !== undefined THEN
178:       APPEND "    (received: " + JSON.stringify(error.received) + ")" TO formatted
179:     END IF
180:   END FOR
181:   RETURN formatted.join('\n')
182: END FUNCTION
183: 
184: // HELPER FUNCTION: Validate provider-specific rules
// Note: This helper receives the parsed object, not BootstrapRuntimeState
185: FUNCTION providerSpecificRules(profileData) RETURNS void
186:   SWITCH profileData.provider DO
187:     CASE 'openai':
188:       IF profileData.model NOT IN openaiModels THEN
189:         THROW ProviderValidationError({
190:           field: 'model',
191:           message: "Invalid model '" + profileData.model + "' for provider 'openai'"
192:         })
193:       END IF
194:       IF profileData.temperature !== undefined AND 
195:          (profileData.temperature < 0 OR profileData.temperature > 2) THEN
196:         THROW ProviderValidationError({
197:           field: 'temperature',
198:           message: "temperature must be between 0 and 2 for OpenAI"
199:         })
200:       END IF
201:       BREAK
202: 
203:     CASE 'anthropic':
204:       IF profileData.model NOT IN anthropicModels THEN
205:         THROW ProviderValidationError({
206:           field: 'model',
207:           message: "Invalid model '" + profileData.model + "' for provider 'anthropic'"
208:         })
209:       END IF
210:       IF profileData.temperature !== undefined AND 
211:          (profileData.temperature < 0 OR profileData.temperature > 1) THEN
212:         THROW ProviderValidationError({
213:           field: 'temperature',
214:           message: "temperature must be between 0 and 1 for Anthropic"
215:         })
216:       END IF
217:       BREAK
218: 
219:     // ... other providers ...
220:   END SWITCH
221: END FUNCTION
222: ```

## Key Integration Points

### Lines 012-032: Inline Profile Flow (NEW)
**Purpose**: Handle `--profile` flag with JSON string
**Integration**: Inserts BEFORE existing file-based flow
**Key Functions**:
- `parseInlineProfile()` - NEW helper function (lines 086-149)
- Error handling for JSON syntax and validation
**Actual Implementation**: This logic will be added to `prepareRuntimeForProfile()` in profileBootstrap.ts

### Lines 034-042: File-Based Profile Flow (EXISTING)
**Purpose**: Handle `--profile-load` flag
**Integration**: UNCHANGED - existing logic preserved
**Key Point**: This code path not modified

### Lines 044-047: No Profile Flow (EXISTING)
**Purpose**: Use defaults when no profile specified
**Integration**: UNCHANGED

### Lines 049-071: Configuration Merging (EXISTING)
**Purpose**: Merge profile → defaults → overrides
**Integration**: UNCHANGED - works for both inline and file-based profiles
**Key Point**: Both profile sources converge here

### Lines 086-149: parseInlineProfile() (NEW HELPER FUNCTION)
**Purpose**: Parse and validate inline JSON
**Steps**:
1. JSON.parse() with error handling (lines 091-095)
2. Nesting depth check (lines 098-105)
3. TypeScript interface validation with runtime checks (lines 108-119)
4. Deprecation warnings (lines 122-124)
5. Provider-specific validation (lines 127-136)
6. Return BootstrapRuntimeState (lines 139-148)
**Note**: Returns simplified BootstrapRuntimeState (providerName, modelName, warnings), not full ProfileApplicationResult

### Lines 152-166: getMaxNestingDepth() (NEW HELPER)
**Purpose**: Prevent DoS through deeply nested JSON
**Algorithm**: Recursive depth calculation
**Limit**: 10 levels maximum

### Lines 169-182: formatValidationErrors() (NEW HELPER)
**Purpose**: Format Zod errors for user-friendly display
**Output**: Bullet list of field + message + received value

### Lines 185-221: providerSpecificRules() (NEW HELPER)
**Purpose**: Validate provider-specific constraints
**Examples**:
- OpenAI: temperature 0-2, valid model list
- Anthropic: temperature 0-1, valid model list

## Error Flow

### JSON Syntax Error (Lines 019-024)
```
User Input: --profile '{"provider":"openai","model":"gpt-4"'
            Missing closing brace ─────────────────────────┘
↓
JSON.parse() throws SyntaxError
↓
Catch at line 019
↓
Format error with context (lines 020-024)
↓
"Invalid JSON in --profile flag:
  Unexpected end of JSON input at position 42
Ensure JSON is properly quoted and escaped for your shell."
```

### Validation Error (Lines 025-031)
```
User Input: --profile '{"provider":"openai","temperature":"hot"}'
                                               Wrong type ─┘
↓
JSON.parse() succeeds
↓
Zod validation fails (line 111)
↓
Catch at line 025
↓
Format errors (line 028)
↓
"Profile validation failed:
  - temperature: Expected number, received string
    (received: "hot")

Example valid profile:
  --profile '{\"provider\":\"openai\",\"model\":\"gpt-4\",\"temperature\":0.7}'"
```

### Provider Validation Error (Lines 127-136)
```
User Input: --profile '{"provider":"openai","model":"invalid-model","temperature":0.7}'
                                             Invalid model ─────┘
↓
JSON.parse() + Zod validation succeed
↓
providerSpecificRules() fails (line 188)
↓
Throw ProviderValidationError (lines 189-192)
↓
Caught and re-thrown as ValidationError (lines 130-135)
↓
"Profile validation failed:
  - model: Invalid model 'invalid-model' for provider 'openai'"
```

## Data Type Contracts

### JsonParseError
```typescript
interface JsonParseError extends Error {
  name: 'JsonParseError';
  message: string;  // From JSON.parse() SyntaxError
}
```

### ValidationError
```typescript
interface ValidationError extends Error {
  name: 'ValidationError';
  errors: Array<{
    field: string;       // Dot-separated path, e.g., 'model', 'settings.temperature'
    message: string;     // Human-readable error description
    received?: any;      // Actual value received (for debugging)
  }>;
}
```

### ProfileApplicationResult

**Note**: This pseudocode uses simplified field names. The actual codebase has TWO versions:

1. **Simplified Version** (used in profileBootstrap.ts:47-52):
```typescript
interface ProfileApplicationResult {
  providerName: string;  // NOT 'provider'
  modelName: string;     // NOT 'model'
  baseUrl?: string;
  warnings: string[];
}
```

2. **Full Version** (profileApplication.ts:35-45):
```typescript
interface ProfileApplicationResult {
  providerName: string;
  modelName: string;
  infoMessages: string[];
  warnings: string[];
  providerChanged: boolean;
  authType?: AuthType;
  didFallback: boolean;
  requestedProvider: string | null;
  baseUrl?: string;
}
```

**Implementation Note**: `parseInlineProfile()` should return the simplified version to match the pattern used in `profileBootstrap.ts`.
```

## Testing Considerations

### Unit Tests for parseInlineProfile() (Lines 086-149)

**Test Group 1: JSON Parsing (Lines 091-095)**
- Valid JSON → Success
- Missing closing brace → JsonParseError
- Trailing comma → JsonParseError
- Invalid escape sequence → JsonParseError

**Test Group 2: Nesting Depth (Lines 098-105)**
- 9 levels deep → Success
- 10 levels deep → Success
- 11 levels deep → ValidationError
- Array nesting counts toward depth

**Test Group 3: TypeScript Validation (Lines 108-119)**
- Missing `provider` → ValidationError
- Missing `model` → ValidationError
- Invalid type for `temperature` → ValidationError
- Unsupported provider → ValidationError

**Test Group 4: Provider Validation (Lines 127-136)**
- OpenAI with invalid model → ValidationError (if implemented)
- Anthropic with temperature > 1 → ValidationError
- Google with unsupported parameter → ValidationError (if implemented)

**Test Group 5: Warnings (Lines 122-124)**
- Deprecated field → Success with warning (if implemented)
- Multiple deprecated fields → Success with multiple warnings

### Integration Tests for prepareRuntimeForProfile()

**Test Group 1: Profile Source Selection (Lines 012-047)**
- `profileJson` set → Uses inline flow (lines 012-032)
- `profileName` set → Uses file flow (lines 034-042)
- Neither set → Uses defaults (lines 044-047)
- Both set → Should not happen (caught by parseBootstrapArgs)

**Test Group 2: Override Precedence (Lines 061-070)**
- Profile sets temperature 0.5, override sets 0.9 → Result 0.9
- Profile sets model gpt-3.5, override sets gpt-4 → Result gpt-4
- Profile sets key, no override → Result uses profile key

**Test Group 3: End-to-End (Lines 001-083)**
- Valid profile JSON → Runtime initialized successfully
- Invalid profile JSON → Error before provider initialization
- Profile + overrides → Overrides take precedence

## Performance Considerations

- **Lines 091-095**: JSON.parse() is O(n) where n = string length. Max 10KB = <5ms.
- **Lines 098-105**: Nesting depth check is O(n) where n = object nodes. Max 10KB = <5ms.
- **Lines 108-119**: Zod validation is O(fields). Typical profile ~10 fields = <5ms.
- **Lines 127-136**: Provider validation is O(rules). Typical ~3 rules = <1ms.
- **Total overhead**: <20ms worst case (within performance budget)

## Security Considerations

### Line 092: JSON.parse() Safety
- **Safe**: Does not use `eval()`, no code execution risk
- **Input validation**: Size limit enforced in parseBootstrapArgs() (10KB max)

### Lines 098-105: DoS Protection
- **Nesting depth limit**: Prevents stack overflow from deeply nested JSON
- **Limit**: 10 levels is reasonable for configuration (typical: 2-3 levels)

### Lines 020-024: Error Message Safety
- **No secret leakage**: Error messages do NOT include full JSON string
- **Context only**: Shows position and surrounding characters, not entire content

### Line 147: No Logging of Secrets
- **Safe**: profileObject never logged directly
- **Warnings logged**: Only non-sensitive validation warnings
- **API keys**: Never included in log output

## Notes

- **Existing logic preserved**: Lines 034-083 unchanged, ensuring no regressions
- **Convergence point**: Line 049 - both inline and file-based profiles merge identically
- **Error handling**: Comprehensive, user-friendly error messages with examples
- **Performance**: <20ms overhead, within budget
- **Security**: No secret leakage, DoS protection, safe parsing
