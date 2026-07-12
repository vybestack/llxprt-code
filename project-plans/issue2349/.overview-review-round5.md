# Review of `project-plans/issue2349/overview.md`

## Verdict: APPROVE-WITH-FIXES

The overview is unusually thorough and largely meets its intended role as an inventory/architecture map rather than an implementation plan. The core architectural thesis is correct: the runtime provider contract is already neutral (`RuntimeProvider.generateChatCompletion(...): AsyncIterableIterator<IContent>` at `packages/core/src/runtime/contracts/RuntimeProvider.ts:77-84`; `RuntimeGenerateChatOptions.contents: IContent[]` at `packages/core/src/runtime/contracts/RuntimeProviderChat.ts:49-67`), while `packages/agents` fabricates and re-plumbs Gemini-shaped envelopes internally. The document also correctly identifies the decisive #2424 failure mode: raw-import cleanliness is insufficient if agents still uses `Contract*` aliases, structural `{role,parts}`/`{candidates}` literals, `ContentConverters.toGeminiContents(...)`, or runtime enum re-declarations.

However, I found several issues that should be fixed before treating this as the authoritative planning input. The most important problems are overclaiming exact completeness for the structural access inventory, under-accounting for runtime `Type` imports in one file, a materially incomplete substitution/enforcement treatment for `GenerateContentConfig` fields, and an enforcement-gate requirement that asks for inline exemption comments in production code despite the project guardrail against adding new lint/suppression-style directives. None of these invalidates the target architecture, but they are actionable defects in an overview that claims exact, evidence-grounded completeness.

---

## Critical findings

None.

---

## Major findings

### Major 1 — Structural access/mutation inventory claims exact completeness but omits several production Google-shape access sites

**Location in document:** §2A.4-II, especially lines 270-312; summary lines 312 and 805.

**Problem:** The document says §2A.4-II is “the full production `.parts`/`candidate.content`/usage-key access surface” and summarizes it as 13 `.parts`/`candidate.content` reader/mutator sites, 4 AFC/content-length sites, and 5 usage-key sites. That exact-completeness claim is false. The section omits several production structural accesses that a planner must neutralize or explicitly classify. Some are covered indirectly in the raw-import table, but this section’s purpose is specifically to catch structural flows that survive name/import swaps. Exact counts in §9.1 and §10 therefore understate the surface.

**Evidence:**

- `packages/agents/src/core/MessageConverter.ts:242-254` reads `content.parts` in `isValidContent`; `MessageConverter.ts:320-333` reads `content.role` and `content.parts[0].text` in `hasTextContent`; `MessageConverter.ts:272-314` iterates `Content[]` by `role` and validates `parts`. The overview’s §2A.4-II table includes `hasTextContent` only as a dependency under `ConversationManager.ts:330-345`, not as its own structural access site, and omits `isValidContent`/`extractCuratedHistory` entirely.
- `packages/agents/src/core/streamResponseHelpers.ts:101-108` reads `chunk.candidates?.find(...)` and `chunk.candidates?.[0]?.content?.parts ?? []`. The document lists usage-key reads in this file at `:149-151` and `:308-314`, but the §2A.4-II `.parts` / `candidate.content` table omits the `:101-108` candidates/content/parts access.
- `packages/agents/src/core/TurnProcessor.ts:798-803` reads and reconstructs `filteredOutputContent.parts`, and `TurnProcessor.ts:803` checks `contentForHistory.parts?.length`. The document lists `TurnProcessor.ts:728` for AFC length filtering and `TurnProcessor.ts:796-801` as a construction site in §2A.4-I(c), but it is omitted from the §2A.4-II access/mutation count.
- `packages/agents/src/core/hookToolRestrictions.ts:184-192` reads `content.parts` and returns `{ ...content, parts: ... }` in `filterHookRestrictedContent`; this is not limited to the clone branch at `:115-133` and should be counted as a structural content mutator.
- `packages/agents/src/core/streamChunkWrapper.ts:77-83` reads `resp.candidates?.[0]`, `candidate?.content?.parts`, and `candidate?.content?.role` to reconstruct `IContent`; the file is marked DELETE, but the structural access inventory still claims to enumerate all current access sites.

**Required fix:** Change the §2A.4-II wording and all dependent counts in §9.1 and §10 from “full” / exact counts to either (a) a complete, regenerated inventory that includes these sites and their dispositions, or (b) a clearly scoped “representative/high-risk” inventory. Because the overview’s value is as a map, I recommend option (a). Add rows for `MessageConverter.isValidContent` / `extractCuratedHistory` / `hasTextContent`, `streamResponseHelpers.accumulateChunkMetadata`, `TurnProcessor._recordOutputContent`, `hookToolRestrictions.filterHookRestrictedContent`, and `streamChunkWrapper.responseToIContent`. If some are intentionally covered by “DELETE file” disposition, say that explicitly rather than omitting them from an exact inventory.

### Major 2 — Runtime `Type` import inventory is incomplete for `subagentRuntimeSetup.ts`

**Location in document:** §3.2 lines 361 and 394; §8 line 701; §9.2 OQ-7 line 782.

**Problem:** The document correctly says `Type` is a runtime import in `core/subagentRuntimeSetup.ts`, but its precise location and imported-symbol list are incomplete. The table row for file #30 lists `Content`, `FunctionDeclaration`, `GenerateContentConfig`, `Type (value)`, but the actual import is at lines 25-30 and includes type imports plus the runtime `Type`. The gate note says real runtime `Type` imports are at `core/subagentRuntimeSetup.ts:25-30`, which is accurate, but the earlier “complete set” sentence only names `core/subagentRuntimeSetup.ts` without line evidence, unlike `agents/executor-tool-dispatch.ts:19`. This is a small factual gap but matters because runtime imports are the non-erased cases that must not be handled as a pure type swap.

**Evidence:** `packages/agents/src/core/subagentRuntimeSetup.ts:25-30` imports `type Content`, `type FunctionDeclaration`, `type GenerateContentConfig`, and runtime `Type` from `@google/genai`.

**Required fix:** Update §3.2’s runtime-import summary to cite `core/subagentRuntimeSetup.ts:25-30` alongside `agents/executor-tool-dispatch.ts:19`. In row #30, explicitly state that `Type` is the only runtime binding and the rest are erased type imports. This will align the table with the enforcement note and prevent planners from treating `subagentRuntimeSetup.ts` as less urgent than `executor-tool-dispatch.ts` for runtime enum replacement.

### Major 3 — `GenerateContentConfig` substitution misses important fields that agents may currently rely on

**Location in document:** §5.2 line 566 and §5.3/OQ-11 lines 597, 786.

**Problem:** The substitution table for `GenerateContentConfig` covers scalar generation settings, tools, tool choice, abort signal, and some provider-specific extras (`topK`, `responseMimeType`) via `modelParams`. It does not call out other common/current `GenerateContentConfig` fields used by Gemini-style APIs and likely present in agents’ configurations, especially `responseSchema`, `responseJsonSchema`, `responseMimeType`, `thinkingConfig`, `safetySettings`, and potentially `cachedContent`. This is not just a theoretical issue: the neutral target must be non-lossy enough that planners know where each config field goes or whether it is deliberately out of scope. The document’s goal is an inventory/gap analysis; a generic “provider-specific extras” bucket is too imprecise for a contract migration.

**Evidence:**

- The existing `ContractGenerateContentConfig` in `packages/core/src/core/clientContract.ts:89-98` only models a subset (`temperature`, `maxOutputTokens`, `topP`, `topK`, `systemInstruction`, `abortSignal`, `tools`, `toolConfig`), while agents imports the full SDK `GenerateContentConfig` in many files, e.g. `packages/agents/src/core/StreamProcessor.ts:513-520` uses `GenerateContentConfig['tools']`, and `packages/agents/src/core/baseLlmClient.ts:68` accepts a config type with legacy non-string `systemInstruction` handling later at `baseLlmClient.ts:328-342`.
- The neutral `ModelGenerationSettings` currently has a finite documented surface (`packages/core/src/llm-types/modelRequest.ts`, cited by the document as `modelRequest.ts:45-61`), so anything outside that surface must be explicitly mapped to request `modelParams`, promoted to a neutral field, or rejected.

**Required fix:** Add a `GenerateContentConfig` sub-inventory: enumerate every config key actually referenced under `packages/agents/src` and every key exposed through `ContractGenerateContentConfig` / stateless helper surfaces, then assign each to `ModelGenerationSettings`, `ModelGenerationRequest.tools`, `ModelGenerationSettings.toolChoice`, `ModelGenerationRequest.abortSignal`, `ModelGenerationRequest.modelParams`, or an explicit “drop/breaking change” bucket. At minimum, add open questions for `responseSchema`/`responseJsonSchema`, `responseMimeType`, `thinkingConfig`/reasoning, `safetySettings`, and cache-related fields if they can enter the agents surface.

### Major 4 — Enforcement gate description requires inline exemption comments, conflicting with the project’s guardrail against new suppression-style directives

**Location in document:** §8 lines 718 and 738; OQ-17 line 792.

**Problem:** The document says the allowed hook-wire adapter “must additionally carry an inline `// gate-exempt: hook-wire boundary (OQ-1a)` justification” and that allow-listed test fixtures “must carry an inline justification.” This is an implementation-plan-flavored gate mechanism and conflicts with the project-level guardrail forbidding new lint/type suppression directives and preferring architectural fixes over silencing/loosening. Even if `gate-exempt` is not literally `eslint-disable`, it creates the same class of local escape hatch the project memory warns against. The document later raises OQ-17 about a central allow-list, but the earlier text states inline comments as mandatory, so the overview is internally inconsistent.

**Evidence:** The project memory explicitly forbids adding suppression/guard-loosening directives and emphasizes fixing the underlying issue rather than silencing or loosening checks. In the document itself, §8 line 718 mandates an inline `// gate-exempt...` marker, while OQ-17 line 792 questions whether a central allow-list should be used instead.

**Required fix:** Reframe the enforcement-gate section as architecture/inventory rather than prescribing inline suppression comments. Prefer a central, versioned allow-list or gate configuration with AST-context matchers and required justification text in that central file. If inline annotations are retained as a secondary human-readable breadcrumb, they must not be the mechanism that permits a violation. Update §8, §8.1, §9.1-10, and OQ-17 so there is one coherent exemption strategy.

### Major 5 — The test structural-fixture inventory is likely not complete enough for the exact acceptance/gate claims

**Location in document:** §3.3-A, §8.1 lines 733-739, §9.1 lines 763-764, §10 line 803.

**Problem:** The document correctly recognizes that test files include structural Gemini fixtures without raw `@google/genai` imports, but it presents a fixed set of additional no-import structural files as if verified complete. A simple structural search shows the methodology needs to be more explicit and likely broader than the named list. In particular, the document’s listed no-import tests focus on `{candidates}`/`{role,parts}` and converter round trips, but the test gate also says it bans `mockResponseToChunk({candidates:...})`-style stream builders and structural internals. The overview does not show a reproducible command/output for §3.3-A comparable to Appendix A.5, so the named allow/rewrite list is not auditable.

**Evidence:** Appendix A.5 provides exact raw-import test files (`project-plans/issue2349/overview.md:925-989`), but there is no equivalent sorted command output for the “structural test files that do NOT import `@google/genai`” named at lines 803 and 454. Since the production structural search already found raw-import-free `agents/executor-prompt-builder.ts:47-58`, a planner needs the same reproducibility for tests to avoid leaving no-import Gemini fixtures behind.

**Required fix:** Add an Appendix A.6 with the exact structural test search command(s), explicit exclusions, and sorted output for no-import test fixtures. Include separate classes for `{candidates}` response fixtures, `{role,parts}` message fixtures, `.parts` assertions/mutators, and converter-boundary tests. If the final test policy is intentionally allow-list based rather than exhaustive, state that and make the allow-list a concrete artifact; do not present the current hand list as complete without reproducible evidence.

---

## Minor findings

### Minor 1 — The document contains implementation-plan drift in the acceptance/gate sections

**Location in document:** §8 lines 731-739; §9.1 lines 747-764.

**Problem:** The overview mostly avoids phases/TDD/schedules, but §8/§9 drifts from inventory/architecture into implementation requirements: “The gate should run in CI,” “parser-based CI core gate,” “separate test gate,” and inline exemption mechanics. Acceptance-relevant invariants are appropriate, but prescribing CI wiring and exemption style starts to look like plan content.

**Evidence:** Lines 731 and 764 prescribe CI gates as implementation deliverables rather than mapping current/target architecture. The user’s instruction says the document is deliberately not an implementation plan and should contain no task lists or implementation steps.

**Required fix:** Keep the gate requirements as target-state architectural/enforcement capabilities (“a mechanical check must be able to detect...”) and move CI wiring specifics, file names, and exemption implementation mechanics to the future implementation plan. Alternatively, label the gate content explicitly as “functional acceptance constraints, not sequencing” and remove “should run in CI” wording from the overview.

### Minor 2 — The “DELETE = 2” disposition tally hides partial-delete realities

**Location in document:** §3.2 lines 412-417 and §10 line 804.

**Problem:** The disposition tally says DELETE = 2 (`streamChunkWrapper.ts`, `providerStopReason.ts`), NEUTRALIZE-IN-PLACE = 3, RETYPE = 41. That is technically the file-level disposition, but the document also says `MessageConverter.convertIContentToResponse`, `DirectMessageProcessor._buildBlockingSyntheticResponse`, and `streamRequestHelpers.patchMissingFinishReason` must disappear. A planner reading the tally may underestimate delete/refactor work because many “RETYPE” files contain functions that are effectively delete-only synthetic-round-trip code.

**Evidence:** The document itself identifies `MessageConverter.convertIContentToResponse` at `overview.md:220`, `_buildBlockingSyntheticResponse` at `overview.md:221`, and `patchMissingFinishReason` at `overview.md:222` as DELETE/contract-vanish, even though only two whole files are counted as DELETE at line 804.

**Required fix:** Rename the tally to “file-level disposition tally” and add a separate “function-level delete inventory” for synthetic-response-only functions. Include at least `convertIContentToResponse`, `applyResponseMetadata`, `applyFinishReasonMapping`, `createUserContentWithFunctionResponseFix` if truly round-trip-only, `_buildBlockingSyntheticResponse`, `patchMissingFinishReason`, and `streamChunkWrapper` helpers. This keeps the overview from underrepresenting deletion work while preserving the no-plan constraint.

### Minor 3 — `HistoryService` evidence should cite type-bearing method lines, not only zero imports

**Location in document:** §4.4 line 523 and §9.1 line 760.

**Problem:** The document correctly states `HistoryService` is neutral and must remain neutral, but the evidence is mostly “zero `@google/genai` imports” plus a general statement that it is expressed in `IContent`. Given the governing principle that structure matters more than provenance, zero imports is not sufficient evidence by itself.

**Evidence:** `packages/core/src/services/history/HistoryService.ts` has zero raw imports, but the stronger evidence is its method signatures and storage types using `IContent` rather than `{role,parts}`. The document does not cite those lines.

**Required fix:** Add exact line citations for `HistoryService` methods/fields that accept/return `IContent`/`IContent[]` (e.g. `add`, `getAll`, `setHistory`, `getCurated` as applicable). Keep the zero-import fact, but do not rely on it as the primary neutrality proof.

### Minor 4 — Public event usage-metadata section is strong, but should explicitly mention the `UsageMetadata` event emission source or absence

**Location in document:** §7A lines 663-678 and §9.2 OQ-2v line 774.

**Problem:** The document accurately identifies the mismatch between `ServerFinishedEvent.value.usageMetadata` (`UsageStats`) and agents API `FinishedValue.usageMetadata` (`promptTokenCount`-style), and it cites `eventAdapter.ts` forwarding. It also discusses `ServerUsageMetadataEvent`, but it does not inventory where `AgentEventType.UsageMetadata` is actually emitted today (or establish that it is unused on the path under review). This matters because the public-usage decision differs depending on whether the `UsageMetadata` event is live, legacy-only, or dead.

**Evidence:** `packages/core/src/core/turn.ts:221-228` defines `ServerUsageMetadataEvent`; `packages/agents/src/api/eventAdapter.ts:267-270` forwards it verbatim. The overview cites both. What is missing is an emitter inventory under `packages/agents/src` / core.

**Required fix:** Add a one-row inventory for current `AgentEventType.UsageMetadata` emitters/call sites, or state that a grep found none under the agent loop if that is the case. This will make OQ-2u/OQ-2v more actionable.

### Minor 5 — Some evidence citations use approximate line ranges where exact lines are available

**Location in document:** Multiple, e.g. §2.5 line 160 (`streamChunkWrapper.ts ~L120–L145`), §4.2 line 484 (“through ~L197”), §3.3 grouped counts.

**Problem:** The document claims “Every non-obvious assertion cites concrete evidence (`file:line`)” at line 5, but several high-value claims use approximate ranges. Approximation is acceptable for prose, but this document is intended as a rigorous inventory; exact line ranges make it easier to verify.

**Evidence:** The exact relevant `streamChunkWrapper` hook restriction lines are `packages/agents/src/core/streamChunkWrapper.ts:129-157`, found by search. The exact `clientContract.ts` member signatures are `packages/core/src/core/clientContract.ts:127-200`.

**Required fix:** Replace approximate citations with exact line ranges where they are central to a claim, especially in the side-channel and contract sections.

---

## Additional open questions / risks to add

1. **Emitter inventory for `AgentEventType.UsageMetadata`:** Is `ServerUsageMetadataEvent` actively emitted by the agent loop, or is it a legacy public type only? This should be answered before selecting §7A option A/B/C.

2. **Complete config-field preservation:** Which `GenerateContentConfig` fields beyond the current `ContractGenerateContentConfig` subset must be preserved across the neutral surface (`responseSchema`/`responseJsonSchema`, `responseMimeType`, `thinkingConfig`, `safetySettings`, cache fields, provider-specific options)? Which are first-class neutral settings versus `modelParams`?

3. **Central gate allow-list artifact:** The overview raises OQ-17 but should make this an explicit risk: without a central allow-list, structural exceptions can spread through inline comments and recreate the same “bridge/shim” failure class.

4. **Exact structural-test inventory:** Add a reproducible no-import structural test scan and decide whether each no-import structural fixture is a boundary characterization, hook-wire compatibility fixture, or an internal agent-loop fixture to rewrite.

5. **Function-level deletion map:** The file-level disposition table is useful, but a future planner also needs a function-level map of synthetic-response-only functions to delete versus functions to neutralize.

---

## Summary

The document’s architecture is sound and it is substantially evidence-grounded: it correctly identifies the neutral provider boundary, the self-inflicted `IContent → GenerateContentResponse → ModelStreamChunk → Part[]` round-trip, the `clientContract.ts` alias problem, the structural `ContentConverters.toGeminiContents` bypass, and the need for side-channel retirement. I would approve it as a planning foundation only after fixes to the exactness claims: regenerate/expand the structural access inventory, correct the runtime-import details, make `GenerateContentConfig` mapping non-lossy, replace inline exemption mechanics with a central AST-context allow-list strategy, and add reproducible evidence for no-import structural test fixtures. Verdict: **APPROVE-WITH-FIXES**.
