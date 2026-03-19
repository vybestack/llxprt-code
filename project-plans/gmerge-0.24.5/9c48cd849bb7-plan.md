# Playbook: Add Security Warning and Improve Layout for Hooks List

**Upstream SHA:** `9c48cd849bb7`
**Upstream Subject:** Add security warning and improve layout for Hooks list (#15440)
**Upstream Stats:** 1 file, 98 insertions(+), 81 deletions(-)

## What Upstream Does

This is a UI-only commit that refactors `HooksList.tsx` to display a prominent security warning at the top explaining that hooks can execute arbitrary commands. It also restructures the layout to show introductory text, the security warning, documentation links, and then the actual hooks list. The "Configured Hooks" header is changed to "Registered Hooks" and the component is changed from a multi-return conditional structure to a single return with nested conditional rendering.

## LLxprt Adaptation Strategy

LLxprt doesn't have a `HooksList.tsx` component because the CLI UI architecture is different. LLxprt uses Ink-based React components in `packages/cli/src/ui/components/` but doesn't have a hooks list view command yet.

**Decision:** This commit should be **SKIPPED** for now. When LLxprt eventually implements a `/hooks` command UI (or hooks management panel), the security warning and layout improvements can be referenced from this upstream commit. The core functionality (hook registry, execution) is already in place; this is purely a UI presentation enhancement for a feature that doesn't exist in LLxprt's UI yet.

## Files to Create/Modify

None (skipped - no equivalent UI component exists in LLxprt)

## Implementation Steps

1. **Mark as SKIP**: This commit modifies UI that doesn't exist in LLxprt
2. **Future reference**: If implementing `/hooks` command UI later, refer to:
   - Security warning text: "Hooks can execute arbitrary commands on your system. Only use hooks from sources you trust. Review hook scripts carefully."
   - Layout structure: Intro text → Security warning → Documentation link → Hooks list
   - Link to docs: `https://geminicli.com/docs/hooks` (adapt to LLxprt docs when available)

## Execution Notes

- **Batch group:** Hooks (SKIP - no action needed)
- **Dependencies:** None
- **Verification:** N/A (skipped)
- **Reason for skip:** LLxprt does not have an equivalent HooksList UI component
