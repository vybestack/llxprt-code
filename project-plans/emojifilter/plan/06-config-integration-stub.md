# Phase 6: Configuration Integration Stub

## Worker Command
```bash
claude --dangerously-skip-permissions -p "
Add configuration methods to Config class based on:
- specification.md REQ-003
- analysis/pseudocode/configuration-integration.md lines 1-74

UPDATE packages/core/src/config/config.ts
ADD methods:
- getEmojiFilterMode(): string (return 'auto')
- setEmojiFilterMode(mode: string): void (empty)

UPDATE packages/cli/src/ui/commands/setCommand.ts
ADD handling for 'emojifilter' command (stub)

Requirements:
1. UPDATE existing files (no new versions)
2. Methods return empty/default values
3. Must compile with TypeScript

FORBIDDEN:
- Creating ConfigV2 or ConfigNew
- throw new Error('NotYetImplemented')
"
```

## Expected Changes
- Config class with new methods
- setCommand with emojifilter handling

## Verification
```bash
# No duplicate files
find packages -name "*V2*" -o -name "*New*"
[ $? -eq 0 ] && echo "FAIL: Duplicate versions found"

# TypeScript compiles
npm run typecheck || exit 1
```