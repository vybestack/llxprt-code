# Technical Dependencies Analysis

This phase analyzes the technical dependencies between components in the token tracking enhancement.

## Component Dependencies

### Core Components
/**
 * @plan PLAN-20250909-TOKTRACK.P17
 * @requirement REQ-001, REQ-002, REQ-003
 */

1. ProviderPerformanceTracker 
   - Depends on: ProviderPerformanceMetrics interface
   - Used by: LoggingProviderWrapper, retry system, telemetry service

2. ProviderManager
   - Depends on: ProviderPerformanceTracker
   - Used by: UI telemetry components, diagnostics command

3. LoggingProviderWrapper
   - Depends on: ProviderPerformanceTracker, ProviderManager
   - Used by: ProviderManager (for wrapping providers)

4. Retry System (/packages/core/src/utils/retry.ts)
   - Depends on: ProviderPerformanceTracker (for throttle tracking)
   - Used by: All provider implementations

### UI Components

5. Footer Component (/packages/cli/src/ui/components/Footer.tsx)
   - Depends on: UI telemetry service
   - Used by: Main CLI display

6. Stats Display (/packages/cli/src/ui/components/StatsDisplay.tsx)
   - Depends on: UI telemetry service
   - Used by: Diagnostic command display

7. Diagnostics Command (/packages/cli/src/ui/commands/diagnosticsCommand.ts)
   - Depends on: UI telemetry service, ProviderManager
   - Used by: CLI diagnostics feature

## Data Flow Dependencies

1. API Response → LoggingProviderWrapper → ProviderManager → UI Telemetry Service → UI Components
2. 429 Errors → Retry System → ProviderPerformanceTracker → UI Telemetry Service → UI Components
3. Provider Implementation → ProviderPerformanceTracker (token tracking calculations)
4. Provider Implementation → LoggingProviderWrapper (token extraction from responses)
5. LoggingProviderWrapper → ProviderManager (session token accumulation)
6. ProviderManager → UI Components (session token usage display)

## External Dependencies

- OpenTelemetry API for metrics logging
- Provider-specific SDKs (Google GenAI, OpenAI SDK, Anthropic SDK)
- SettingsService for storing provider settings
- TypeScript for type safety

## Implementation Order

1. Update ProviderPerformanceMetrics interface (types.ts)
2. Enhance ProviderPerformanceTracker with new metrics
3. Update LoggingProviderWrapper for token extraction
4. Update retry system for throttle wait time tracking
5. Update ProviderManager for session token accumulation
6. Update telemetry service for new metrics
7. Update loggers to record new metrics
8. Update UI components for display
9. Update diagnostics command for output