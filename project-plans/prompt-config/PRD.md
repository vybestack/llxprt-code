# Prompt Configuration System - Product Requirements Document

## 1. System Architecture Requirements

1.1. The system SHALL use a hierarchical file-based structure rooted at `~/.llxprt/prompts/`

1.2. The directory structure SHALL support:
- Base level defaults (`core.md`, `env/`, `tools/`)
- Provider-specific overrides (`providers/{provider}/`)
- Model-specific overrides (`providers/{provider}/models/{model}/`)

1.3. File resolution SHALL follow a most-specific-first order:
- `providers/{provider}/models/{model}/{path}`
- `providers/{provider}/{path}`
- `{path}`

1.4. The system SHALL use the first file found and SHALL NOT accumulate multiple files

## 2. Prompt Assembly Requirements

2.1. The system SHALL assemble prompts by concatenating files in this order:
- Core prompt file
- Environment-specific files (if conditions met)
- Tool-specific files (for enabled tools only)
- User memory content

2.2. Environment files SHALL be conditionally included based on:
- `env/git-repository.md` - when `isGitRepository()` returns true
- `env/sandbox.md` - when `SANDBOX` environment variable is set
- `env/ide-mode.md` - when IDE companion is connected

2.3. Tool files SHALL only be included for tools that are enabled in the configuration

## 3. Template Variable Requirements

3.1. The system SHALL support basic variable substitution with the syntax `{{VARIABLE_NAME}}`

3.2. The system SHALL support at minimum these variables:
- `{{TOOL_NAME}}` - The name of the current tool
- `{{MODEL}}` - The current model name
- `{{PROVIDER}}` - The current provider name

3.3. Variable substitution SHALL be performed during file loading, not at runtime

## 4. Installation Requirements

4.1. On startup, the system SHALL check for the existence of expected prompt files

4.2. The system SHALL create missing default files with built-in content

4.3. The system SHALL NOT overwrite existing files

4.4. The system SHALL respect empty files as intentional (no content desired)

4.5. The system SHALL install provider/model-specific defaults when defined in the installer

4.6. If `~/.llxprt/` cannot be accessed, the system SHALL fail with a clear error message

## 5. Tool Integration Requirements

5.1. The system SHALL load tool prompts based on the enabled tools configuration

5.2. Tool prompt files SHALL be named using kebab-case derived from the tool class name
- Example: `ReadFileTool` → `read-file.md`

5.3. The system SHALL respect `coreTools` and `excludeTools` settings

5.4. The system SHALL NOT load prompts for disabled tools

## 6. Caching Requirements

6.1. The system SHALL load all prompt files into memory on startup

6.2. The system SHALL cache the processed prompts (with variables substituted)

6.3. The system SHALL NOT support dynamic reloading of prompt files

6.4. Changes to prompt files SHALL require a restart to take effect

## 7. Error Handling Requirements

7.1. Missing default files SHALL be recreated from built-in defaults

7.2. Missing override files SHALL NOT be treated as errors

7.3. File permission errors SHALL result in clear error messages

7.4. The system SHALL NOT validate prompt content

7.5. Malformed template variables SHALL be left as-is in the output

## 8. Migration Requirements

8.1. The system SHALL extract current hardcoded prompts into appropriate default files

8.2. The system SHALL NOT provide backwards compatibility with the old system

8.3. The system SHALL remove all hardcoded prompt logic from TypeScript files

8.4. The default files SHALL be shipped with the package

## 9. Performance Requirements

9.1. Prompt loading SHALL occur once during startup

9.2. The system SHALL NOT perform file I/O during normal operation

9.3. Cache lookup SHALL be O(1) for assembled prompts

## 10. Default Content Requirements

10.1. The system SHALL ship with default content for:
- `core.md` - Base instructions
- `env/git-repository.md` - Git-specific instructions
- `env/sandbox.md` - Sandbox warnings
- `env/ide-mode.md` - IDE context handling
- All built-in tool instruction files

10.2. The system SHALL ship with model-specific defaults including:
- `providers/gemini/models/gemini-2.5-flash/core.md` - Flash tool enforcement

10.3. Default content SHALL be maintained as constants in the codebase

## 11. User Customization Requirements

11.1. Users SHALL be able to override any prompt file

11.2. Users SHALL be able to delete files to fall back to less specific versions

11.3. Users SHALL be able to create empty files to disable specific prompts

11.4. User customizations SHALL be preserved across updates

## 12. Debugging Requirements

12.1. When `DEBUG=1` is set, the system SHALL log:
- Which prompt files were loaded
- The resolution path for each file
- Total token count (if available)
- Any substitution performed

12.2. The system SHALL NOT require special debugging flags beyond the existing `DEBUG` environment variable