# Sync Summary: v0.15.4 to v0.16.0

**Branch**: `20260129gmerge`
**Upstream Range**: `v0.15.4..v0.16.0`
**Total Upstream Commits**: 50
**Date Range**: 2025-11-11 to 2025-11-18

## Decision Summary

| Decision | Count | Percentage |
|----------|-------|------------|
| PICK | 14 | 28% |
| SKIP | 29 | 58% |
| REIMPLEMENT | 7 | 14% |

## Key Decisions Made

### Skipped After Research

| Commit | What | Why Skipped |
|--------|------|-------------|
| 1ed163a66 | Safety Checker Framework | Security theater - sandbox is real protection, shell commands bypass it |
| 3cb670fe3 | Selection Warning | LLxprt has `/mouse off`, different UX |
| cc608b9a9 | flagId Experiment | Google A/B testing infrastructure |
| 6f34e2589 | Mouse Button Tracking | Tied to selection warning |
| 7ec78452e | write_todo tool | LLxprt has different todo system |
| 48e3932f6 | Auth type checkpoint | Gemini-specific auth |

### Features to Implement

| Commits | What | Notes |
|---------|------|-------|
| ee7065f66 + d30421630 + fb99b9537 | Sticky Headers | User requested, 3 commits together |
| 60fe5acd6 | Animated Page Up/Down | Keyboard scroll commands |
| 2b8adf8cf | Drag Scrollbar | May have partial from v0.15.4 |
| 3cbb170aa | ThemedGradient fixes | Check existing coverage |

## PICK Commits (14)

Clean cherry-picks expected:

1. **e8038c727** - Test faketimer fix
2. **d3cf28eb4** - PascalCase tool display names
3. **cab9b1f37** - Extensions await handler fix
4. **1c8fe92d0** - Hook aggregator (new file)
5. **1c87e7cd2** - RipGrep enhancements
6. **1ffb9c418** - FileCommandLoader abort fix
7. **540f60696** - Docs fix
8. **4d85ce40b** - console.clear() buffer fix
9. **0075b4f11** - Tool internal name display
10. **aa9922bc9** - Keyboard shortcuts docs autogen
11. **ad1f0d995** - toml-loader test refactor
12. **a810ca80b** - Reset to auto in fallback mode
13. **43916b98a** - Buffer cleanup fix
14. **13d8d9477** - Editor setting immediate update

## Execution Estimate

- **PICK phase**: 2 batches (7 commits each)
- **REIMPLEMENT phase**: 2 batches
  - Batch 1: Sticky headers (3 commits)
  - Batch 2: Scroll/drag features (4 commits)
- **Total batches**: ~4
- **Estimated time**: 1-1.5 hours with verification

## Safety Checker Decision Rationale

**Permanently skipped** because:

1. Only checks file tool paths, not shell commands
2. `run_shell_command` bypasses all path checking
3. Sandbox (#1036) provides real container isolation
4. No built-in git protection (user must configure)
5. 2600+ lines for marginal benefit
6. AI can be prompt-injected to bypass patterns

**Focus**: Fix sandbox for real security instead.
