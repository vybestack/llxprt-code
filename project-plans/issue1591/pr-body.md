## Summary

Extracts the policy engine and confirmation bus out of `packages/core` into a new standalone, dependency-decoupled workspace package, `@vybestack/llxprt-code-policy` (`packages/policy`). This resolves #1591.

The policy domain no longer carries `core`, `providers`, `tools`, or `cli` dependencies. `PolicyEngine` is the public entry point, and policy rules remain loadable from TOML files (verified from both source and built `dist`).

## Motivation

Keeping the policy engine and confirmation bus inside `core` forced unnecessary coupling (telemetry utilities, `@google/genai` function-call types) and prevented reuse by other packages. Issue #1591 asks for a clean, standalone policy package with a well-defined public interface and no circular dependencies.

## What changed

- **New `packages/policy`** (`@vybestack/llxprt-code-policy`):
  - Pure config helpers, `PolicyEngine`, TOML loaders, shell-safety utilities, and a stable-stringify helper.
  - A logger- and function-call-agnostic `MessageBus`. The confirmation bus owns its own `PolicyFunctionCall`, `ConfirmationOutcome`, and payload types and accepts an injectable `PolicyLogger`.
  - The package depends only on `@iarna/toml` and `zod` — no core/providers/tools/cli/telemetry/`@google/genai` dependencies (verified by source and manifest scans).
  - Follows repository package conventions (`node ../../scripts/build_package.js` build, `files: ["dist"]`, standard metadata).
- **`packages/core`** now consumes the package via a `file:` workspace dependency:
  - The original `core/src/policy/*` and `core/src/confirmation-bus/*` modules become thin backward-compatible re-export shims, so existing deep imports continue to resolve.
  - `core/src/policy/config.ts` is reduced to an orchestration shim that wires `Storage` and settings into the pure policy helpers.
  - `core/src/confirmation-bus/message-bus.ts` is a thin subclass that injects core's `debugLogger` and preserves the historic two-argument constructor.

## Notes / decisions

- **Enum nominal identity:** The confirmation outcome enum is declared as `ToolConfirmationOutcome` in the policy package (with `ConfirmationOutcome` exported as an alias). TypeScript keys cross-module enum assignability off the enum's declaration name, so matching the structurally identical telemetry enum keeps telemetry event construction (e.g. `new ToolCallEvent(completedToolCall)`) compatible across packages.
- **`packages/settings` gap:** Issue #1591 mentions a `packages/settings` workspace for policy config, but that workspace does not exist in this repository today. Rather than inventing it, policy config is supplied through injected interfaces (`PolicyPathResolver`, `PolicyConfigSource`) and core orchestration until a settings workspace is introduced.

## Verification

All six gates pass locally:

- `npm run build`
- `npm run typecheck` (full repo, clean)
- `npm run lint` (0 errors)
- `npm run format`
- `npm run test` — core 7723 passed, cli 5746 passed, policy 134 passed, plus all other packages green
- `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"` (smoke test succeeds)

## Acceptance criteria

- [x] Policy code lives in `packages/policy`
- [x] `PolicyEngine` is the public entry point
- [x] Policy rules loadable from files (source + dist verified)
- [x] No dependency on core/providers/tools/cli (and no telemetry/`@google/genai`)
- [x] No circular dependencies
- [x] Tests pass in the new package and across the monorepo
- [x] Existing imports remain working via backward-compatible core re-export shims

Fixes #1591
