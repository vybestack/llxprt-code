# Domain Model: Provider Package Extraction

Plan ID: PLAN-20260603-ISSUE1584

## Entities

### Provider Implementation
Concrete classes and helpers that implement LLM provider behavior: OpenAI, Anthropic, Gemini, OpenAI Responses, OpenAI Vercel, Fake, load balancing, retry orchestration, logging wrappers, and provider-specific request/response conversion.

### Provider Contract
Types required by non-provider core code to talk about providers without importing provider implementations. Includes provider manager shape, provider instance shape, model/tool representations, telemetry context, and generation options.

### Shared Core Utility
Code currently under providers but used by core subsystems, such as tokenizer contracts, tool ID normalization, media classification, reasoning extraction, and runtime provider errors. Each item must be classified before migration.

### Consumer
Existing code that currently imports provider files: CLI provider wiring, core runtime/config/generation/compression/history/tools/models/telemetry, and tests.

## Business Rules

1. This is a refactor: observable provider behavior must remain unchanged.
2. The extracted package must be reachable through existing CLI startup and provider switching paths.
3. Core must not re-export providers after migration.
4. Core must not import from providers if providers imports from core.
5. Tests must prove behavior and package boundaries, not only file structure.

## State Transitions

1. Current state: provider implementation and contracts live inside core.
2. Contract-classification state: shared contracts/utilities are re-homed or intentionally retained in core.
3. Package-scaffold state: providers package exists and builds with no behavior change.
4. Migration state: provider implementation files move and imports are updated.
5. Consumer state: CLI and other consumers import providers directly.
6. Cleanup state: old core provider exports and implementation files are removed.

## Edge Cases

- Provider tests that rely on core test utilities after file movement.
- Runtime deep imports that compile but fail after package build.
- Tokenizer usage by core history service creating a package cycle.
- Tests accidentally passing because they assert import shape rather than provider behavior.
- Duplicate implementation files left in core and providers.
