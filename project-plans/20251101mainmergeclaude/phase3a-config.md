# Phase 3a: Config & Settings Resolution

**Status**: ✅ Complete

## Files Resolved

### 1. packages/cli/src/config/config.ts (COMPLEX MERGE)

**Conflict Type**: UU - Both branches modified heavily

**Agentic Features Preserved**:
- ✅ Runtime context initialization (parseBootstrapArgs, prepareRuntimeForProfile)
- ✅ Runtime settings integration with SettingsService
- ✅ Profile bootstrap logic with OAuth manager
- ✅ READ_ONLY_TOOL_NAMES constant for tool governance
- ✅ buildNormalizedToolSet and normalizeToolNameForPolicy helpers
- ✅ Tool governance policy application logic
- ✅ Profile warnings array and comprehensive error handling
- ✅ Runtime exports (getCliRuntimeConfig, getCliRuntimeServices, etc.)
- ✅ runtimeOverrides parameter in loadCliConfig

**Main Features Merged**:
- ✅ --set flag support (line 459-472)
  - Array type with coerce validation
  - Integration with applyCliSetArguments
- ✅ --dumponerror flag (line 293-297)
  - Boolean type, defaults to false
  - Passed to Config as dumpOnError
- ✅ Import of applyCliSetArguments from cliEphemeralSettings.js (line 60)
- ✅ WriteFileTool import (line 31)
- ✅ WriteFileTool.Name in extraExcludes (line 880)
- ✅ Include directories auto-detection logic (lines 805-820)
- ✅ CLI model params handling (_cliModelParams, lines 1267-1274)
- ✅ dumponerror and set fields in CliArgs interface (lines 142, 144)

**Merge Strategy**:
1. Combined both import lists
2. Added dumponerror and set to CliArgs interface
3. Merged .option() definitions in parseArguments
4. Preserved agentic's complex loadCliConfig with:
   - Bootstrap parsing and runtime preparation
   - Profile loading with warnings
   - Runtime context setup
5. Integrated main's improvements:
   - Auto-detection of loadMemoryFromIncludeDirectories
   - dumpOnError config field
   - applyCliSetArguments call
   - _cliModelParams attachment

### 2. packages/cli/src/settings/ephemeralSettings.ts (AA - Both Added)

**Resolution**: Used main's version

**Reason**: Main's version includes dumponerror support (lines 48-49, 206-232)

**Features in Final Version**:
- Complete ephemeralSettingHelp dictionary
- parseEphemeralSettingValue with comprehensive validation
- Support for all ephemeral settings including:
  - context-limit, compression-threshold
  - base-url, tool-format, api-version
  - socket-timeout, socket-keepalive, socket-nodelay
  - tool-output-* settings
  - emojifilter, streaming
  - authOnly
  - **dumponerror** (new from main)

## Validation

### Import Verification
```bash
✅ applyCliSetArguments imported from './cliEphemeralSettings.js'
✅ WriteFileTool imported from '@vybestack/llxprt-code-core'
✅ Runtime imports present (parseBootstrapArgs, prepareRuntimeForProfile, etc.)
```

### Feature Verification
```bash
✅ dumponerror field in CliArgs (line 142)
✅ set field in CliArgs (line 144)
✅ --dumponerror option defined (line 293-297)
✅ --set option defined with coerce logic (line 459-472)
✅ dumpOnError passed to Config (line 1031)
✅ applyCliSetArguments called (line 1267)
✅ _cliModelParams attached (lines 1269-1274)
✅ READ_ONLY_TOOL_NAMES constant (lines 66-79)
✅ Tool governance policy functions (lines 1178-1222)
✅ Runtime bootstrap logic (lines 617-628)
✅ Profile snapshot application (lines 1096-1135)
```

### Build Test
```bash
cd packages/cli && npm run build
```

**Result**: Config.ts and ephemeralSettings.ts have no compilation errors.
Other errors in build are from unresolved files in other phases (AnthropicProvider, gemini.tsx, setCommand, ToolGroupMessage, zedIntegration).

## Dependencies Added
These files were already present from the --set feature (PR #349):
- ✅ packages/cli/src/config/cliEphemeralSettings.ts
- ✅ packages/cli/src/settings/modelParamParser.ts

## Key Merge Decisions

### 1. Profile Error Handling
**Decision**: Used agentic's approach (warnings instead of throwing)
**Reason**: More robust - allows CLI to continue with default settings if profile is invalid

### 2. SettingsService Access
**Decision**: Kept agentic's runtimeState.runtime.settingsService
**Reason**: Aligns with runtime context architecture, more flexible than main's getSettingsService()

### 3. Include Directories Logic
**Decision**: Used main's auto-detection logic
**Reason**: Better UX - automatically enables memory loading when directories are provided

### 4. Tool Governance
**Decision**: Preserved full agentic implementation
**Reason**: Comprehensive READ_ONLY_TOOL_NAMES and policy enforcement critical for non-interactive mode

## Testing Recommendations

1. **--set flag**:
   ```bash
   node packages/cli/dist/index.js --set context-limit=100000
   node packages/cli/dist/index.js --set modelparam.temperature=0.7
   ```

2. **--dumponerror flag**:
   ```bash
   node packages/cli/dist/index.js --dumponerror
   ```

3. **Profile loading with runtime**:
   ```bash
   node packages/cli/dist/index.js --profile-load test-profile
   ```

4. **Tool governance in non-interactive**:
   ```bash
   echo "test" | node packages/cli/dist/index.js --prompt "analyze"
   ```

## Next Steps
Proceed to Phase 3b (other config/settings files) after resolving errors in:
- packages/core/src/providers/anthropic/AnthropicProvider.ts
- packages/cli/src/gemini.tsx
- packages/cli/src/ui/commands/setCommand.ts
- packages/cli/src/ui/components/messages/ToolGroupMessage.test.tsx
- packages/cli/src/zed-integration/zedIntegration.ts
