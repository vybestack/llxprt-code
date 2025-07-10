# Task: Resolve packages/cli/src/ui/hooks/slashCommandProcessor.ts Conflict

## Objective

Resolve the merge conflict in slash command processor to support provider commands while including new commands from main.

## File

`packages/cli/src/ui/hooks/slashCommandProcessor.ts`

## Context

- **multi-provider branch**: Added /provider, /model, and other provider commands
- **main branch**: Added /clear, /memory, and other new commands

## Resolution Strategy

1. Merge all command definitions
2. Ensure command handlers don't conflict
3. Preserve command validation logic
4. Maintain consistent command structure

## Key Items to Preserve

### From multi-provider:

- /provider command and subcommands
- /model command
- /api-key command
- /base-url command
- Provider-specific command logic

### From main:

- /clear command
- /memory command
- Improved command parsing
- Better error handling

## Command Structure

```typescript
const commands = {
  // General commands
  help: { ... },
  clear: { ... },
  memory: { ... },

  // Provider commands
  provider: { ... },
  model: { ... },
  'api-key': { ... },
  'base-url': { ... },
}
```

## Commands to Execute

```bash
# After resolution:
git add packages/cli/src/ui/hooks/slashCommandProcessor.ts
```

## Validation

1. All commands work
2. No command conflicts
3. Proper error messages
4. Type safety maintained
