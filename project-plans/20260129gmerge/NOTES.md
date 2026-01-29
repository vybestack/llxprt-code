# Notes: v0.15.4 → v0.16.0 Cherry-Pick

**Branch:** `20260129gmerge`

---

## Key Decisions Made During Planning

### Safety Checker Framework - PERMANENTLY SKIPPED

Commit `1ed163a66` introduces a safety checker framework. After deep research, we decided to **skip permanently** because:

1. **Shell bypass**: Only checks file tool paths. `run_shell_command` arguments bypass all path checking.
2. **Incomplete solution**: Even with later shell parsing (post-v0.16.0), it's pattern-matching whack-a-mole.
3. **Sandbox is the answer**: Container isolation (#1036) provides real security.
4. **Git not protected**: No built-in rules for dangerous git commands.
5. **Security theater**: 2600+ lines for marginal protection.

Focus instead on fixing sandbox (#1036).

### Selection Warning - SKIPPED

Commit `3cb670fe3` adds "Press Ctrl-S to enter selection mode" warning. Skipped because LLxprt already has `/mouse off` command - different UX approach, same functionality.

### Mouse Button Tracking - SKIPPED

Commit `6f34e2589` adds button field to MouseEvent. Skipped because it's primarily for selection warning feature we're skipping.

---

## Batch Execution Notes

### Batch 1
*To be filled during execution*

### Batch 2
*To be filled during execution*

### Batch 3 (Sticky Headers)
*To be filled during execution*

### Batch 4 (UI Improvements)
*To be filled during execution*

### Batch 5 (MALFORMED_FUNCTION_CALL)
*To be filled during execution*

---

## Follow-ups Created

*None yet*

---

## Conflicts Encountered

*None yet*

---

## Deviations from Plan

*None yet*
