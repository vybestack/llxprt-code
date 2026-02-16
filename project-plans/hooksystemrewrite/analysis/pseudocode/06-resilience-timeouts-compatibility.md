# Pseudocode 06: Resilience, Timeouts, and Compatibility

## Interface Contracts

### Inputs
- HookExecutionResult and eventName

### Outputs
- policy decision state and warning metadata

### Dependencies
- HookOutputParser, HookRunner timeout handling, DebugLogger

## Integration Points (Line-by-Line)
- Line 11: exit code 2 maps to policy block
- Line 12: exit code 0 parses JSON/plain-text output
- Line 13: non-0/non-2 exits are fail-open warnings
- Line 31: timeout/signal paths are fail-open and logged

## Anti-Pattern Warnings
- [ERROR] Blocking tool/model calls on infrastructure failures
- [ERROR] Losing stderr context in failure warnings
- [OK] Maintain backward-compatible script protocol and output fields

## Numbered Pseudocode
10: METHOD evaluateExecution(result)
11: IF result.exitCode === 2 THEN RETURN blockedDecision(reasonFromStderrOrOutput)
12: IF result.exitCode === 0 THEN RETURN parsedDecision(result.stdout)
13: warning = makeFailOpenWarning(result)
14: log warning via DebugLogger.warn
15: RETURN allowDecisionWithWarning(warning)
30: METHOD enforceTimeoutSignalPolicy(result)
31: IF result.timedOut OR result.signal THEN RETURN allowDecisionWithWarning(timeoutOrSignalWarning)
32: RETURN evaluateExecution(result)
