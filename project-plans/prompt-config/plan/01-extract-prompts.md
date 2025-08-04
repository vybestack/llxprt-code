# Task 01: Extract Current Prompts to Markdown Files

## Objective

Extract all hardcoded prompts from the current TypeScript implementation into markdown files that will be shipped with the package, following the structure defined in specification.md.

## Context

Current prompts are hardcoded in `/Volumes/XS1000/acoliver/projects/llxprt-main/llxprt-code/packages/core/src/core/prompts.ts`. These need to be extracted into the new file structure at `packages/core/src/prompt-config/defaults/`.

## Requirements to Implement

- **[REQ-009.1]** Current hardcoded prompts SHALL be extracted to default files
- **[REQ-001.2]** Directory structure SHALL support core, env, tools, and providers subdirectories
- **[REQ-008.1]** Tool names SHALL be converted from PascalCase to kebab-case

## File Structure to Create

```
packages/core/src/prompt-config/defaults/
├── core.md                                    # Base system prompt
├── env/
│   ├── git-repository.md                     # Git-specific instructions
│   ├── sandbox.md                            # Sandbox environment warnings
│   └── ide-mode.md                           # IDE companion instructions
├── tools/
│   ├── shell.md                              # Shell command instructions
│   ├── read-file.md                          # File reading instructions
│   ├── edit.md                               # File editing instructions
│   ├── write-file.md                         # File writing instructions
│   ├── grep.md                               # Search instructions
│   ├── glob.md                               # File pattern matching
│   ├── ls.md                                 # Directory listing
│   ├── read-many-files.md                    # Batch file reading
│   ├── web-fetch.md                          # URL fetching
│   ├── web-search.md                         # Web search
│   ├── memory.md                             # Memory tool
│   ├── todo-write.md                         # Todo management write
│   └── todo-read.md                          # Todo management read
└── providers/
    └── gemini/
        └── models/
            └── gemini-2.5-flash/
                └── core.md                    # Flash-specific instructions
```

## Extraction Process

1. **Read** `/Volumes/XS1000/acoliver/projects/llxprt-main/llxprt-code/packages/core/src/core/prompts.ts`

2. **Extract sections**:
   - Main prompt content (before environment checks) → `core.md`
   - Content within `if (process.env.SANDBOX)` block → `env/sandbox.md`
   - Content within `if (await isGitRepository())` block → `env/git-repository.md`
   - IDE-specific content → `env/ide-mode.md`
   - Flash-specific content (model?.includes('flash')) → `providers/gemini/models/gemini-2.5-flash/core.md`
   - Tool-specific instructions from main prompt → individual `tools/*.md` files

3. **Create directory structure** as specified above

4. **Write extracted content** to appropriate files

5. **Preserve exact content** - Do not modify or reformat during extraction

## Tool Name Mapping

Use the mapping from tool-naming-mapping.md:
- `ShellTool` → `shell.md`
- `ReadFileTool` → `read-file.md`
- `EditTool` → `edit.md`
- etc.

## Deliverables

1. Complete directory structure created at `packages/core/src/prompt-config/defaults/`
2. All prompt content extracted to appropriate markdown files
3. Summary report listing:
   - Files created
   - Line counts per file
   - Any content that was ambiguous or difficult to categorize

## Success Criteria

- All directories and files created successfully
- Content extracted preserves original formatting
- Flash-specific content isolated to provider override
- Tool instructions properly separated
- Can manually verify extracted content matches original

## Commands to Run

```bash
# Verify structure
find packages/core/src/prompt-config/defaults -type f -name "*.md" | sort

# Check file creation
ls -la packages/core/src/prompt-config/defaults/
ls -la packages/core/src/prompt-config/defaults/env/
ls -la packages/core/src/prompt-config/defaults/tools/

# Verify content extracted (spot check)
head -20 packages/core/src/prompt-config/defaults/core.md
```