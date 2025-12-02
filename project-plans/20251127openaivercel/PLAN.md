# Plan: OpenAI Vercel Provider Implementation

Plan ID: PLAN-20251127-OPENAIVERCEL
Generated: 2025-11-27
Total Phases: 20 (including preflight and integration)
Requirements: REQ-OAV-001 through REQ-OAV-009, REQ-INT-001

## Overview

This plan implements a new standalone provider called `openaivercel` that uses the Vercel AI SDK to interact with OpenAI-compatible APIs. This provider sits alongside the existing `openai` provider and can be selected via `--provider openaivercel` CLI argument.

**IMPORTANT**: All testing must use command-line arguments, NOT interactive slash commands. Agents cannot use /slash commands in interactive mode. Use this format:
```bash
node scripts/start.js --provider openaivercel --keyfile ~/.synthetic_key --model "hf:zai-org/GLM-4.6" --base-url "https://api.synthetic.new/openai/v1" --prompt "write me a haiku"
```

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 0.5 and 0.5a)
2. Read the ARCHITECT-CONTEXT.md file for design decisions
3. Written integration tests BEFORE unit tests
4. Verified all dependencies and types exist as assumed
5. **Referenced pseudocode line numbers in implementation**
6. **Included 30% property-based tests minimum**

## Requirements Summary

| ID | Title | Description | Phases |
|----|-------|-------------|--------|
| REQ-OAV-001 | Provider Registration | Provider must be selectable via `--provider openaivercel` CLI argument | P02, P03, P17-P20 |
| REQ-OAV-002 | Standard Authentication | Must support `--keyfile` CLI argument for API key loading | P07, P08 |
| REQ-OAV-003 | BaseURL Configuration | Must support `--base-url` CLI argument for custom endpoints | P07, P08 |
| REQ-OAV-004 | Tool ID Normalization | Must normalize tool IDs between hist_tool_ and call_ formats | P04, P06 |
| REQ-OAV-005 | Message Format Conversion | Must convert internal IContent format to Vercel AI SDK format | P05, P06 |
| REQ-OAV-006 | Chat Completion Generation | Must generate chat completions using Vercel AI SDK | P09, P10 |
| REQ-OAV-007 | Streaming Support | Must support streaming text generation responses | P11, P12 |
| REQ-OAV-008 | Error Handling | Must handle API errors with meaningful error messages | P13, P14 |
| REQ-OAV-009 | Model Listing | Must provide a list of available models via getModels() | P15, P16 |
| REQ-INT-001 | Integration Requirements | Provider must integrate with ProviderManager, CLI, and HistoryService | P17-P20 |

## Pseudocode Files

All implementation phases MUST reference these pseudocode files:

| File | Purpose | Referenced By |
|------|---------|---------------|
| `analysis/pseudocode/001-tool-id-normalization.md` | Tool ID conversion functions | P04, P06 |
| `analysis/pseudocode/002-message-conversion.md` | IContent to CoreMessage conversion | P05, P06 |
| `analysis/pseudocode/003-streaming-generation.md` | Streaming generation with streamText | P11, P12 |
| `analysis/pseudocode/004-non-streaming-generation.md` | Non-streaming with generateText | P09, P10 |
| `analysis/pseudocode/005-error-handling.md` | Error wrapping and classification | P13, P14 |

## Phase Overview

### Foundation Phases

| Phase | Title | Type | File |
|-------|-------|------|------|
| 0.5 | Preflight Verification | Setup | [P00.5-preflight.md](./P00.5-preflight.md) |
| 1 | Architecture Documentation | Analysis | [P01-architecture.md](./P01-architecture.md) |

### Provider Registration (REQ-OAV-001)

| Phase | Title | Type | File |
|-------|-------|------|------|
| 2 | Provider Registration TDD Tests | RED | [P02-provider-registration-tests.md](./P02-provider-registration-tests.md) |
| 3 | Provider Registration Implementation | GREEN | [P03-provider-registration-impl.md](./P03-provider-registration-impl.md) |

### Tool ID Normalization (REQ-OAV-006)

| Phase | Title | Type | File |
|-------|-------|------|------|
| 4 | Tool ID Normalization TDD Tests | RED | [P04-tool-id-normalization-tests.md](./P04-tool-id-normalization-tests.md) |

### Message Conversion (REQ-OAV-005, REQ-OAV-006)

| Phase | Title | Type | File |
|-------|-------|------|------|
| 5 | Message Conversion TDD Tests | RED | [P05-message-conversion-tests.md](./P05-message-conversion-tests.md) |
| 6 | Message Conversion Implementation | GREEN | [P06-message-conversion-impl.md](./P06-message-conversion-impl.md) |

### Authentication (REQ-OAV-002, REQ-OAV-003)

| Phase | Title | Type | File |
|-------|-------|------|------|
| 7 | Authentication TDD Tests | RED | [P07-authentication-tests.md](./P07-authentication-tests.md) |
| 8 | Authentication Implementation | GREEN | [P08-authentication-impl.md](./P08-authentication-impl.md) |

### Generation - Non-Streaming (REQ-OAV-007)

| Phase | Title | Type | File |
|-------|-------|------|------|
| 9 | Non-Streaming Generation TDD Tests | RED | [P09-non-streaming-tests.md](./P09-non-streaming-tests.md) |
| 10 | Non-Streaming Generation Implementation | GREEN | [P10-non-streaming-impl.md](./P10-non-streaming-impl.md) |

### Generation - Streaming (REQ-OAV-008)

| Phase | Title | Type | File |
|-------|-------|------|------|
| 11 | Streaming Generation TDD Tests | RED | [P11-streaming-tests.md](./P11-streaming-tests.md) |
| 12 | Streaming Generation Implementation | GREEN | [P12-streaming-impl.md](./P12-streaming-impl.md) |

### Error Handling (REQ-OAV-009)

| Phase | Title | Type | File |
|-------|-------|------|------|
| 13 | Error Handling TDD Tests | RED | [P13-error-handling-tests.md](./P13-error-handling-tests.md) |
| 14 | Error Handling Implementation | GREEN | [P14-error-handling-impl.md](./P14-error-handling-impl.md) |

### Model Listing (REQ-OAV-009)

| Phase | Title | Type | File |
|-------|-------|------|------|
| 15 | Model Listing TDD Tests | RED | [P15-model-listing-tests.md](./P15-model-listing-tests.md) |
| 16 | Model Listing Implementation | GREEN | [P16-model-listing-impl.md](./P16-model-listing-impl.md) |

### Integration (REQ-INT-001)

| Phase | Title | Type | File |
|-------|-------|------|------|
| 17 | Provider Registry Tests | RED | [P17-provider-registry-tests.md](./P17-provider-registry-tests.md) |
| 18 | Provider Registry Implementation | GREEN | [P18-provider-registry-impl.md](./P18-provider-registry-impl.md) |
| 19 | End-to-End Integration Tests | RED | [P19-integration-tests.md](./P19-integration-tests.md) |
| 20 | Final Integration Implementation | GREEN | [P20-integration-impl.md](./P20-integration-impl.md) |

## TDD Phase Pattern

Each feature follows the TDD Red-Green pattern:

1. **RED Phase** (odd-numbered phases): Write failing tests that define expected behavior
2. **GREEN Phase** (even-numbered phases): Write minimal implementation to make tests pass

## File Structure

After completion, the provider will have this structure:

```
packages/core/src/providers/openai-vercel/
├── OpenAIVercelProvider.ts    # Main provider implementation
├── errors.ts                  # Custom error classes
├── utils.ts                   # Tool ID normalization utilities
├── index.ts                   # Module exports
└── __tests__/
    ├── providerRegistration.test.ts
    ├── toolIdNormalization.test.ts
    ├── messageConversion.test.ts
    ├── authentication.test.ts
    ├── nonStreamingGeneration.test.ts
    ├── streamingGeneration.test.ts
    ├── errorHandling.test.ts
    └── modelListing.test.ts
```

## Related Documents

- [ARCHITECT-CONTEXT.md](./ARCHITECT-CONTEXT.md) - Architecture decisions and context
- [specification.md](./specification.md) - Formal specification
- [requirements.md](./requirements.md) - Detailed requirements
- [execution-tracker.md](./execution-tracker.md) - Phase execution status
- [P00.5a-preflight-verification.md](./P00.5a-preflight-verification.md) - Preflight results
- [dev-docs/PLAN.md](../../dev-docs/PLAN.md) - Plan creation guide
- [dev-docs/PLAN-TEMPLATE.md](../../dev-docs/PLAN-TEMPLATE.md) - Phase template
- [dev-docs/RULES.md](../../dev-docs/RULES.md) - Development guidelines

## Execution Instructions

1. Start with Phase 0.5 (Preflight Verification)
2. Complete phases in order - do not skip phases
3. Each phase must be fully completed before moving to next
4. Create completion markers in `.completed/` directory only when phase is actually done
5. If a phase fails, follow its Failure Recovery section before retrying
