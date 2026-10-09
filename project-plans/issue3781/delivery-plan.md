# Issue #3781 production delivery

The user authorized production migration after the exploratory runs. Advisory
model inaccuracies are recorded as limitations rather than a requirement for
perfect historical answers. Required checks and assertions remain enforced.
The two independent local review cycles are complete. No additional local
review or OCR is part of delivery.

## Contract

Automatic prereview continues on the five existing `pull_request_target`
events, with mergeability gating, missing-issue draft handling, advisory
failure behavior, and a bot-owned walkthrough comment. Trusted base code reads
PR revisions as Git data. A reusable invocation supports validation through
the registered CI dispatch workflow on a trusted implementation branch.
Required CI jobs keep their existing permissions, triggers and conditions.

The production pipeline uses one pinned runner-local Ollama server and Qwen3.5
4B model. There are no inference credentials, agent tools or hosted fallback.
Nonthinking mapping, grouping, synthesis, diagram and Related stages precede
bounded thinking acceptance checks. Original shared and per-call deadlines
remain ceilings. Mapping has a smaller allowance so it cannot consume all
remaining stages. Same-job reuse is retained; cross-run caching is excluded.

The failed mandatory line-selection experiment is removed from production.
Static source kind, packet identities, diff hashes, and bounded before/head
context remain. Configuration keys and surviving re-export targets are
collected from immutable Git objects. Documentation reports and test source
are not observed test runs. Missing files, unavailable packets, failed stages
and context overflow remain explicitly incomplete. Failed Related inference
never becomes a claim that no related items exist.

## Test-first sequence and verification

1. Establish failing tests for stage thinking/output settings and descriptive
   summaries without mandatory line ranges, then simplify the implementation.
2. Establish failing source-context tests for distant configuration keys and
   surviving targets of deleted barrels, then wire the collector into production.
3. Establish a failing map-budget reservation test, then preserve later stages
   after mapping allowance expiry.
4. Migrate hosted transport/configuration assertions to the local contract.
   Retain security, publishing, coverage, diagrams, malformed output, retry,
   reference-only alignment, missing-issue and advisory failure assertions.
   Balanced Mermaid fixtures keep all sanitation assertions and add missing
   block terminators. Retained malformed model diagrams become small portable
   fixtures rather than dependencies on raw experiment dumps.
5. Replay controls and immutable historical source through actual local
   inference. Record prose errors, completion, budgets and source judgments.
6. Run format, lint, types, full tests, build, `gpt-6-luna` smoke, AST test audit,
   focused scripts, Actions lint and whitespace checks before commit/push.
7. Push `issue3781` over the existing `github-acoliver` SSH alias, create the PR
   using the repository template, validate Linux inference/publication/cleanup
   through registered CI dispatch, and watch CI and CodeRabbit. Do not merge.

## Prior evidence

Prior raw evaluation JSON and source snapshots are preserved under
`tmp/verify3781-deliver/prior-raw/` and `source-before/`. They are gitignored and
are not bundled into the PR. Earlier research and review reports remain in
`tmp/verify3781-deliver/prior-documents/`, with a durable hash index. Delivery
results identify the selected configuration,
actual checks, Actions URLs, source hashes and limitations without claiming
perfect output or equivalence to hosted reviews.
