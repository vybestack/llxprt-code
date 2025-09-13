# User Access Points for Token Tracking

This phase identifies how users will actually access the new token tracking functionality.

## Access Points

### 1. CLI Footer Display
/**
 * @plan PLAN-20250909-TOKTRACK.P16
 * @requirement REQ-INT-001.1
 */

- Located in: /packages/cli/src/ui/components/Footer.tsx
- Shows compact token metrics during CLI session
- Displays: tokens per minute (TPM), throttle wait time, session token usage

### 2. Stats Display Component
/**
 * @plan PLAN-20250909-TOKTRACK.P16
 * @requirement REQ-INT-001.2
 */

- Located in: /packages/cli/src/ui/components/StatsDisplay.tsx
- Shows detailed token metrics in diagnostic display
- Displays: tokens per minute average, throttle wait time, session token breakdown

### 3. Diagnostics Command
/**
 * @plan PLAN-20250909-TOKTRACK.P16
 * @requirement REQ-INT-001.3
 */

- Located in: /packages/cli/src/ui/commands/diagnosticsCommand.ts
- Provides comprehensive token usage information
- Displays: all new token tracking metrics in formatted output

## Integration Requirements

### UI Components
- Footer component needs update to show new metrics
- StatsDisplay component needs update to show detailed token tracking
- Diagnostics command needs update to include new metrics

### Data Flow
- Provider performance tracker → telemetry service → UI components
- Retry system → provider performance tracker → telemetry service → UI components
- Provider token usage → provider manager → UI components

## Implementation Verification Points

- Verify metrics are properly formatted for display
- Verify metrics update in real-time during conversation
- Verify footer display doesn't clutter UI
- Verify stats display shows comprehensive information
- Verify diagnostics command outputs all relevant metrics