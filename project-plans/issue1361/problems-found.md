# Problems Found by Deep Analysis

## 30 Issues Identified

1. Plan assumes events exist in HistoryService, but contentAdded/compressionStarted/compressionEnded are currently neither typed nor emitted.
2. Proposed compressionEnded(summary, itemsCompressed) changes HistoryService.endCompression contract and may break existing generic queue-unlock callers.
3. Event timing during compression is underdefined: queued add() operations can reorder/shift contentAdded relative to compression boundaries unless explicitly specified.
4. Contradiction: plan says no fire-and-forget async except writer drain, but also prescribes fire-and-forget flush in cancellation path.
5. CLI strategy contradiction: spec centers on --continue type change, but also introduces --resume alias + mutual-exclusion rules, increasing ambiguity.
6. ~~Duplicate replay requirement definitions for project-hash validation (REQ-RPL-004 and REQ-RPL-006 overlap).~~ FIXED: REQ-RPL-004 removed; REQ-RPL-006 is the canonical project hash validation requirement.
7. Malformed threshold math inconsistent: requirement says malformed events, formula uses skippedCount/totalLineCount.
8. P07 test quotas (40+/12+) incentivize test-count theater over signal and maintainability.
9. P07 methodology conflict: says use writer-generated files, but many cases require hand-crafted malformed/non-monotonic files.
10. P14 non-interactive subscription timing (after first sendMessageStream) can miss earliest history events.
11. ~~API naming drift in P14: references recordingIntegration.subscribe() vs described subscribeToHistory(...).~~ FIXED: P14 now consistently uses subscribeToHistory(historyService) matching the pseudocode.
12. Requirement namespace drift in P27 (REQ-CLN-* for removal) weakens traceability against main spec groups.
13. Direct contradiction: P27 matrix says non-interactive does not resume; spec matrix allows --prompt with --continue.
14. Constraint contradiction: "no new npm dependencies" vs mandated fast-check devDependency/property tests.
15. Lock stale detection under-specified: PID-only checks risk false positives on PID reuse without stronger validation.
16. Durability language inconsistent: some sections imply broad guaranteed flush while later tiers correctly mark signal paths best-effort.
17. Session discovery "read first line only" is brittle for BOM/partial/corrupt first-line cases; no fallback specified.
18. UI reconstruction claims "same fidelity" while explicitly dropping transient info/error/warning/compression UI items.
19. HistoryService mutation-path assumptions are fragile unless all write paths are guaranteed to funnel through addInternal emission points.
20. Mandatory per-method @plan/@requirement/@pseudocode markers create noisy churn and conflict with normal code style hygiene.
21. Failure-recovery commands (e.g., git checkout -- packages/) are overbroad and can revert unrelated user work.
22. Performance SLOs (<50ms flush, <500ms replay 10k events) are environment-dependent and ungrounded as hard acceptance criteria.
23. Event-order invariant "session_start always first" conflicts with tolerant corruption handling unless precedence is explicitly defined.
24. Unknown-event policy conflict: forward-compatibility discussed, but unknown events are just skipped, potentially losing useful future data.
25. Line-number-anchored implementation instructions are brittle and likely stale.
26. Ownership/lifecycle wording for non-interactive flush vs cleanup responsibilities is inconsistent across docs.
27. Migration-period policy conflicts with removal phase asking to remove migration code without explicit cutoff criteria.
28. session_event UX is ambiguous: warnings must be surfaced on resume while session_events are not re-displayed in UI.
29. Phase boundary overlap: P14 includes wiring/integration scope that appears to intrude on later integration phases, risking sequencing churn.
30. Legacy .json invisibility for resume is a UX regression ("No sessions found") without explicit user-facing migration guidance.
