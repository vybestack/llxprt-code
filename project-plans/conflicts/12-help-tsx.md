# Task: Resolve packages/cli/src/ui/components/Help.tsx Conflict

## Objective

Resolve the merge conflict in Help component to include provider-specific commands and new help content from main.

## File

`packages/cli/src/ui/components/Help.tsx`

## Context

- **multi-provider branch**: Added provider-specific help commands
- **main branch**: Added new commands and improved help organization

## Resolution Strategy

1. Merge all commands from both branches
2. Organize commands logically
3. Include provider-specific sections
4. Maintain clear formatting

## Key Items to Preserve

### From multi-provider:

- /provider command help
- /model command help
- Provider-specific instructions
- API key setup help

### From main:

- /clear command
- /memory command
- New keyboard shortcuts
- Improved categorization

## Help Structure

```
General Commands:
  /help, /clear, /memory, ...

Provider Commands:
  /provider, /model, /api-key, ...

Keyboard Shortcuts:
  ...
```

## Commands to Execute

```bash
# After resolution:
git add packages/cli/src/ui/components/Help.tsx
```

## Validation

1. All commands documented
2. Clear organization
3. No missing features
4. Readable formatting
