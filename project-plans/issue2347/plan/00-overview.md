# Plan Overview: PLAN-20260702-LLMTYPES (Issue #2347)

Foundation PR: neutral LLM type layer. Read specification.md first; the GitHub issue #2347 body is the ultimate authority.

## Phases (execute sequentially, never skip)

- 03: llm-types scalar surface — TDD (tests first) + impl in one phase (small, pure functions)
  (finishReasons, jsonSchema, toolDeclaration, toolCall, providerApiError, grounding, tokensAndEmbeddings, IContent extensions)
- 03a: verification
- 04: llm-types envelope + request — TDD + impl
  (modelEnvelope: ModelOutput/ModelStreamChunk/accumulate/getToolCalls/toModelStreamChunk; modelRequest; barrel index; core index + package.json exports; assignability tests)
- 04a: verification
- 05: Gemini boundary additive helpers — TDD + impl
  (providers/src/gemini/neutralConverters.ts; cleanGeminiSchema cycle-safety carve-out; round-trip tests against REAL converters)
- 05a: verification
- 06: inventory script + baseline + dev-docs/genai-migration.md
- 06a: verification (holistic, deepthinker)

Rationale for combined TDD+impl phases: this feature is a pure-function type library with no
stub-visible integration surface; the RED→GREEN discipline is enforced INSIDE each phase
(worker must write failing tests first, show them failing, then implement). Verification
phases check for mock theater, reverse testing, pseudocode compliance, and additive-only gates.

## Additive-only gates (checked at every verification)

1. `git diff --stat` shows NO modifications to existing *.test.ts / *.spec.ts files
2. No behavior change to existing converter entry points except cleanGeminiSchema cycle-safety
3. No new files importing @google/genai outside packages/providers/src/gemini/**
4. Existing full test suite passes untouched
