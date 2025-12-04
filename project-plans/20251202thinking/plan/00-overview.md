# Plan: Reasoning/Thinking Token Support

Plan ID: PLAN-20251202-THINKING
Generated: 2025-12-02
Total Phases: 19 (including verification phases)
Requirements: REQ-THINK-001 through REQ-THINK-007

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 00a)
2. Read the specification.md and domain-model.md
3. Understood the pseudocode for the component being implemented
4. Verified all dependencies and types exist as assumed

## Phase Summary

| Phase | ID | Type | Description |
|-------|-----|------|-------------|
| 00a | P00a | Preflight | Verify assumptions before implementation |
| 01 | P01 | Analysis | Domain analysis (already complete) |
| 02 | P02 | Pseudocode | Pseudocode development (already complete) |
| 03 | P03 | Stub | ThinkingBlock interface enhancement |
| 03a | P03a | Verify | Verify ThinkingBlock changes |
| 03b | P03b | Settings | Ephemeral settings registration |
| 03c | P03c | Verify | Verify ephemeral settings |
| 04 | P04 | TDD | ThinkingBlock tests |
| 04a | P04a | Verify | Verify ThinkingBlock tests |
| 05 | P05 | Impl | ThinkingBlock implementation |
| 05a | P05a | Verify | Verify ThinkingBlock implementation |
| 06 | P06 | Stub | reasoningUtils stub |
| 06a | P06a | Verify | Verify reasoningUtils stub |
| 07 | P07 | TDD | reasoningUtils tests |
| 07a | P07a | Verify | Verify reasoningUtils tests |
| 08 | P08 | Impl | reasoningUtils implementation |
| 08a | P08a | Verify | Verify reasoningUtils implementation |
| 09 | P09 | Stub | OpenAIProvider reasoning parsing stub |
| 09a | P09a | Verify | Verify parsing stub |
| 10 | P10 | TDD | OpenAIProvider parsing tests |
| 10a | P10a | Verify | Verify parsing tests |
| 11 | P11 | Impl | OpenAIProvider parsing implementation |
| 11a | P11a | Verify | Verify parsing implementation |
| 12 | P12 | Stub | OpenAIProvider message building stub |
| 12a | P12a | Verify | Verify message building stub |
| 13 | P13 | TDD | OpenAIProvider message building tests |
| 13a | P13a | Verify | Verify message building tests |
| 14 | P14 | Impl | OpenAIProvider message building implementation |
| 14a | P14a | Verify | Verify message building implementation |
| 15 | P15 | Integration | Context limit integration |
| 15a | P15a | Verify | Verify integration |
| 16 | P16 | E2E | End-to-end tests with mock API |
| 16a | P16a | Verify | Verify E2E tests |

## Execution Order

```
P00a → P03 → P03a → P03b → P03c → P04 → P04a → P05 → P05a →
P06 → P06a → P07 → P07a → P08 → P08a →
P09 → P09a → P10 → P10a → P11 → P11a →
P12 → P12a → P13 → P13a → P14 → P14a →
P15 → P15a → P16 → P16a
```

**CRITICAL**: Execute phases in EXACT sequence. Never skip phases.

## Requirements Traceability

| Requirement | Phases |
|-------------|--------|
| REQ-THINK-001 (ThinkingBlock) | P03, P04, P05 |
| REQ-THINK-002 (Utils) | P06, P07, P08 |
| REQ-THINK-003 (Parsing) | P09, P10, P11 |
| REQ-THINK-004 (Building) | P12, P13, P14 |
| REQ-THINK-005 (Context) | P15 |
| REQ-THINK-006 (Settings) | P03b, P12, P13, P14 |
| REQ-THINK-007 (UI) | Future phase (not in scope) |

## Out of Scope for This Plan

**GAP 8 RESOLUTION: REQ-THINK-007 (UI Rendering) is Explicitly Out of Scope**

The following requirements are NOT included in PLAN-20251202-THINKING and require separate implementation plans:

### REQ-THINK-007: UI Rendering of ThinkingBlocks
**Status**: OUT OF SCOPE - Separate plan required
**Location**: `packages/cli/src/ui/`
**Tracking**: Create future plan `PLAN-20251203-THINKING-UI` or similar

**What's Needed** (for future implementation):
- Display component for ThinkingBlocks in CLI
- Styling (collapsible, color-coded, etc.)
- Integration with existing message rendering
- Keyboard shortcuts to toggle thinking visibility
- Settings for default visibility (show/hide reasoning by default)

**Why Separate**:
- UI rendering is independent of core reasoning token support
- Core functionality (parse, store, filter, send) can be tested without UI
- UI implementation requires different expertise and testing approach
- Allows backend work to proceed without blocking on UI decisions

### Other Out of Scope Items:
- **Anthropic provider support**: Separate plan for `thinking` field support (different API format)
- **Gemini provider updates**: Separate plan if Gemini adds reasoning support
- **Token tracking**: Separate plan for `thoughts_token_count` field tracking and display
- **Reasoning quality metrics**: Separate plan for analyzing reasoning effectiveness
