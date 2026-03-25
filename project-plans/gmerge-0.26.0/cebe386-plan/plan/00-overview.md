# Plan: MCP Status Hook Refactor

Plan ID: PLAN-20260325-MCPSTATUS
Generated: 2026-03-25
Total Phases: 21 (P00a through P21)
Upstream Commit: cebe386d797b210c2329284cb858b31788c68f23
Prerequisite: 211d2c5 (hooks schema split) should be merged or in-progress — not a hard blocker but shares `coreEvents` integration

## Requirements Implemented

| Requirement | Title | Phases |
|-------------|-------|--------|
| REQ-EVT-001 | McpClientUpdate Event Type | P03, P04, P05 |
| REQ-EVT-002 | Typed Payload Interface | P03, P04, P05 |
| REQ-EVT-003 | Single Source of Truth for Event Name | P05, P18 |
| REQ-EVT-004 | CoreEventEmitter Type Overloads | P03, P04, P05 |
| REQ-EVT-005 | Non-MCP Event Compatibility | P05, P19, P20 |
| REQ-MGR-001 | Emit on COMPLETED Transition | P06, P07, P08 |
| REQ-MGR-002 | Emit on IN_PROGRESS Transition | P06, P07, P08 |
| REQ-MGR-003 | Emit on Client Map Change | P06, P07, P08 |
| REQ-MGR-004 | Emit on Zero-Server Fast Path | P06, P07, P08 |
| REQ-MGR-005 | Server Count Accessibility | P06, P07, P08 |
| REQ-MGR-006 | Emit via coreEvents Not Injected EventEmitter | P06, P07, P08 |
| REQ-HOOK-001 | Initial State from Current Manager | P09, P10, P11 |
| REQ-HOOK-002 | Reactive State Updates | P09, P10, P11 |
| REQ-HOOK-003 | isMcpReady Derivation | P09, P10, P11 |
| REQ-HOOK-004 | Listener Cleanup on Unmount | P09, P10, P11 |
| REQ-HOOK-005 | Hook Return Shape | P09, P10, P11 |
| REQ-QUEUE-001 | Queue Creation | P12, P13, P14 |
| REQ-QUEUE-002 | Gate Parameters | P12, P13, P14 |
| REQ-QUEUE-003 | Auto-Flush When Gates Open | P13, P14 |
| REQ-QUEUE-004 | No Flush While Streaming | P13, P14 |
| REQ-QUEUE-005 | No Flush While MCP Not Ready | P13, P14 |
| REQ-QUEUE-006 | FIFO Ordering | P13, P14 |
| REQ-GATE-001 | Slash Command Immediate Execution | P15, P16, P17 |
| REQ-GATE-002 | Prompt Queuing When MCP Not Ready | P15, P16, P17 |
| REQ-GATE-003 | Prompt Direct Submission When MCP Ready | P15, P16, P17 |
| REQ-GATE-004 | Input History Tracking Preserved | P16, P17 |
| REQ-GATE-005 | Non-Idle Prompt Submission Behavior | P15, P16, P17 |
| REQ-UI-001 | First-Queue Info Message | P16, P17 |
| REQ-UI-002 | No Message on Zero-Server Startup | P17, P19 |
| REQ-CFG-001 | MCP Event Propagation via coreEvents | P18 |
| REQ-TEST-001 | useMcpStatus Unit Tests | P10 |
| REQ-TEST-002 | useMessageQueue Unit Tests | P13 |
| REQ-TEST-003 | McpClientManager Emit Tests | P07 |
| REQ-TEST-004 | Integration: AppContainer MCP Gating | P19 |
| REQ-TEST-005 | String Literal Enforcement | P18 |
| REQ-TEST-006 | Full Verification Suite | P21 |

## Phase Sequence

| Phase | File | Title |
|-------|------|-------|
| P00a | 00a-preflight-verification.md | Preflight Verification |
| P01 | 01-analysis.md | Domain Analysis |
| P01a | 01a-analysis-verification.md | Analysis Verification |
| P02 | 02-pseudocode.md | Pseudocode Development |
| P02a | 02a-pseudocode-verification.md | Pseudocode Verification |
| P03 | 03-core-events-stub.md | Core Events Stub |
| P03a | 03a-core-events-stub-verification.md | Core Events Stub Verification |
| P04 | 04-core-events-tdd.md | Core Events TDD |
| P04a | 04a-core-events-tdd-verification.md | Core Events TDD Verification |
| P05 | 05-core-events-impl.md | Core Events Implementation |
| P05a | 05a-core-events-impl-verification.md | Core Events Impl Verification |
| P06 | 06-mcp-manager-stub.md | MCP Manager Emit Migration Stub |
| P06a | 06a-mcp-manager-stub-verification.md | MCP Manager Stub Verification |
| P07 | 07-mcp-manager-tdd.md | MCP Manager Emit TDD |
| P07a | 07a-mcp-manager-tdd-verification.md | MCP Manager TDD Verification |
| P08 | 08-mcp-manager-impl.md | MCP Manager Emit Implementation |
| P08a | 08a-mcp-manager-impl-verification.md | MCP Manager Impl Verification |
| P09 | 09-use-mcp-status-stub.md | useMcpStatus Hook Stub |
| P09a | 09a-use-mcp-status-stub-verification.md | useMcpStatus Stub Verification |
| P10 | 10-use-mcp-status-tdd.md | useMcpStatus Hook TDD |
| P10a | 10a-use-mcp-status-tdd-verification.md | useMcpStatus TDD Verification |
| P11 | 11-use-mcp-status-impl.md | useMcpStatus Hook Implementation |
| P11a | 11a-use-mcp-status-impl-verification.md | useMcpStatus Impl Verification |
| P12 | 12-use-message-queue-stub.md | useMessageQueue Hook Stub |
| P12a | 12a-use-message-queue-stub-verification.md | useMessageQueue Stub Verification |
| P13 | 13-use-message-queue-tdd.md | useMessageQueue Hook TDD |
| P13a | 13a-use-message-queue-tdd-verification.md | useMessageQueue TDD Verification |
| P14 | 14-use-message-queue-impl.md | useMessageQueue Hook Implementation |
| P14a | 14a-use-message-queue-impl-verification.md | useMessageQueue Impl Verification |
| P15 | 15-app-container-stub.md | AppContainer Wiring Stub |
| P15a | 15a-app-container-stub-verification.md | AppContainer Stub Verification |
| P16 | 16-app-container-tdd.md | AppContainer Gating TDD |
| P16a | 16a-app-container-tdd-verification.md | AppContainer TDD Verification |
| P17 | 17-app-container-impl.md | AppContainer Gating Implementation |
| P17a | 17a-app-container-impl-verification.md | AppContainer Impl Verification |
| P18 | 18-event-audit-impl.md | CLI Config Event Audit + AppEvent Deprecation |
| P18a | 18a-event-audit-impl-verification.md | Event Audit Verification |
| P19 | 19-integration-tdd.md | Integration Tests |
| P19a | 19a-integration-tdd-verification.md | Integration TDD Verification |
| P20 | 20-integration-impl.md | Integration Wiring |
| P20a | 20a-integration-impl-verification.md | Integration Impl Verification |
| P21 | 21-final-verification.md | Final Verification |

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 00a)
2. Read the domain analysis and all pseudocode files
3. Understood this is a NEW FEATURE introducing MCP readiness gating (not refactoring existing gating — LLxprt currently has no MCP gating)
4. Events migrate from `appEvents` to `coreEvents` — both emit and listen must use the same singleton
5. The full verification suite is: `npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
