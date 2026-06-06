# Phase 0.5: Preflight Verification

## Purpose

Verify assumptions before implementation begins.

## Dependency Verification

| Dependency | Command | Expected Status |
|------------|---------|-----------------|
| TypeScript | npm ls typescript | Installed in workspaces |
| Vitest | npm ls vitest | Installed in root and packages |
| OpenAI SDK | npm ls openai | Installed for provider tests |
| Anthropic SDK | npm ls @anthropic-ai/sdk | Installed for provider tests |
| Google GenAI SDK | npm ls @google/genai | Installed for provider tests |

## Type/Interface Verification

| Type Name | Expected Definition | Verification Command | Match? |
|-----------|---------------------|----------------------|--------|
| IProvider | provider contract exists | sed -n '1,220p' packages/core/src/providers/IProvider.ts | TBD during execution |
| IProviderManager | manager contract exists | sed -n '1,220p' packages/core/src/providers/IProviderManager.ts | TBD |
| ITokenizer | tokenizer contract exists | sed -n '1,160p' packages/core/src/providers/tokenizers/ITokenizer.ts | TBD |
| ProviderRuntimeContext | runtime context exists | sed -n '1,140p' packages/core/src/runtime/providerRuntimeContext.ts | TBD |

## Call Path Verification

| Function/Path | Expected Caller | Evidence Command |
|---------------|-----------------|------------------|
| createProviderManager | CLI provider setup | rg -n "createProviderManager|getProviderManager" packages/cli/src packages/core/src |
| ProviderContentGenerator | core content generation | rg -n "ProviderContentGenerator" packages/core/src packages/cli/src |
| OpenAITokenizer | history token accounting | rg -n "OpenAITokenizer|AnthropicTokenizer" packages/core/src packages/cli/src |
| normalizeToOpenAIToolId | tool ID mapping | rg -n "normalizeToOpenAIToolId" packages/core/src packages/cli/src |

## Test Infrastructure Verification

| Component | Test File Exists? | Test Patterns Work? |
|-----------|-------------------|---------------------|
| providers | existing tests under packages/core/src/providers | run provider-specific vitest before moving |
| CLI provider switching | existing integration tests under packages/cli/src/integration-tests | run targeted tests |
| package boundary | new tests/scripts required | add before implementation |

## Blocking Issues Found

- Provider production code imports many core subsystems, so providers cannot be independent in this issue.
- Core production code imports provider files, so contracts/utilities must be reclassified before final migration.

## Verification Gate

- [ ] All dependencies verified
- [ ] All types match expectations
- [ ] All call paths are possible
- [ ] Test infrastructure ready

IF ANY CHECKBOX IS UNCHECKED: STOP and update plan before proceeding.


## Required Preflight Results Artifact

Before P03 or any production-code implementation begins, copy `project-plans/issue1584/analysis/preflight-results-template.md` to `project-plans/issue1584/analysis/preflight-results.md` and populate every command output. If any output contradicts assumptions in this plan, stop and update the plan before coding.


## Phase-Specific Verification Matrix

Run the commands for this phase range from `project-plans/issue1584/analysis/phase-verification-matrix.md`. For phases that touch providers, CLI, or package metadata, core typecheck alone is insufficient. Always include forbidden import scans from `analysis/anti-shim-policy.md` once consumer migration begins.


## No-Code Phase Marker Rule

If this phase only changes `project-plans/issue1584/**` artifacts and does not modify `packages/**`, package code-marker greps are N/A. Verify the required analysis artifacts, review outputs, and `.completed/` marker instead. If this phase modifies `packages/**`, run the marker commands from `analysis/phase-verification-matrix.md` against `packages/**`.


## Preflight Execution Requirement

`analysis/preflight-results.md` is intentionally not pre-populated during plan creation. P00a must generate it from `analysis/preflight-results-template.md`, paste actual command outputs, and P00a/P01a verification must approve it before P03 or any production-code implementation begins.
