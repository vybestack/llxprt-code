# Project Plan: Issue #489

**Issue Number:** #489
**Title:** Phase 3: Advanced Failover with Metrics (TPM, Latency, Circuit Breakers)
**Branch:** issue489
**Parent Issue:** #485
**Depends On:** #488 (Phase 2 - Complete)
**Date Created:** 2025-12-12

## Quick Links

- [Issue #489 on GitHub](https://github.com/vybestack/llxprt-code/issues/489)
- [Detailed Implementation Plan](./PLAN.md)
- [Acceptance Test Plan](./ACCEPTANCE-TEST.md)

## Summary

This issue extends the load balancing failover system with advanced performance-based triggers and circuit breakers. It builds on Phase 2 (#488) which implemented basic failover with retry logic.

### New Features

1. **TPM Threshold Triggers** - Monitor tokens per minute, failover when below threshold
2. **Timeout-based Triggers** - Cancel and failover requests exceeding timeout
3. **Circuit Breaker Pattern** - Temporarily disable failing backends with automatic recovery
4. **Performance Metrics** - Track requests, successes, failures, tokens, latency per backend
5. **Enhanced Stats Command** - Display `/stats lb` with comprehensive metrics

## Implementation Approach

All phases follow **Test-Driven Development (TDD)**:
- Tests written first
- Implementation follows tests
- Verification ensures quality and compliance

### Phases

1. **Phase 1**: Types and Interfaces (2 hours)
2. **Phase 2**: Circuit Breaker Logic (4 hours)
3. **Phase 3**: Timeout Wrapper (3 hours)
4. **Phase 4**: TPM Tracking and Trigger (4 hours)
5. **Phase 5**: Performance Metrics Collection (3 hours)
6. **Phase 6**: Stats Command Integration (3 hours)
7. **Phase 7**: Final Acceptance Testing (2 hours)

**Total Estimated Time:** 21 hours

## Key Files

### To Create
- `packages/core/src/providers/__tests__/LoadBalancingProvider.types.test.ts`
- `packages/core/src/providers/__tests__/LoadBalancingProvider.circuitbreaker.test.ts`
- `packages/core/src/providers/__tests__/LoadBalancingProvider.timeout.test.ts`
- `packages/core/src/providers/__tests__/LoadBalancingProvider.tpm.test.ts`
- `packages/core/src/providers/__tests__/LoadBalancingProvider.metrics.test.ts`
- `packages/cli/src/ui/commands/__tests__/statsCommand.lb.test.ts`
- `packages/cli/src/ui/components/LBStatsDisplay.tsx`
- `profiles/testlb489.json`

### To Modify
- `packages/core/src/providers/LoadBalancingProvider.ts`
- `packages/core/src/types/modelParams.ts`
- `packages/cli/src/ui/commands/statsCommand.ts`
- `packages/cli/src/ui/types.ts`
- `packages/cli/src/ui/components/HistoryItem.tsx`

## Test Profile

```json
{
  "name": "testlb489",
  "type": "loadbalancer",
  "policy": "failover",
  "profiles": ["synthetic", "chutes", "groqgpt"],
  "ephemeralSettings": {
    "tpm_threshold": 500,
    "timeout_ms": 30000,
    "circuit_breaker_enabled": true,
    "circuit_breaker_failure_threshold": 3,
    "circuit_breaker_failure_window_ms": 60000,
    "circuit_breaker_recovery_timeout_ms": 30000,
    "failover_retry_count": 2,
    "failover_retry_delay_ms": 1000
  }
}
```

## Success Criteria

- ✅ All unit tests pass (100% coverage for new code)
- ✅ All integration tests pass
- ✅ Timeout trigger works correctly
- ✅ Circuit breaker state transitions work (closed → open → half-open → closed)
- ✅ TPM tracking and failover trigger work
- ✅ Backend metrics collected accurately
- ✅ `/stats lb` command displays all metrics
- ✅ No lint/typecheck errors
- ✅ Debug logging comprehensive
- ✅ No memory leaks (cleanup verified)
- ✅ Acceptance test passes

## Documentation

- **PLAN.md**: Detailed phase-by-phase implementation guide
- **ACCEPTANCE-TEST.md**: Manual and automated test scenarios
- **README.md**: This file - quick reference and overview

## Related Issues

- #485: Parent issue - Load Balancer Implementation
- #486: Phase 1 - LoadBalancingProvider Skeleton
- #488: Phase 2 - Basic Failover Strategy (COMPLETE)
- #489: Phase 3 - Advanced Failover with Metrics (THIS ISSUE)

## Notes

- Circuit breaker state is ephemeral (not persisted)
- TPM buckets auto-cleanup after 5 minutes
- All new settings optional with sensible defaults
- Compatible with existing Phase 2 failover implementation

---

**Status:** Planning Complete, Ready for Implementation
**Last Updated:** 2025-12-12
