# Issue #4143: use the attempted member's output budget for compression

Test-first plan: verify failing behavior before changing production code.

1. Add behavior tests proving a real failover load balancer's next eligible member output budget reaches agent compression decisions. Exercise token counts below the corrected threshold, between old and corrected thresholds, and above the corrected threshold. Cover round-robin/failover next selection, live/load-balancer override precedence, absent member settings falling back to the existing default, and unchanged non-load-balancer behavior.
2. Run focused Bun tests and record the exact failing assertions before production edits.
3. Trace all pre-send enforcement budget paths, including proactive compression, pending context-window enforcement, and provider-content enforcement. Share the load balancer's non-mutating next-member projection/selection data rather than using stale selected-member state or independently routing.
4. Implement the smallest change to resolve the effective dispatched output budget in those paths while retaining existing context-limit, invalid-budget, and non-LB behavior. Confirm with behavior tests and relevant regressions.
5. Focused verification completed: 40 focused tests passed. Full checks were already scheduled separately and are outside this bounded housekeeping scope. OCR is skipped per Andrew's instruction.

## Known follow-ups

- No output cap is available when delegate projection is unavailable.
- Native adapter overrides are not generalized.
- Legacy synchronous checks and 413 checks are unchanged.
- The post-transport failover guard remains prompt-only.
