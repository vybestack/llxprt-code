# P01 implementation evidence

## Red tests before implementation

Command: `bun test packages/agent-core/src/definition.test.ts scripts/tests/agent-core-import-boundary.test.ts`

Result: 26 passed, 11 failed. Failures reproduced: unresolved import edge; import-equals Node import; computed/global process access; inert/shadowed `process` and `console` false positive; external helper barrel traversal; descriptor-safe definition and JSON validation; authority allow combined with missing structure; undefined usage overwrite; cache subset in `validateUsageReport`; URL userinfo/query credentials and opaque identities; empty shell argv argument; and abort handling in fake ports. Replay/accounting MemorySessionStore round-trip passed.

Red test names: `rejects every unresolved import edge`, `rejects import-equals syntax for Node builtins`, `rejects Node global aliases including computed process access`, `does not flag inert capability property names or shadowed identifiers`, `rejects helper barrels and unapproved external runtime exports`, `rejects executable, accessor-backed, symbol-keyed, hidden, cyclic, and non-finite data without invoking getters`, `reports authority allow with independent structural definition errors`, `keeps measured usage when a later counter is explicitly undefined and enforces cache subsets`, `validates credential-bearing URL components while preserving opaque identities`, `accepts an empty non-command argument in validated shell facts`, `exercises fake port state transitions and abort handling`.
