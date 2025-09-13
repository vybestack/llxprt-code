# Plan: Token Usage Tracking Enhancement

Plan ID: PLAN-20250909-TOKTRACK
Generated: 2025-09-09
Total Phases: 14
Requirements: REQ-001, REQ-002, REQ-003, REQ-INT-001

## Description

Enhance token usage tracking in LLxprt Code by adding metrics for tokens per minute (TPM) average rates and throttling wait times due to 429 errors. This includes modifications to core components and UI displays to make these metrics visible to users.

## Implementation Approach

1. Enhance ProviderPerformanceMetrics interface with new tracking fields
2. Update ProviderPerformanceTracker to calculate and store tokens per minute and throttle wait times
3. Add session token accumulation methods to ProviderManager
4. Update LoggingProviderWrapper to collect new metrics during API calls
5. Integrate throttling wait time tracking with the retry system
6. Enhance telemetry system to record new metrics with each API response
7. Update UI components (Footer, StatsDisplay) to display new metrics
8. Add token tracking information to diagnostics command output

## Dependencies

- All existing telemetry and provider systems
- UI components in packages/cli/src/ui/components/

## Risks

- Incorrect calculation of tokens per minute affecting accuracy of metrics
- Performance impact from tracking additional metrics
- Integration issues with existing telemetry systems

## Success Metrics

- Tokens per minute accurately calculated and displayed
- Throttling wait times properly tracked and shown
- All new metrics visible in footer, stats display, and diagnostics command
- No performance degradation in normal usage