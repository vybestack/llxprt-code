# Implementation Plan: c4bd7594 - Document Settings with showInDialog

## Summary of Upstream Changes

Upstream commit `c4bd7594` ("document all settings with showInDialog: true (#11049)"):
- Audited settingsSchema.ts for all settings with `showInDialog: true`
- Documented 19 settings in `docs/get-started/configuration.md`
- Added a comment reminder in settingsSchema.ts to document new settings
- **Note:** Upstream documented settings that don't exist in LLxprt (see below)

## LLxprt Settings Structure

### Namespace Conventions
LLxprt uses a mix of top-level and nested settings:

**Top-level settings:**
- `accessibility.*` (NOT `ui.accessibility.*`)
- `fileFiltering.*` (NOT `context.fileFiltering.*`)
- `emojifilter` (top-level)
- `shouldUseNodePtyShell` (top-level)
- `disableAutoUpdate` (top-level)
- `coreToolSettings` (top-level, NOT `coreTools`)
- Legacy duplicates: `showStatusInTitle`, `hideCWD`, `hideSandboxStatus`, `hideModelInfo`, `useRipgrep`, `wittyPhraseStyle`

**Nested settings:**
- `ui.*` (theme, hideWindowTitle, hideTips, hideBanner, showLineNumbers, etc.)
- `ui.footer.*` (hideCWD, hideSandboxStatus, hideModelInfo)
- `tools.*` (autoAccept, useRipgrep, enableToolOutputTruncation, etc.)
- `output.*` (format)
- `security.folderTrust.*`

**Key differences from upstream:**
- Upstream uses `coreToolSettings`, LLxprt schema also uses `coreToolSettings` (line 296)
- Some settings exist in both top-level AND nested forms for backward compatibility

## Baseline Assessment

### Current State
- **Total settings with `showInDialog: true` in LLxprt:** 48 settings
- **Already documented in `docs/cli/configuration.md`:** 20 settings
- **Undocumented:** 28 settings

### Already Documented Settings (20)
1. `accessibility.disableLoadingPhrases` - Disable Loading Phrases (top-level)
2. `accessibility.screenReader` - Screen Reader Mode (top-level)
3. `emojifilter` - Emoji Filter (top-level)
4. `fileFiltering.disableFuzzySearch` - Disable Fuzzy Search (top-level)
5. `fileFiltering.enableRecursiveFileSearch` - Enable Recursive File Search (top-level)
6. `fileFiltering.respectGitIgnore` - Respect .gitignore (top-level)
7. `folderTrust` - Folder Trust (legacy, documented)
8. `loadMemoryFromIncludeDirectories` - Load Memory From Include Directories (top-level)
9. `security.folderTrust.enabled` - Folder Trust (nested)
10. `shouldUseNodePtyShell` - Enable Interactive Shell (node-pty) (top-level)
11. `showLineNumbers` - Show Line Numbers (top-level legacy)
12. `tools.autoAccept` - Auto Accept (nested under tools)
13. `ui.hideBanner` - Hide Banner (nested under ui)
14. `ui.hideFooter` - Hide Footer (nested under ui)
15. `ui.hideTips` - Hide Tips (nested under ui)
16. `ui.hideWindowTitle` - Hide Window Title (nested under ui)
17. `ui.showCitations` - Show Citations (nested under ui)
18. `ui.showLineNumbers` - Show Line Numbers (nested under ui)
19. `ui.showMemoryUsage` - Show Memory Usage (nested under ui)
20. `ui.vimMode` - Vim Mode (nested under ui)

## Upstream Settings That Don't Exist in LLxprt

The following settings were documented in upstream but **do not exist** in LLxprt Code:
1. `ui.useFullWidth` - Not present in LLxprt
2. `tools.shell.showColor` - Not present in LLxprt
3. `tools.enableMessageBusIntegration` - Not present in LLxprt
4. `experimental.useModelRouter` - Not present in LLxprt
5. `general.sessionRetention.enabled` - Present in schema but `showInDialog` is not set to `true`

**Action:** Skip these settings - they are upstream-specific features.

## Undocumented Settings Requiring Documentation (28)

### Category: Core Tools (1 setting)
1. **`coreToolSettings`**
   - Type: object
   - Default: {}
   - Schema location: Line 296-305
   - Description: Manage core tool availability (dynamically populated based on loaded tools)

### Category: Debug & Development (1 setting)
2. **`debugKeystrokeLogging`**
   - Type: boolean
   - Default: false
   - Schema location: Line 1353-1361
   - Description: Enable debug logging of keystrokes to the console

### Category: Updates (1 setting)
3. **`disableAutoUpdate`**
   - Type: boolean
   - Default: false
   - Schema location: Line 219-227
   - Description: Disable automatic updates

### Category: Input Features (2 settings)
4. **`enableFuzzyFiltering`**
   - Type: boolean
   - Default: true
   - Schema location: Line 1343-1352
   - Description: Enable fuzzy filtering for command menu completions

5. **`enablePromptCompletion`**
   - Type: boolean
   - Default: false
   - Schema location: Line 1333-1342
   - Description: Enable AI-powered prompt completion suggestions while typing

### Category: File Filtering (1 setting)
6. **`fileFiltering.respectLlxprtIgnore`** (top-level)
   - Type: boolean
   - Default: true
   - Schema location: Line 189-197
   - Description: Respect .llxprtignore files when searching
   - **Note:** This is a property of the top-level `fileFiltering` object

### Category: Security (1 setting)
7. **`folderTrustFeature`**
   - Type: boolean
   - Default: false
   - Schema location: Line 1071-1079
   - Description: Enable folder trust feature for enhanced security

### Category: Output (1 setting)
8. **`output.format`**
   - Type: enum (text | json)
   - Default: 'text'
   - Schema location: Line 374-388
   - Description: The format of the CLI output

### Category: Tools (6 settings)
9. **`toolCallProcessingMode`**
   - Type: enum (legacy | pipeline)
   - Default: 'legacy'
   - Schema location: Line 324-337
   - Description: Mode for processing tool calls. Pipeline mode is optimized, legacy mode uses older implementation.

10. **`tools.enableToolOutputTruncation`**
    - Type: boolean
    - Default: true
    - Schema location: Line 867-875
    - Description: Enable truncation of large tool outputs

11. **`tools.truncateToolOutputThreshold`**
    - Type: number
    - Default: 30000
    - Schema location: Line 876-885
    - Description: Truncate tool output if it is larger than this many characters. Set to -1 to disable.

12. **`tools.truncateToolOutputLines`**
    - Type: number
    - Default: 1000
    - Schema location: Line 886-894
    - Description: The number of lines to keep when truncating tool output

13. **`tools.useRipgrep`**
    - Type: boolean
    - Default: false
    - Schema location: Line 857-866
    - Description: Use ripgrep for file content search instead of the fallback implementation. Provides faster search performance.

14. **`useRipgrep`** (top-level legacy)
    - Type: boolean
    - Default: false
    - Schema location: Line 1323-1332
    - Description: Use ripgrep for file content search (top-level setting, legacy)

### Category: UI (11 settings)
15. **`ui.autoConfigureMaxOldSpaceSize`**
    - Type: boolean
    - Default: true
    - Schema location: Line 593-602
    - Description: Automatically configure Node.js max old space size based on system memory

16. **`ui.footer.hideCWD`**
    - Type: boolean
    - Default: false
    - Schema location: Line 474-483
    - Description: Hide the current working directory path in the footer

17. **`ui.footer.hideSandboxStatus`**
    - Type: boolean
    - Default: false
    - Schema location: Line 484-492
    - Description: Hide the sandbox status indicator in the footer

18. **`ui.footer.hideModelInfo`**
    - Type: boolean
    - Default: false
    - Schema location: Line 493-501
    - Description: Hide the model name and context usage in the footer

19. **`ui.hideContextSummary`**
    - Type: boolean
    - Default: false
    - Schema location: Line 455-464
    - Description: Hide the context summary (LLXPRT.md, MCP servers) above the input

20. **`ui.ideMode`**
    - Type: boolean
    - Default: false
    - Schema location: Line 575-583
    - Description: Enable IDE integration mode

21. **`ui.showStatusInTitle`**
    - Type: boolean
    - Default: false
    - Schema location: Line 427-436
    - Description: Show Gemini CLI status and thoughts in the terminal window title

22. **`ui.showTodoPanel`**
    - Type: boolean
    - Default: true
    - Schema location: Line 666-674
    - Description: Show the todo panel in the UI

23. **`ui.wittyPhraseStyle`**
    - Type: enum (default | llxprt | gemini-cli | whimsical | custom)
    - Default: 'default'
    - Schema location: Line 549-565
    - Description: Choose which collection of witty phrases to display during loading

24. **`wittyPhraseStyle`** (top-level legacy)
    - Type: enum (default | llxprt | gemini-cli | whimsical | custom)
    - Default: 'default'
    - Schema location: Line 1371-1387
    - Description: Choose which collection of witty phrases to display during loading (top-level setting)

### Category: Top-Level UI Settings (3 legacy settings)
25. **`showStatusInTitle`**
    - Type: boolean
    - Default: false
    - Schema location: Line 689-697
    - Description: Show LLxprt status and thoughts in the terminal window title

26. **`hideCWD`**
    - Type: boolean
    - Default: false
    - Schema location: Line 699-707
    - Description: Hide the current working directory path in the footer

27. **`hideSandboxStatus`**
    - Type: boolean
    - Default: false
    - Schema location: Line 708-716
    - Description: Hide the sandbox status indicator in the footer

28. **`hideModelInfo`**
    - Type: boolean
    - Default: false
    - Schema location: Line 717-725
    - Description: Hide the model name and context usage in the footer

## Implementation Steps

### Step 0: Fix Existing Documentation Inconsistency
**File:** `docs/cli/configuration.md`

**Issue:** Line 197 incorrectly documents `ui.accessibility.disableLoadingPhrases` when it should be top-level `accessibility.disableLoadingPhrases`.

Remove the incorrect nested documentation at line ~197-199:
```markdown
- **`ui.accessibility.disableLoadingPhrases`** (boolean):
  - **Description:** Disable loading phrases for accessibility.
  - **Default:** `false`
```

The correct documentation already exists at line ~577-589 as top-level `accessibility` object.

### Step 1: Document Core Tools Settings
**File:** `docs/cli/configuration.md`

Add a new section for Core Tools configuration:

```markdown
#### Core Tools Configuration

- **`coreToolSettings`** (object):
  - **Description:** Manage core tool availability. This object is dynamically populated based on loaded tools and allows you to enable/disable individual core tools.
  - **Default:** `{}`
  - **Example:**
    ```json
    "coreToolSettings": {
      "Bash": true,
      "Read": true,
      "Write": false
    }
    ```
```

### Step 2: Document Update Settings
**File:** `docs/cli/configuration.md`

Add to or create an Updates section:

```markdown
#### Updates

- **`disableAutoUpdate`** (boolean):
  - **Description:** Disable automatic updates of LLxprt Code. When enabled, you will need to manually update the application.
  - **Default:** `false`
  - **Example:**
    ```json
    "disableAutoUpdate": true
    ```
```

### Step 3: Document Input & Filtering Features
**File:** `docs/cli/configuration.md`

Add to the appropriate sections:

```markdown
#### Prompt and Input Features

- **`enablePromptCompletion`** (boolean):
  - **Description:** Enable AI-powered prompt completion suggestions while typing. Provides intelligent autocomplete based on context and command history.
  - **Default:** `false`
  - **Example:**
    ```json
    "enablePromptCompletion": true
    ```

- **`enableFuzzyFiltering`** (boolean):
  - **Description:** Enable fuzzy filtering for command menu completions. When enabled, you can type partial characters (e.g., "prd" to match "production"). When disabled, only exact prefix matches are shown.
  - **Default:** `true`
  - **Example:**
    ```json
    "enableFuzzyFiltering": false
    ```
```

### Step 4: Update File Filtering Documentation
**File:** `docs/cli/configuration.md`

Update the existing `fileFiltering` section (currently at line ~66) to add the missing `respectLlxprtIgnore` property:

```markdown
- **`fileFiltering`** (object):
  - **Description:** Controls git-aware file filtering behavior for @ commands and file discovery tools.
  - **Default:** `{"respectGitIgnore": true, "respectLlxprtIgnore": true, "enableRecursiveFileSearch": true, "disableFuzzySearch": false}`
  - **Properties:**
    - **`respectGitIgnore`** (boolean): Whether to respect .gitignore patterns when discovering files. When set to `true`, git-ignored files (like `node_modules/`, `dist/`, `.env`) are automatically excluded from @ commands and file listing operations.
    - **`respectLlxprtIgnore`** (boolean): Whether to respect .llxprtignore patterns when discovering files. Works similar to `respectGitIgnore` but for `.llxprtignore` files.
    - **`enableRecursiveFileSearch`** (boolean): Whether to enable searching recursively for filenames under the current tree when completing @ prefixes in the prompt.
    - **`disableFuzzySearch`** (boolean): When `true`, disables the fuzzy search capabilities when searching for files, which can improve performance on projects with a large number of files.
```

**Note:** This is a top-level `fileFiltering` object, NOT `context.fileFiltering`.

### Step 5: Document Security Settings
**File:** `docs/cli/configuration.md`

Update or add to the Folder Trust section:

```markdown
#### Folder Trust

- **`folderTrustFeature`** (boolean):
  - **Description:** Enable folder trust feature for enhanced security. When enabled, you must explicitly trust folders before LLxprt can execute operations in them.
  - **Default:** `false`
  - **Example:**
    ```json
    "folderTrustFeature": true
    ```
```

### Step 6: Document Output Format Settings
**File:** `docs/cli/configuration.md`

Add output format documentation:

```markdown
#### Output Format

- **`output.format`** (enum):
  - **Description:** The format of the CLI output. `text` provides formatted terminal output, while `json` outputs structured JSON for programmatic consumption.
  - **Default:** `"text"`
  - **Options:** `"text"`, `"json"`
  - **Example:**
    ```json
    "output": {
      "format": "json"
    }
    ```
```

### Step 7: Document Tool Settings
**File:** `docs/cli/configuration.md`

Add comprehensive tool settings documentation:

```markdown
#### Tool Configuration

- **`toolCallProcessingMode`** (enum):
  - **Description:** Mode for processing tool calls. `pipeline` mode uses an optimized implementation, while `legacy` mode uses the older sequential implementation.
  - **Default:** `"legacy"`
  - **Options:** `"legacy"`, `"pipeline"`
  - **Example:**
    ```json
    "toolCallProcessingMode": "pipeline"
    ```

- **`tools.useRipgrep`** (boolean):
  - **Description:** Use ripgrep for file content search instead of the fallback implementation. Provides significantly faster search performance on large codebases.
  - **Default:** `false`
  - **Example:**
    ```json
    "tools": {
      "useRipgrep": true
    }
    ```

- **`tools.enableToolOutputTruncation`** (boolean):
  - **Description:** Enable truncation of large tool outputs to prevent overwhelming the context window.
  - **Default:** `true`
  - **Example:**
    ```json
    "tools": {
      "enableToolOutputTruncation": true
    }
    ```

- **`tools.truncateToolOutputThreshold`** (number):
  - **Description:** Truncate tool output if it exceeds this many characters. Set to `-1` to disable truncation.
  - **Default:** `30000`
  - **Example:**
    ```json
    "tools": {
      "truncateToolOutputThreshold": 50000
    }
    ```

- **`tools.truncateToolOutputLines`** (number):
  - **Description:** The number of lines to keep when truncating tool output. The output will include the first N/2 lines and the last N/2 lines.
  - **Default:** `1000`
  - **Example:**
    ```json
    "tools": {
      "truncateToolOutputLines": 500
    }
    ```
```

### Step 8: Document UI Settings
**File:** `docs/cli/configuration.md`

Enhance the existing UI section with missing settings:

```markdown
- **`ui.showStatusInTitle`** (boolean):
  - **Description:** Show LLxprt status and AI thoughts in the terminal window title. Useful for monitoring progress when the terminal is in the background.
  - **Default:** `false`
  - **Example:**
    ```json
    "ui": {
      "showStatusInTitle": true
    }
    ```

- **`ui.hideContextSummary`** (boolean):
  - **Description:** Hide the context summary (LLXPRT.md files, MCP servers) displayed above the input prompt.
  - **Default:** `false`
  - **Example:**
    ```json
    "ui": {
      "hideContextSummary": true
    }
    ```

- **`ui.footer.hideCWD`** (boolean):
  - **Description:** Hide the current working directory path in the footer.
  - **Default:** `false`
  - **Example:**
    ```json
    "ui": {
      "footer": {
        "hideCWD": true
      }
    }
    ```

- **`ui.footer.hideSandboxStatus`** (boolean):
  - **Description:** Hide the sandbox status indicator in the footer.
  - **Default:** `false`
  - **Example:**
    ```json
    "ui": {
      "footer": {
        "hideSandboxStatus": true
      }
    }
    ```

- **`ui.footer.hideModelInfo`** (boolean):
  - **Description:** Hide the model name and context usage information in the footer.
  - **Default:** `false`
  - **Example:**
    ```json
    "ui": {
      "footer": {
        "hideModelInfo": true
      }
    }
    ```

- **`ui.wittyPhraseStyle`** (enum):
  - **Description:** Choose which collection of witty phrases to display during loading operations.
  - **Default:** `"default"`
  - **Options:** `"default"`, `"llxprt"`, `"gemini-cli"`, `"whimsical"`, `"custom"`
  - **Example:**
    ```json
    "ui": {
      "wittyPhraseStyle": "whimsical"
    }
    ```

- **`ui.ideMode`** (boolean):
  - **Description:** Enable IDE integration mode for enhanced editor integration.
  - **Default:** `false`
  - **Example:**
    ```json
    "ui": {
      "ideMode": true
    }
    ```

- **`ui.autoConfigureMaxOldSpaceSize`** (boolean):
  - **Description:** Automatically configure Node.js max old space size based on system memory. Helps prevent out-of-memory errors on large projects.
  - **Default:** `true`
  - **Example:**
    ```json
    "ui": {
      "autoConfigureMaxOldSpaceSize": false
    }
    ```

- **`ui.showTodoPanel`** (boolean):
  - **Description:** Show the todo panel in the UI for tracking AI-generated task lists.
  - **Default:** `true`
  - **Example:**
    ```json
    "ui": {
      "showTodoPanel": false
    }
    ```
```

### Step 9: Document Top-Level Legacy Settings
**File:** `docs/cli/configuration.md`

Add note about legacy flat-structure settings:

```markdown
#### Legacy Top-Level Settings

For backward compatibility, the following settings exist at the top level in addition to their nested locations:

- **`showStatusInTitle`** (boolean): Same as `ui.showStatusInTitle`
- **`hideCWD`** (boolean): Same as `ui.footer.hideCWD`
- **`hideSandboxStatus`** (boolean): Same as `ui.footer.hideSandboxStatus`
- **`hideModelInfo`** (boolean): Same as `ui.footer.hideModelInfo`
- **`useRipgrep`** (boolean): Same as `tools.useRipgrep`
- **`wittyPhraseStyle`** (enum): Same as `ui.wittyPhraseStyle`

**Note:** It's recommended to use the nested versions for clarity and consistency.
```

### Step 10: Document Debug Settings
**File:** `docs/cli/configuration.md`

Add documentation for debug features:

```markdown
#### Debug Settings

- **`debugKeystrokeLogging`** (boolean):
  - **Description:** Enable debug logging of keystrokes to the console. Useful for troubleshooting input issues or developing custom keybindings.
  - **Default:** `false`
  - **Warning:** This will log all keystrokes including potentially sensitive input. Only enable for debugging purposes.
  - **Example:**
    ```json
    "debugKeystrokeLogging": true
    ```
```

### Step 11: Add Comment to settingsSchema.ts
**File:** `packages/cli/src/config/settingsSchema.ts`

Update the comment at the top of the SETTINGS_SCHEMA definition (around line 105) to add a documentation reminder:

```typescript
/**
 * The canonical schema for all settings.
 * The structure of this object defines the structure of the `Settings` type.
 * `as const` is crucial for TypeScript to infer the most specific types possible.
 *
 * IMPORTANT: When adding a new setting with `showInDialog: true`, ensure it is
 * also documented in docs/cli/configuration.md with a complete description,
 * type, default value, and example.
 */
```

## Verification Method

### Manual Verification
1. Open `/settings` dialog in running LLxprt instance
2. For each setting visible in the dialog:
   - Note the setting name and category
   - Check that it exists in `docs/cli/configuration.md`
   - Verify the documented description matches the schema
   - Verify the documented default matches the schema
3. Cross-reference with `settingsSchema.ts` to ensure all `showInDialog: true` settings are documented

### Automated Verification
Create a test script to validate documentation coverage:

```bash
#!/bin/bash
# Extract settings with showInDialog: true from schema
grep -B10 "showInDialog: true" packages/cli/src/config/settingsSchema.ts | \
  grep -E "^\s+[a-zA-Z]+:" | \
  sed 's/:.*$//' | sed 's/^\s*//' | sort -u > /tmp/dialog_settings.txt

# Check each setting exists in documentation
while read setting; do
  if ! grep -qi "$setting" docs/cli/configuration.md; then
    echo "MISSING: $setting"
  fi
done < /tmp/dialog_settings.txt
```

## Files to Modify

| File | Change | Lines (est.) |
|------|--------|-------------|
| `docs/cli/configuration.md` | Fix `ui.accessibility.*` inconsistency (remove incorrect nested reference) | -3 |
| `docs/cli/configuration.md` | Add documentation for 28 undocumented settings | +400 |
| `packages/cli/src/config/settingsSchema.ts` | Update documentation reminder comment | +3 |

## Acceptance Criteria

- [x] Audit complete: All 48 `showInDialog: true` settings identified
- [x] Accurate count: 20 already documented, 28 undocumented
- [x] Namespace conventions clarified in plan (top-level vs nested)
- [ ] Fix inconsistency: Remove incorrect `ui.accessibility.*` reference from docs
- [ ] All 28 undocumented settings have complete documentation in `docs/cli/configuration.md`
- [ ] Documentation uses correct namespace prefixes (top-level `accessibility.*`, `fileFiltering.*`)
- [ ] Documentation includes: description, type, default value, and example for each setting
- [ ] Documentation organized by category matching the schema
- [ ] Note added about upstream-specific settings that don't exist in LLxprt
- [ ] Comment updated in settingsSchema.ts reminding developers to document new settings
- [ ] Legacy/duplicate settings noted in documentation
- [ ] Verification script confirms all settings documented
- [ ] Documentation follows existing format and style
- [ ] No references to `context.fileFiltering.*` (should be top-level `fileFiltering.*`)

## Notes

- This is a **REIMPLEMENT** task because upstream paths differ (upstream: `docs/get-started/configuration.md`, LLxprt: `docs/cli/configuration.md`)
- **CRITICAL:** LLxprt uses different namespace structure than upstream:
  - `accessibility.*` is TOP-LEVEL (not `ui.accessibility.*`)
  - `fileFiltering.*` is TOP-LEVEL (not `context.fileFiltering.*`)
  - `coreToolSettings` exists at TOP-LEVEL (schema line 296-305)
  - Some settings exist in both nested and top-level locations (legacy compatibility)
- Fixed existing documentation bug: Line 197 incorrectly showed `ui.accessibility.disableLoadingPhrases`
- 5 upstream settings don't exist in LLxprt - skip these
- Current documentation already covers 20/48 settings
- Focus on settings that users can actually configure via `/settings` dialog
- Maintain consistency with existing documentation style
- Line number references are accurate as of current schema version (lines verified)
- **Important:** Always verify setting paths against `packages/cli/src/config/settingsSchema.ts` before documenting
