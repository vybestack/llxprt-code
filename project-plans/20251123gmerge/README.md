# gemini-cli v0.8.2 to v0.9.0 Cherry-Pick Plan

## Quick Reference

- **Analysis Date:** 2025-11-23
- **Total Commits Analyzed:** 82
- **Recommendation:** Pick 31, Pick Carefully 8, Skip 43

## Files

- `analysis.md` - Full detailed analysis with all commits categorized
- `README.md` - This file (quick reference)

## Summary

### Commits to PICK (31)
High-value, low-risk improvements:
- IDE fixes and enhancements
- MCP improvements (OAuth, prompt-only servers)
- Bug fixes (stream failure, UI loops, paste handling)
- Security fixes (dependency updates, sensitive keyword linter)
- Test improvements

### Commits to PICK CAREFULLY (8)
Valuable but need adaptation:
- **Retry/fallback refactoring** - Major changes, needs multi-provider adaptation
- **Session cleanup** - Large feature, test thoroughly
- **Subagents config** - Verify compatibility with llxprt's existing implementation
- **OpenTelemetry** - Privacy review needed
- **IDE auth validation** - Ensure multi-provider compatibility

### Commits to SKIP (43)
- 12 release management commits
- 5 patch/hotfix commits (check originals instead)
- 9 infrastructure/CI commits (gemini-specific)
- 7 documentation-only commits (gemini-specific)
- 3 extension commits (review if llxprt has same extension system)
- 2 ClearcutLogger commits (removed from llxprt for privacy)
- 2 GEMINI.md memory commands (llxprt uses CLAUDE.md)
- 3 other commits (auto-update, UI reverts, smart edit)

## High Priority Picks

Start with these high-value, low-risk commits:

1. **c195a9aa** - IDE: Use 127.0.0.1 for client connection
2. **e705f45c** - Fix: Retain user message in history on stream failure
3. **3f79d7e5** - MCP: Fix OAuth support
4. **0c6f9d28** - MCP: Handle prompt-only servers
5. **d9fdff33** - Feature: Make --allowed-tools work in non-interactive mode
6. **43b3f79d** - Security: Update dependencies to fix vulnerabilities
7. **8149a454** - Security: Add sensitive keyword linter

## High Risk Items

Proceed with caution:

1. **319f43fa** - Retry/fallback refactoring (999+/807- lines)
2. **3b92f127** - Unify retry logic
3. **974ab66b** - Session cleanup (2500+ lines)

These touch core request handling and may conflict with llxprt's multi-provider architecture.

## Next Steps

1. Read the full `analysis.md` for detailed reasoning
2. Create a new branch: `20251123-gmerge`
3. Start with Phase 1 commits (safe fixes)
4. Test thoroughly after each batch
5. Proceed to Phase 2, 3, 4 as outlined in analysis.md

## Testing Checklist

After each batch:
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run test`
- [ ] `npm run format && git add -A`
- [ ] Test multi-provider switching
- [ ] Test IDE integration
- [ ] Test MCP servers
- [ ] Test session management

## Questions to Answer

Before cherry-picking high-risk commits:

1. Does llxprt have custom retry logic that conflicts with #319f43fa?
2. Is FlashFallback completely disabled in llxprt?
3. Does llxprt have custom session management?
4. Is OpenTelemetry acceptable for llxprt?
5. Does llxprt have the same extension system as gemini-cli?

See `analysis.md` for full details.
