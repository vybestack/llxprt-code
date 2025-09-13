# Requirements

## REQ-001: Tokens Per Minute Tracking

**Description**: Implement tracking of tokens per minute (TPM) average rates for each provider.

**Acceptance Criteria**:
- TPM is calculated as a rolling average over the past minute
- TPM is exposed through provider performance metrics
- TPM is visible in UI displays

## REQ-002: Throttling Wait Time Tracking

**Description**: Implement tracking of cumulative throttling wait time due to 429 errors.

**Acceptance Criteria**:
- Throttling wait time is accumulated per provider
- Throttling wait time is exposed through provider performance metrics
- Throttling wait time is visible in UI displays

## REQ-003: Session Token Usage Tracking

**Description**: Implement tracking of cumulative token usage per session across all providers.

**Acceptance Criteria**:
- Session token usage tracks input, output, cache, tool, and thought tokens separately
- Session token usage is accumulated across all provider interactions
- Session token usage is visible in UI displays

## REQ-INT-001: UI Integration

**Description**: Integrate new token metrics into existing UI components.

**Acceptance Criteria**:
- Footer component displays TPM and throttling wait time
- StatsDisplay component shows session token usage breakdown
- Diagnostics command includes new metrics in output