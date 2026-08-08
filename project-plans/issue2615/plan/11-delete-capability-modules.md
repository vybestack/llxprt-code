# P11 — Delete Consumer Capability Modules

Plan ID: PLAN-20260808-ISSUE2615.P11
Requirement: REQ-005

## Goal

Delete, having migrated every consumer to core-owned roles:

- `packages/agents/src/config/capabilities.ts`
- `packages/providers/src/config/capabilities.ts`
- `packages/cli/src/config/capabilities.ts`
- `packages/mcp/src/client/trustedFolderSource.ts`

Plus the 5 inline `Pick<Config, ...>` narrowings and the six hand-declared
`setEphemeralSetting` interfaces those consumers wrote because no contract
existed.

## Rules

If something in a capability module has no equivalent role, that is a P01 gap.
Record it and stop; do not keep the module alive to avoid the question.

## Acceptance

- The four files no longer exist
- `grep -rn "Pick<Config" packages/*/src --include=*.ts` returns nothing
- All suites green
