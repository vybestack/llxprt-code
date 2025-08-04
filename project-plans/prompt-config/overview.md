# Prompt Configuration System Overview

## Purpose

Replace the current hardcoded TypeScript prompt system with a flexible, file-based configuration that allows users to customize prompts for different providers, models, and use cases while reducing token usage for smaller models.

## Architecture

### Directory Structure

```
~/.llxprt/prompts/
├── core.md                                    # Base default prompt
├── env/                                       # Environment-specific prompts
│   ├── git-repository.md                     # Loaded when in git repo
│   ├── sandbox.md                            # Loaded when sandboxed
│   └── ide-mode.md                           # Loaded when IDE connected
├── tools/                                     # Tool-specific prompts
│   ├── read-file.md                          # Instructions for read tool
│   ├── shell.md                              # Instructions for shell tool
│   ├── todo-write.md                         # Instructions for todo tool
│   └── ...                                   # One file per tool
└── providers/                                 # Provider/model overrides
    ├── anthropic/
    │   ├── core.md                           # Overrides base core.md
    │   ├── env/                              # Anthropic-specific env overrides
    │   ├── tools/                            # Anthropic-specific tool overrides
    │   └── models/
    │       ├── claude-3-opus/
    │       └── claude-3-haiku/
    ├── gemini/
    │   ├── core.md
    │   └── models/
    │       ├── gemini-2.5-pro/
    │       └── gemini-2.5-flash/
    └── ollama/
        ├── core.md                           # Simplified for local models
        └── models/
            ├── llama-3-70b/
            └── llama-3-8b/
```

### File Resolution Order

For any prompt file, the system searches in order and uses the **first file found**:

1. `providers/{provider}/models/{model}/{path}`
2. `providers/{provider}/{path}`  
3. `{path}` (base default)

**Example**: When using `ollama/llama-3-8b` and loading `env/git-repository.md`:
1. Check `providers/ollama/models/llama-3-8b/env/git-repository.md`
2. Check `providers/ollama/env/git-repository.md`
3. Use `env/git-repository.md`

### Prompt Assembly

The final prompt is assembled by concatenating files in this order:

```
[core.md]
+ [env/git-repository.md]    (if in git repo)
+ [env/sandbox.md]           (if sandboxed)
+ [env/ide-mode.md]          (if IDE connected)
+ [tools/{tool}.md]          (for each enabled tool)
+ [user memory]              (LLXPRT.md content)
```

### Variable Substitution

A minimal template system supports:

- `{{TOOL_NAME}}` - Replaced with actual tool name
- `{{MODEL}}` - Current model name
- `{{PROVIDER}}` - Current provider name

Example in `tools/read-file.md`:
```markdown
When asked to read file contents, use the '{{TOOL_NAME}}' tool.
```

### Installation & Initialization

On startup, the system:

1. Checks if `~/.llxprt/prompts/` exists
2. For each expected default file (including provider/model-specific defaults), checks if it exists
3. Creates missing default files with built-in content
4. Does NOT overwrite existing files (preserves customizations)
5. If a file exists but is empty or customized, leaves it alone

**Adaptive Installation**: The system knows about certain provider/model combinations that need specific defaults:
- `providers/gemini/models/gemini-2.5-flash/core.md` - Includes explicit tool usage instructions
- Future provider/model specific defaults can be added to the installer

If `~/.llxprt/` cannot be read/written, the system fails with a clear error message.

### Tool Integration

- Only loads prompts for **enabled tools** (based on `coreTools`/`excludeTools` settings)
- Tool prompt files are named after the tool class: `ReadFileTool` → `read-file.md`
- If a tool is disabled, its prompt file is not loaded

### Environment Detection

Environment files are conditionally included based on runtime context:

- `git-repository.md` - Loaded when `isGitRepository()` returns true
- `sandbox.md` - Loaded when `SANDBOX` environment variable is set
- `ide-mode.md` - Loaded when IDE companion is connected

### Model-Specific Behavior

Certain models require specific instructions. For example, Gemini Flash models need explicit reminders to use tools rather than describe actions. These model-specific instructions are handled through the default installation:

- **Gemini Flash**: The installer creates `providers/gemini/models/gemini-2.5-flash/core.md` with tool usage enforcement
- **Other models**: May have their own specific defaults installed

Users can customize by:
- Deleting the file to fall back to provider or base defaults
- Creating an empty file to remove all special instructions
- Modifying the file with their own instructions

### Caching

- All prompt files are loaded and cached in memory on startup
- No dynamic reloading - restart required for changes
- Cache includes resolved templates (variables substituted)

### Error Handling

- **Missing default file**: Recreate from built-in defaults
- **Missing override file**: Not an error, use next in hierarchy
- **Permission denied**: Fail with clear error about installation
- **Malformed content**: Load as-is (no validation on content)

## Benefits

1. **Customization**: Users can override any aspect of prompts
2. **Provider Optimization**: Different prompts for different providers/models
3. **Token Efficiency**: Smaller prompts for limited context models
4. **Modularity**: Load only what's needed (tools, environment)
5. **Maintainability**: Prompts in markdown files, not compiled TypeScript

## Examples

### Example 1: Minimal Local Model

For a user running `ollama/llama-3-8b` who only uses file operations:

**Settings**:
```json
{
  "coreTools": ["ReadFileTool", "WriteFileTool", "EditTool"]
}
```

**Loaded files**:
- `providers/ollama/models/llama-3-8b/core.md` (simplified instructions)
- `tools/read-file.md`
- `tools/write-file.md`
- `tools/edit.md`

Total: ~2K tokens instead of ~8K

### Example 2: Custom Git Workflow

User wants different git commit instructions for their team:

1. Create `~/.llxprt/prompts/env/git-repository.md`
2. Add team-specific commit message format
3. This overrides the default git instructions

### Example 3: Provider-Specific Tool Behavior  

Anthropic models need different shell command formatting:

1. Create `~/.llxprt/prompts/providers/anthropic/tools/shell.md`
2. Add Anthropic-specific formatting
3. All Anthropic models use this version

## Migration Notes

- Existing prompts extracted to default files shipped with package
- No backwards compatibility mode - old system removed entirely
- Users get default prompts on first run after upgrade
- Customizations preserved by not overwriting existing files