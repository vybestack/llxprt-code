# Phase 6: Settings Repository Stub

## Objective

Create minimal skeleton of SettingsRepository for persistence.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Create stub implementation of SettingsRepository.

Create packages/core/src/settings/SettingsRepository.ts:
- Implement ISettingsRepository interface
- Methods: load(), save(), backup()
- All methods throw new Error('NotYetImplemented')
- Include proper TypeScript types
- Maximum 50 lines

Requirements:
1. Must compile with strict TypeScript
2. No actual file system operations
3. Return proper types even when throwing

Output status to workers/phase-06.json
"
```

## Verification

```bash
# Check compilation
npm run typecheck

# Verify stubs only
grep -r "NotYetImplemented" packages/core/src/settings/SettingsRepository.ts
[ $? -eq 0 ] || echo "FAIL: Missing stubs"
```