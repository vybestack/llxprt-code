# Issue #1573: Break Up Core config.ts

## Summary

`packages/core/src/config/config.ts` is a ~3,061-line runtime state/service-locator god object
that needs decomposition. (The issue title references an earlier 2,738-line count; the
current head is ~3,061 lines and this plan is based on that.) This plan breaks it into focused modules following SoC and DRY
principles while establishing a clean boundary between core and CLI.

This is a **backward-compatible refactor**, not a behavior change. No domain redesign of
provider/client lifecycle, no full replacement of Config, no parameter-object redesign.

## Guiding Principles

1. **SoC:** Each file should have a single, clear responsibility
2. **DRY:** Shared low-level policy primitives live in core; bootstrap assembly remains in CLI
3. **Core/CLI boundary:** Core owns configuration infrastructure; CLI owns bootstrap orchestration
4. **Backward compatibility:** Every phase preserves all existing import paths via re-exports
5. **DI foundation:** Consumer interfaces enable future dependency injection without forcing it now
6. **Transitional honesty:** Interfaces are anti-corruption boundaries over the god object, not final domain abstractions

## Documents

- [ANALYSIS.md](./ANALYSIS.md) — Current-state analysis of Config architecture
- [PLAN.md](./PLAN.md) — 8-phase implementation plan with acceptance criteria
- [INTERFACES.md](./INTERFACES.md) — Consumer interface definitions for DI foundation
- [MIGRATION.md](./MIGRATION.md) — Migration guide for callers, tests, and internal packages

## Phase Overview

| Phase | Description | Risk | Scope |
|-------|-------------|------|-------|
| 1 | Extract type definitions | Very Low | ~350 lines moved |
| 2 | Define consumer interfaces (DI foundation) | Low | ~300 lines new |
| 3 | Extract tool registry factory | Medium | ~250 lines moved |
| 4 | Extract LSP integration | Medium | ~280 lines moved |
| 5 | Extract tool governance primitives | Low | ~80 lines from CLI to core |
| 6a | Extract pure builder functions | Low | ~120 lines moved |
| 6b | Extract config initializer | High | ~250 lines moved |
| 7 | Extract env var resolver | Low | ~80 lines new |
| 8 | Separate CLI parseArguments | Low | ~530 lines moved |

**Recommended execution order:** 1 -> 2 -> 8 -> 6a -> 5 -> 3 -> 4 -> 6b -> 7

## Out of Scope

- `initializeContentGeneratorConfig()` extraction (client lifecycle coupling — separate issue)
- `ConfigParameters` decomposition into grouped sub-objects
- Full constructor side-effect separation
- Ad hoc bootstrap metadata formalization (`_bootstrapArgs`, `_cliModelOverride`, `_profileModelParams`, `_cliModelParams`)
