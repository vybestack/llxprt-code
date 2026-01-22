# REIMPLEMENT Plan: Hook Configuration Schema and Types

**Upstream SHA:** `c0495ce2f93a48dff801acdd58743f138e5b419c`  
**Subject:** feat(hooks): Hook Configuration Schema and Types (#9074)

## Overview

This commit introduces the foundation for a new hooks system with configuration schema and types.

## Files Changed (Upstream)

- `packages/cli/src/config/config.ts` (+3 lines)
- `packages/cli/src/config/settings.ts` (+1 line)
- `packages/cli/src/config/settingsSchema.ts` (+24 lines)
- `packages/core/src/config/config.test.ts` (+116 lines)
- `packages/core/src/config/config.ts` (+75 lines)

## LLxprt Considerations

1. **Settings Schema** - LLxprt has its own settings schema system; need to verify compatibility
2. **Config Structure** - Check if hooks configuration conflicts with LLxprt's profile system
3. **Multi-Provider** - Hooks should work across all providers, not just Gemini

## Implementation Steps

1. Review upstream diff in detail
2. Check LLxprt's current config structure
3. Cherry-pick and resolve conflicts
4. Adapt any Gemini-specific references
5. Add tests if needed

## Verification

```bash
npm run lint && npm run typecheck
npm run test --workspace @vybestack/llxprt-code-core
```

## Decision

- [ ] Cherry-pick with conflicts
- [ ] Manual adaptation needed
- [ ] Skip specific parts

---

*Plan to be executed during Batch 14*
