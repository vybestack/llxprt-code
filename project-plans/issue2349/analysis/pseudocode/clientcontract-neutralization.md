# Pseudocode: clientContract.ts cross-package neutralization (core + CLI + agents)

Plan: PLAN-20260707-AGENTNEUTRAL — REQ-009.1/.2, REQ-INT-002, OQ-4.
Target: `packages/core/src/core/clientContract.ts` (MODIFY), 23 CLI consumers (§A.2), 5 core consumers (§A.3), agents `client.ts` (implements surface).

## Interface Contracts

INPUTS: the current Google-shaped `Contract*` payload types + `AgentClientContract`/`AgentChatContract` member signatures.
OUTPUTS: neutral member signatures typed in `IContent`/`ModelOutput`/`ModelGenerationSettings`/`AgentMessageInput`; the `Contract*` payload types DELETED.
DEPENDENCIES (real): `IContent` (core), `ModelOutput`/`ModelGenerationSettings`/`AgentMessageInput` (neutral), `ServerAgentStreamEvent`/`StreamEvent` (core, unchanged), `HistoryService`.

## clientContract.ts — DELETE payload types (REQ-009.1)

```
10: DELETE ContractFunctionCall/ContractFunctionResponse (:50-62)
11: DELETE ContractPart (:64-73)
12: DELETE ContractPartListUnion (:75-78)
13: DELETE ContractContent (:80-83)
14: DELETE ContractContentUnion (:85-89)
15: DELETE ContractGenerateContentConfig (:91-101)
16: DELETE ContractGenerateContentResponse (:103-126)   // incl. usageMetadata (promptTokenCount...) — §7A internal ban
17: DELETE ContractSendMessageParameters (:128-131)
18: DELETE ContractUsageMetadata (if present)
```

## clientContract.ts — RETYPE surface members (REQ-009.2)

```
20: interface AgentChatContract {
21:   sendMessageStream(params: { message: AgentMessageInput; settings?: ModelGenerationSettings }, prompt_id): Promise<AsyncGenerator<StreamEvent>>
22:   getHistory(): IContent[]                          // was ContractContent[]
23:   setHistory(history: IContent[]): void
24:   clearHistory(): void; getHistoryService(): HistoryService|null; wasRecentlyCompressed(): boolean
25:   performCompression(promptId): Promise<PerformCompressionResult>
26:   recordCompletedToolCalls(model, completedToolCalls): void
27: }
28: interface AgentClientContract {
29:   getHistory(): Promise<IContent[]>                 // was Promise<ContractContent[]>  (G1 vanishes)
30:   storeHistoryForLaterUse(history: IContent[]): void
31:   addHistory(content: IContent): Promise<void>
32:   resumeChat(history: IContent[]): Promise<void>
33:   setHistory(history: IContent[], options?: { stripThoughts?: boolean }): Promise<void>
34:   restoreHistory(historyItems: IContent[]): Promise<void>   // already IContent[] — unchanged
35:   startChat(extraHistory?: IContent[]): Promise<AgentChatContract>
36:   generateDirectMessage(params: { message: AgentMessageInput; settings?: ModelGenerationSettings }, promptId): Promise<ModelOutput>  // was ContractGenerateContentResponse
37:   generateJson(contents: IContent[], schema: JsonSchema, abortSignal, model, settings?: ModelGenerationSettings): Promise<Record<string,unknown>>
38:   generateContent(contents: IContent[], settings: ModelGenerationSettings, abortSignal, model): Promise<ModelOutput>
39:   generateEmbedding(texts: string[]): Promise<number[][]>   // unchanged
40:   sendMessageStream(initialRequest: AgentMessageInput, signal, prompt_id, turns?, isInvalidStreamRetry?, is413Retry?): AsyncGenerator<ServerAgentStreamEvent, unknown>
41:   // ... remaining members unchanged (initialize/dispose/setTools/etc.)
42: }
```

## Cross-package migration ordering (OQ-4)

```
50: STEP A: land neutral gap types (AgentMessageInput/afcHistory) — no consumer break.
51: STEP B: neutralize agents INTERNAL pipeline; agents client.ts still SATISFIES the old Contract* surface (superset — IContent is structurally usable where ContractContent was, since agents produced structurally-compatible objects). Build stays green.
52: STEP C: flip clientContract.ts payload types to neutral (lines 10-41) AND migrate all 23 CLI (§A.2) + 5 core (§A.3) consumers in the SAME phase. Build must be green at phase end.
53:   - CLI consumers: retype variables/params from Contract*/Content to IContent/ModelOutput; history-export/at-command/stream hooks read c.blocks not .parts.
54:   - core consumers (checkpointUtils/llm-edit-fixer/summarizer/agentClientLifecycle/commands-types): retype to IContent[]/ModelOutput.
55: STEP D (later phase): remove genai dep + land gate.
```

## Integration Points (line-by-line)

- Line 22/29: neutral `getHistory` REPLACES `toGeminiContents(...)` at `client.ts:421` (G1) + `ConversationManager.ts:419` (G2) — must still await idle (client.ts:403-413) + return a clone (ConversationManager structuredClone) → return cloned `IContent[]`.
- Line 36: `Promise<ModelOutput>` cascades from `TurnProcessor.sendMessage` (directmessageprocessor-neutral).
- Line 40: `AgentMessageInput` REPLACES `ContractPartListUnion` initialRequest (feeds `iContentFromAgentMessageInput`).
- STEP C: the 23 CLI files (`historyExportUtils.ts`, `atCommandProcessor*.ts`, `agentStream/*`, `zed-*`, etc.) + 5 core files — retype together.

## Anti-Pattern Warnings

```
[ERROR] DO NOT: keep any Contract* payload type "for compatibility" — DELETE them (they are Google-shaped).
[ERROR] DO NOT: alias IContent back to ContractContent — that is the #2424 name-swap failure.
[ERROR] DO NOT: split the CLI/core consumer migration from the payload-type deletion — build would break (OQ-4).
[ERROR] DO NOT: change ServerAgentStreamEvent/StreamEvent (core public shapes, RISK-1).
[OK] DO: verify the monorepo build is green at the end of the contract phase before proceeding.
```
