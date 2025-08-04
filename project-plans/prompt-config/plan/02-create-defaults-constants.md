# Task 02: Create Default Content Constants

## Objective

Transform the extracted markdown files into TypeScript constants that the PromptInstaller can use to create missing files at runtime.

## Context

After extracting prompts in task 01, we need to create TypeScript modules that contain these prompts as constants. This satisfies [REQ-009.3] "Default files SHALL be shipped with the package" and enables the installer to create files at `~/.llxprt/prompts/`.

## Requirements to Implement

- **[REQ-005.2]** System SHALL install missing default files from built-in content
- **[REQ-009.3]** Default files SHALL be shipped with the package
- **[REQ-010.3]** Default content SHALL be maintained as constants in the codebase

## Files to Create

```
packages/core/src/prompt-config/defaults/
├── index.ts              # Main export combining all defaults
├── core-defaults.ts      # Core and environment defaults
├── tool-defaults.ts      # Tool-specific defaults
└── provider-defaults.ts  # Provider/model specific defaults
```

## Implementation Details

### 1. Create core-defaults.ts

```typescript
// Read content from markdown files created in task 01
// Store as constants with the file path as key

export const CORE_DEFAULTS: Record<string, string> = {
  'core.md': `[content from defaults/core.md]`,
  'env/git-repository.md': `[content from defaults/env/git-repository.md]`,
  'env/sandbox.md': `[content from defaults/env/sandbox.md]`,
  'env/ide-mode.md': `[content from defaults/env/ide-mode.md]`,
};
```

### 2. Create tool-defaults.ts

```typescript
export const TOOL_DEFAULTS: Record<string, string> = {
  'tools/shell.md': `[content from defaults/tools/shell.md]`,
  'tools/read-file.md': `[content from defaults/tools/read-file.md]`,
  'tools/edit.md': `[content from defaults/tools/edit.md]`,
  // ... all other tools
};
```

### 3. Create provider-defaults.ts

```typescript
export const PROVIDER_DEFAULTS: Record<string, string> = {
  'providers/gemini/models/gemini-2.5-flash/core.md': `[content from flash override]`,
  // Future provider-specific defaults can be added here
};
```

### 4. Create index.ts

```typescript
import { CORE_DEFAULTS } from './core-defaults';
import { TOOL_DEFAULTS } from './tool-defaults';
import { PROVIDER_DEFAULTS } from './provider-defaults';

export const ALL_DEFAULTS: Record<string, string> = {
  ...CORE_DEFAULTS,
  ...TOOL_DEFAULTS,
  ...PROVIDER_DEFAULTS,
};

export { CORE_DEFAULTS, TOOL_DEFAULTS, PROVIDER_DEFAULTS };
```

## Process

1. **Read** each markdown file from `defaults/` directory
2. **Escape** the content properly for TypeScript strings (backticks, backslashes)
3. **Create** the TypeScript constant files with proper exports
4. **Verify** the constants compile without errors

## Special Considerations

1. **Preserve formatting** - Use template literals (backticks) to preserve multi-line content
2. **Escape sequences** - Ensure backslashes and backticks in content are properly escaped
3. **File paths as keys** - Use relative paths from `~/.llxprt/prompts/` as keys
4. **Type safety** - Use Record<string, string> for type checking

## Deliverables

1. Four TypeScript files created with default content
2. All markdown content properly converted to constants
3. Files compile without TypeScript errors
4. Exports properly structured for use by PromptInstaller

## Commands to Run

```bash
# Compile to verify no errors
cd packages/core
npm run typecheck

# Verify exports
node -e "const d = require('./dist/prompt-config/defaults'); console.log(Object.keys(d.ALL_DEFAULTS).length)"
```

## Success Criteria

- All TypeScript files created and compile
- Content matches extracted markdown files
- No runtime errors when importing
- Keys follow correct path structure
- All defaults accessible via ALL_DEFAULTS export