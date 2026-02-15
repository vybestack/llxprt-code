# Remediation Plan: Resume History Seeding (Issue #1361)

## Problem Statement

`--continue` resume does NOT restore conversation history. The recording side works — JSONL files are created and appended — but `resumeResult.history` (the replayed `IContent[]`) is never fed into the chat runtime or UI. The user sees an empty conversation despite successfully resuming a session.

**Root cause**: In `packages/cli/src/gemini.tsx`, inside the `main()` function's resume block (the `if (continueRef)` branch around line 896), when resume succeeds, only `resumeResult.recording` is captured as `recordingService`. The `resumeResult.history` and `resumeResult.metadata` fields are completely unused.

**Verification**: `resumeResult` is typed as `ResumeResult` (defined in `packages/core/src/recording/resumeSession.ts`, function `resumeSession`, interface at line 59). It returns `{ ok: true, history: IContent[], metadata: SessionMetadata, recording: SessionRecordingService, warnings: string[] }`. Today only `.recording` and `.warnings` are consumed.

## Definition of Done

All items below are required to consider Issue #1361 resolved:

1. Interactive `--continue` restores and displays prior conversation turns in the terminal before accepting new input.
2. Follow-up prompt immediately after resume is answered using restored context (no "I don't have context" response).
3. Resume does not duplicate prior restored content in the session JSONL recording.
4. `npm run typecheck` passes and targeted tests for converter + recording integration + CLI resume-failure fallback pass.


## Scope

**3 production files modified** + **1 new utility file** + **2 new/extended test files**. ~200 lines changed total. No changes to any recording/replay/discovery/core code.

### Files NOT Modified (confirmed working)

- `packages/core/src/recording/SessionRecordingService.ts` — [OK]
- `packages/core/src/recording/ReplayEngine.ts` — [OK]
- `packages/core/src/recording/SessionDiscovery.ts` — [OK]
- `packages/core/src/recording/resumeSession.ts` — [OK]
- `packages/core/src/recording/SessionLockManager.ts` — [OK]
- `packages/core/src/recording/RecordingIntegration.ts` — [OK]
- `packages/core/src/services/history/HistoryService.ts` — [OK]
- `packages/core/src/services/history/IContent.ts` — [OK]

---

## Architecture: Verified Source-Level Analysis

### Two Independent Systems Need History

1. **Model/API History** (`GeminiClient` → `GeminiChat` → provider API)
   - Entry point: `GeminiClient.restoreHistory()` in `packages/core/src/core/client.ts` (method declared at line 762)
   - Implementation (verified):
     1. Returns early if `historyItems.length === 0` (line 769)
     2. Calls `this.lazyInitialize()` if `this.contentGenerator` is falsy (line 777) — this may do auth
     3. Creates chat via `this.startChat([])` if `this.hasChatInitialized()` is false (line 791)
     4. Gets `HistoryService` via `this.getHistoryService()` (line 801)
     5. Calls `historyService.validateAndFix()` (line 810) — fixes orphaned tool calls
     6. Calls `historyService.addAll(historyItems)` (line 813)

2. **UI History** (`useHistory` hook → `HistoryItem[]` → rendered in terminal)
   - Entry point: `loadHistory(newHistory: HistoryItem[])` in `packages/cli/src/ui/hooks/useHistoryManager.ts` (line 76)
   - Implementation: calls `setHistory(trimHistory(newHistory, limitsRef.current))` — replaces entire UI history state
   - The UI uses `HistoryItem` types (defined in `packages/cli/src/ui/types.ts`), NOT `IContent`

### Critical: `HistoryService.addAll()` Emits Events

**Verified in `HistoryService.ts`**:
- `addAll()` (line 456): iterates and calls `this.add(content, modelName)` for each item
- `add()` (line 260): if not compressing, calls `addInternal()` (line 275)
- `addInternal()` (line 278): pushes to `this.history`, then calls `this.emit('contentAdded', content)` (line 305)

**Conclusion**: Every item added via `addAll()` emits a `contentAdded` event. If `RecordingIntegration` is subscribed at that point, it will call `this.recording.recordContent(content)` (RecordingIntegration.ts line 53), causing every restored item to be re-recorded to JSONL.

---

## Call-Order Trace: Subscription Timing Proof

### Interactive Mode — Full Call Trace

```
gemini.tsx main() [async function]
│
├── [line 896] const continueRef = config.getContinueSessionRef()
├── [line 898] resumeResult = await resumeSession({...})
├── [line 906-907] recordingService = resumeResult.recording
│    ⬆ resumeResult.history is UNUSED today — this plan captures it
│
├── [line 938] recordingIntegration = new RecordingIntegration(recordingService)
│    ⬆ Constructor only stores the recording ref.
│    ⬆ RecordingIntegration.subscribeToHistory() is NOT called here.
│    ⬆ RecordingIntegration.historySubscription is null.
│
├── [NEW — this plan] await geminiClient.restoreHistory(resumedHistory)
│    ├── GeminiClient.restoreHistory() [client.ts line 762]
│    │   ├── lazyInitialize() → creates contentGenerator
│    │   ├── this.startChat([]) → creates GeminiChat with new HistoryService
│    │   ├── historyService.validateAndFix()
│    │   └── historyService.addAll(historyItems)
│    │       ├── For each item: historyService.add(item)
│    │       │   └── addInternal(item) → this.emit('contentAdded', item)
│    │       │       ⬆ No listeners registered yet → event is a no-op
│    │       └── Done.
│    └── Returns.
│
├── [line 1130-1137] await startInteractiveUI(config, settings, ...)
│    ├── [line 280] render(<AppWrapper .../>)
│    │   React synchronously mounts component tree.
│    │   useEffect callbacks are QUEUED, not executed yet.
│    │
│    │   After render completes, React runs queued effects:
│    │   ├── AppContainer useEffect [line 406-432]:
│    │   │   setInterval(100ms) → polls geminiClient.hasChatInitialized()
│    │   │   On first successful poll (100ms after mount):
│    │   │   └── recordingIntegration.onHistoryServiceReplaced(historyService)
│    │   │       └── RecordingIntegration.subscribeToHistory(historyService)
│    │   │           ├── historyService.on('contentAdded', onContentAdded)
│    │   │           ├── historyService.on('compressionStarted', ...)
│    │   │           └── historyService.on('compressionEnded', ...)
│    │   │       ⬆ FROM THIS POINT, new contentAdded events are recorded.
│    │   │       ⬆ The restored items were added BEFORE this subscription.
│    │   │       ⬆ Therefore: NO double-recording.
│    │   │
│    │   └── Other useEffects...
│    └── Returns (blocks until ink instance exits)
```

**Timing guarantee**: `restoreHistory()` is `await`ed in `main()` (an async function) BEFORE `startInteractiveUI()` is called. `startInteractiveUI()` calls `render()` which mounts React synchronously. `useEffect` callbacks run asynchronously AFTER the first render. The 100ms polling interval in `AppContainer` (line 410, `setInterval(..., 100)`) means the earliest possible subscription is ~100ms after mount. The `restoreHistory()` call completes well before that.

**Test to prove it**: See Test 3 in the Test Plan section. Uses real `HistoryService` + real `RecordingIntegration`: adds items before subscription, subscribes, adds items after — asserts only post-subscription items are recorded.

### Non-Interactive Mode — Full Call Trace

```
gemini.tsx main() [async function]
│
├── Same resume block — same recordingService + recordingIntegration creation
├── [NEW] await geminiClient.restoreHistory(resumedHistory)
│    (same as interactive — adds to HistoryService, events fire, no listeners)
│
├── [line 1130] if (config.isInteractive()) → FALSE for non-interactive
├── [line 1158] nonInteractiveConfig = await validateNonInteractiveAuth(...)
├── [line 1165] await runNonInteractive({config, settings, input, prompt_id})
│    └── packages/cli/src/nonInteractiveCli.ts
│        ⬆ DOES NOT import or reference RecordingIntegration
│        ⬆ DOES NOT call subscribeToHistory or onHistoryServiceReplaced
│        ⬆ Therefore: RecordingIntegration NEVER subscribes in non-interactive mode
│
└── recordingIntegration.dispose() is called in cleanup (line 941)
```

**Non-interactive subscription behavior — RESOLVED**:
- `RecordingIntegration` is created in `main()` (line 938) for BOTH paths.
- In interactive mode, `AppContainer` subscribes it via the polling `useEffect` (line 406-432).
- In non-interactive mode, `runNonInteractive()` (in `nonInteractiveCli.ts`) does NOT subscribe `RecordingIntegration` to `HistoryService`. There is NO import of `RecordingIntegration` or `HistoryService` in that file.
- **Consequence**: In non-interactive `--prompt --continue` mode, the model context IS restored (via `restoreHistory()`), so the AI sees prior conversation. But new content generated in the non-interactive turn is NOT recorded to JSONL via the `RecordingIntegration` event bridge. This is a **pre-existing limitation** unrelated to this remediation. The non-interactive path uses `geminiClient.sendMessageStream()` directly, which goes through `GeminiChat.generateContentStream()` → `HistoryService.add()` → emits `contentAdded`, but nobody is listening.
- **Impact on this plan**: Zero. We do NOT introduce any new behavior for non-interactive recording. We only add `restoreHistory()` which populates the model context so the AI can see prior conversation. No double-write risk because nobody subscribes.
- **For UI**: Non-interactive mode has no React UI, so no `loadHistory()` call is needed. Output goes to stdout.

---

## IContent → HistoryItem Mapping Specification (Lossy)

> **Note**: This mapping is intentionally lossy. Several block types (media, thinking-only turns) are dropped because they have no meaningful terminal UI representation for restored history. The section title reflects this: the mapping covers all IContent block types but does not preserve all information. Lossy cases are marked explicitly in the mapping table below.

### Source Types (IContent — `packages/core/src/services/history/IContent.ts`)

```typescript
interface IContent {
  speaker: 'human' | 'ai' | 'tool';
  blocks: ContentBlock[];
  metadata?: ContentMetadata;
}

type ContentBlock = TextBlock | ToolCallBlock | ToolResponseBlock | MediaBlock | ThinkingBlock | CodeBlock;
```

**Block types** (all from `IContent.ts`):
| Block Type | Interface | Key Fields |
|---|---|---|
| `text` | `TextBlock` | `text: string` |
| `tool_call` | `ToolCallBlock` | `id: string`, `name: string`, `parameters: unknown`, `description?: string` |
| `tool_response` | `ToolResponseBlock` | `callId: string`, `toolName: string`, `result: unknown`, `error?: string`, `isComplete?: boolean` |
| `media` | `MediaBlock` | `mimeType: string`, `data: string`, `encoding: 'url' | 'base64'`, `caption?: string` |
| `thinking` | `ThinkingBlock` | `thought: string`, `isHidden?: boolean`, `sourceField?: string`, `signature?: string`, `encryptedContent?: string` |
| `code` | `CodeBlock` | `code: string`, `language?: string` |

### Target Types (HistoryItem — `packages/cli/src/ui/types.ts`)

Key variants for resume display:
| Type | Interface | Key Fields |
|---|---|---|
| `'user'` | `HistoryItemUser` | `text: string` |
| `'gemini'` | `HistoryItemGemini` | `text: string`, `model?: string`, `thinkingBlocks?: ThinkingBlock[]` |
| `'tool_group'` | `HistoryItemToolGroup` | `tools: IndividualToolCallDisplay[]`, `agentId?: string` |
| `'info'` | `HistoryItemInfo` | `text: string` |

> **Note on `gemini` vs `gemini_content`**: The UI type system defines both `HistoryItemGemini` (type: `'gemini'`) and `HistoryItemGeminiContent` (type: `'gemini_content'`) in `types.ts` (lines 76-88). They are structurally identical (`text`, `model?`, `thinkingBlocks?`), but they render differently: `gemini_content` is used during live streaming to show incremental/truncated AI output, while `gemini` is used for committed, complete history entries. For restored history, `gemini` is the correct choice because all replayed entries are complete — they were finalized and committed to JSONL before the session ended.

`IndividualToolCallDisplay` (types.ts line 48):
```typescript
interface IndividualToolCallDisplay {
  callId: string;
  name: string;
  description: string;
  resultDisplay: ToolResultDisplay | undefined;  // string | FileDiff | FileRead | AnsiOutput
  status: ToolCallStatus;
  confirmationDetails: ToolCallConfirmationDetails | undefined;
  renderOutputAsMarkdown?: boolean;
  isFocused?: boolean;
  ptyId?: number;
}
```

### Complete Mapping Table

| IContent speaker | Block types present | → HistoryItem type | Conversion logic |
|---|---|---|---|
| `human` | `text` | `HistoryItemUser` | Concatenate all `TextBlock.text` with `\n`. Set `type: 'user'`. |
| `human` | `media` | *(intentionally skipped — lossy)* | Media blocks in human messages have no terminal UI representation for resume. This is a deliberate lossy conversion. |
| `ai` | `text` only | `HistoryItemGemini` | Concatenate all `TextBlock.text` with `\n`. Set `type: 'gemini'`, `model: metadata?.model`. |
| `ai` | `text` + `thinking` | `HistoryItemGemini` | Text as above. Attach `thinkingBlocks` array from `ThinkingBlock` items. |
| `ai` | `tool_call` only | `HistoryItemToolGroup` | Each `ToolCallBlock` → one `IndividualToolCallDisplay`. Look up response from `tool` speaker entries. |
| `ai` | `text` + `tool_call` | `HistoryItemGemini` + `HistoryItemToolGroup` | Split into two items: one `gemini` for text (+ thinking), one `tool_group` for tool calls. |
| `ai` | `thinking` only | *(intentionally skipped — lossy)* | Pure thinking without text produces no visible UI item. ThinkingBlocks are only shown attached to gemini text items. This is a deliberate lossy conversion: thinking-only turns have no user-visible representation in the terminal UI. |
| `ai` | `code` | `HistoryItemGemini` | Wrap as markdown code block: `` ```{language}\n{code}\n``` ``. Treated as text. |
| `ai` | `media` | *(intentionally skipped — lossy)* | AI media blocks (images) have no terminal representation for resume. This is a deliberate lossy conversion: the terminal cannot render images. |
| `tool` | `tool_response` | *(merged)* | Not emitted as standalone items. Responses are matched by `callId` and merged into the preceding `HistoryItemToolGroup`'s `IndividualToolCallDisplay.resultDisplay` and `.status`. The `isComplete` field on `ToolResponseBlock` (IContent.ts line 147) is intentionally ignored: all replayed tool responses in JSONL history are complete (they were committed to the recording after the tool finished). Partial/streaming tool responses are never persisted to JSONL. |
| *(any)* | empty blocks | *(skipped)* | No UI item produced. |

### Tool Response Matching Logic

1. **First pass**: Scan all `IContent` with `speaker === 'tool'`, extract all `ToolResponseBlock` entries. Build a `Map<callId, { result, error }>`.
   - `error` field: `ToolResponseBlock.error?: string` (NOT `isError` — the old plan was wrong about this).
   - If `error` is truthy → `ToolCallStatus.Error`, else `ToolCallStatus.Success`.
2. **Second pass**: When processing `ai` speaker with `tool_call` blocks, look up each `ToolCallBlock.id` in the response map.
   - If found: set `resultDisplay` to stringified `result`, set `status` based on `error`.
   - If not found (orphaned call): set `status: ToolCallStatus.Pending`, `resultDisplay: undefined`. Using `Pending` (not `Success`) makes it visually clear the tool result is missing rather than implying the tool succeeded.

### Golden Test Data

```typescript
// Input: Full conversation with text + tool call + tool response + thinking
const goldenInput: IContent[] = [
  // Turn 1: User says hello
  { speaker: 'human', blocks: [{ type: 'text', text: 'Hello, read foo.txt' }] },
  // Turn 2: AI thinks, responds with text, then calls a tool
  {
    speaker: 'ai',
    blocks: [
      { type: 'thinking', thought: 'User wants to read a file', sourceField: 'thought' },
      { type: 'text', text: 'Let me read that file for you.' },
      { type: 'tool_call', id: 'call-1', name: 'read_file', parameters: { path: '/foo.txt' } },
    ],
    metadata: { model: 'gemini-2.5-pro' },
  },
  // Turn 3: Tool response
  {
    speaker: 'tool',
    blocks: [
      { type: 'tool_response', callId: 'call-1', toolName: 'read_file', result: 'file contents here' },
    ],
  },
  // Turn 4: AI follow-up with code block
  {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: 'Here is the file content.' },
      { type: 'code', code: 'const x = 1;', language: 'typescript' },
    ],
    metadata: { model: 'gemini-2.5-pro' },
  },
];

// Expected output: 5 HistoryItems
// [0] HistoryItemUser: { type: 'user', text: 'Hello, read foo.txt' }
// [1] HistoryItemGemini: { type: 'gemini', text: 'Let me read that file for you.',
//        model: 'gemini-2.5-pro', thinkingBlocks: [{ type: 'thinking', thought: 'User wants to read a file', sourceField: 'thought' }] }
// [2] HistoryItemToolGroup: { type: 'tool_group', tools: [{
//        callId: 'call-1', name: 'read_file', description: 'read_file',
//        resultDisplay: 'file contents here', status: 'Success',
//        confirmationDetails: undefined }] }
// [3] HistoryItemGemini: { type: 'gemini', text: 'Here is the file content.\n\n```typescript\nconst x = 1;\n```',
//        model: 'gemini-2.5-pro' }
```

---

## Implementation Plan

### Change 1: Capture and Seed Model History in `gemini.tsx`

### Anchor-based edit guidance (execution reliability)

Do not rely on line numbers alone during implementation. Use the following stable anchors:

- `packages/cli/src/gemini.tsx`
  - Anchor A: `const continueRef = config.getContinueSessionRef();`
  - Anchor B: `const recordingIntegration = new RecordingIntegration(recordingService);`
  - Anchor C: `await startInteractiveUI(` call near the interactive branch.
- `packages/cli/src/ui/App.tsx`
  - Anchor A: `interface AppProps {`.
- `packages/cli/src/ui/AppContainer.tsx`
  - Anchor A: `interface AppContainerProps {`.
  - Anchor B: `const { history, addItem, clearItems, loadHistory } = useHistory(historyLimits);`
- `packages/cli/src/ui/utils/iContentToHistoryItems.ts`
  - Anchor A: `function safeToolResultToString(result: unknown): string`.
  - Anchor B: `export function iContentToHistoryItems(contents: IContent[]): HistoryItem[]`.
- `packages/core/src/recording/RecordingIntegration.test.ts`
  - Anchor A: `describe('Core subscription behavior` block.


**File**: `packages/cli/src/gemini.tsx`
**Function**: `main()` (the top-level async function)
**Location**: The `if (continueRef)` block, starting around line 893

**What**:
1. Add `let resumedHistory: IContent[] | null = null;` before the `if (continueRef)` block.
2. Inside the `if (resumeResult.ok)` branch, capture `resumedHistory = resumeResult.history;`.
3. After the recording service creation block and `new RecordingIntegration(...)` (line 938), add a history seeding block that calls `await geminiClient.restoreHistory(resumedHistory)`.

**Import needed**: Add `type IContent` to the existing core import. `IContent` is re-exported from `@vybestack/llxprt-code-core` via `export * from './services/history/IContent.js'` (core `index.ts` line 245).

**Code change** — after the recording service creation block (after line 936, before line 938):

```typescript
  // Before the `new RecordingIntegration(...)` line, we have:
  let resumedHistory: IContent[] | null = null;
  // ... (captured inside the resumeResult.ok branch)

  // After recordingIntegration creation (line 938) and before startInteractiveUI:
  if (resumedHistory && resumedHistory.length > 0) {
    try {
      const geminiClient = config.getGeminiClient();
      if (geminiClient) {
        await geminiClient.restoreHistory(resumedHistory);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        chalk.yellow(`Could not restore conversation history: ${message}`),
      );
    }
  }
```

**Why this works**:
- `restoreHistory()` calls `HistoryService.addAll()` which emits `contentAdded` events
- `RecordingIntegration` is created at line 938 but NOT subscribed — its `historySubscription` is null
- Subscription only happens in `AppContainer`'s `useEffect` (line 406-432), which runs after `render()` inside `startInteractiveUI()`
- Therefore all events from `restoreHistory()` fire with zero listeners → no double-recording

### Change 2: Thread `resumedHistory` Through to UI

**File**: `packages/cli/src/gemini.tsx`
**Function**: `startInteractiveUI()` — add `resumedHistory?: IContent[]` parameter (currently at line 250)

**Call site**: In `main()`, where `startInteractiveUI()` is called (line 1131), pass `resumedHistory ?? undefined`.

**Render site**: In `startInteractiveUI()`, pass `resumedHistory` as prop to `<AppWrapper>` (line 284).

**File**: `packages/cli/src/ui/App.tsx`
**Interface**: `AppProps` (line 25) — add `resumedHistory?: IContent[]`. Import `type IContent` from `@vybestack/llxprt-code-core`.

**Prop threading**: `AppWrapper` (line 49) already spreads `{...props}` to `<AppWithState>`, which spreads `{...props}` to `<AppContainer>`. No functional change needed in either component — the spread handles it automatically.

**File**: `packages/cli/src/ui/AppContainer.tsx`
**Interface**: `AppContainerProps` (line 145) — add `resumedHistory?: IContent[]`. Import `type IContent` from `@vybestack/llxprt-code-core`.

**Destructure**: In `AppContainer` (line 169), add `resumedHistory` to the destructured props.

**UI restoration effect** — add after the `useHistory` call (line 198) and before `useMemoryMonitor` (line 200):

```typescript
  const hasSeededResumedHistory = useRef(false);
  useEffect(() => {
    if (hasSeededResumedHistory.current) return;

    if (!resumedHistory || resumedHistory.length === 0) {
      hasSeededResumedHistory.current = true;
      return;
    }

    const uiItems = iContentToHistoryItems(resumedHistory);
    if (uiItems.length > 0) {
      loadHistory(uiItems);
    }

    hasSeededResumedHistory.current = true;
  }, [loadHistory, resumedHistory]);
```

This explicit ref guard is required to keep seeding idempotent under React StrictMode double-invocation in development.

### Change 3: `iContentToHistoryItems()` Conversion Function

**File**: New file `packages/cli/src/ui/utils/iContentToHistoryItems.ts`

**Why a new file**: The function is ~80 lines, has no React dependencies, and needs dedicated unit tests. Putting it in `AppContainer.tsx` (a 2269-line file) would make it harder to test and maintain.

**Imports**: `IContent`, `TextBlock`, `ToolCallBlock`, `ThinkingBlock`, `CodeBlock` from `@vybestack/llxprt-code-core`. `HistoryItem`, `HistoryItemToolGroup`, `IndividualToolCallDisplay`, `ToolCallStatus` from `../types.js`.

**Algorithm**:

```typescript
export function iContentToHistoryItems(contents: IContent[]): HistoryItem[] {
  const items: HistoryItem[] = [];
  let idCounter = -Date.now(); // Negative IDs to avoid collision with normal IDs

  // First pass: collect all tool responses by callId
  const responseMap = new Map<string, { result: unknown; error?: string }>();
  for (const content of contents) {
    if (content.speaker === 'tool') {
      for (const block of content.blocks) {
        if (block.type === 'tool_response') {
          responseMap.set(block.callId, {
            result: block.result,
            error: block.error,
          });
        }
      }
    }
  }

  // Second pass: build UI items
  for (const content of contents) {
    if (content.speaker === 'human') {
      const text = content.blocks
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      if (text) {
        items.push({ id: idCounter--, type: 'user', text });
      }
      continue;
    }

    if (content.speaker === 'ai') {
      const textBlocks = content.blocks.filter((b): b is TextBlock => b.type === 'text');
      const toolCallBlocks = content.blocks.filter((b): b is ToolCallBlock => b.type === 'tool_call');
      const thinkingBlocks = content.blocks.filter((b): b is ThinkingBlock => b.type === 'thinking');
      const codeBlocks = content.blocks.filter((b): b is CodeBlock => b.type === 'code');

      // Build text from text blocks + code blocks
      const textParts: string[] = textBlocks.map((b) => b.text);
      for (const cb of codeBlocks) {
        const lang = cb.language || '';
        textParts.push(`\`\`\`${lang}\n${cb.code}\n\`\`\``);
      }
      const combinedText = textParts.join('\n');

      // Emit gemini item for text/thinking/code content
      if (combinedText) {
        items.push({
          id: idCounter--,
          type: 'gemini',
          text: combinedText,
          model: content.metadata?.model,
          ...(thinkingBlocks.length > 0 ? { thinkingBlocks } : {}),
        });
      }

      // Emit tool_group for tool calls
      if (toolCallBlocks.length > 0) {
        const tools: IndividualToolCallDisplay[] = toolCallBlocks.map((tc) => {
          const response = responseMap.get(tc.id);
          return {
            callId: tc.id,
            name: tc.name,
            description: tc.description || tc.name,
            resultDisplay: response
              ? safeToolResultToString(response.result)
              : undefined,
            status: response
              ? response.error
                ? ToolCallStatus.Error
                : ToolCallStatus.Success
              : ToolCallStatus.Pending,
            confirmationDetails: undefined,
          };
        });
        items.push({ id: idCounter--, type: 'tool_group', tools });
      }
      continue;
    }

    // speaker === 'tool': already processed via responseMap — no standalone UI item
  }

  return items;
}
```

**Key design decisions**:
- **ID generation**: Uses negative timestamps to avoid collision with the `useHistory` hook's positive timestamp-based IDs (generated by `getNextMessageId` in `useHistoryManager.ts` line 71: `baseTimestamp * 1000 + globalMessageIdCounter`).
- **ThinkingBlocks**: Passed through directly as `ThinkingBlock[]` (same type used by `HistoryItemGemini.thinkingBlocks` per types.ts line 80). Only attached to `gemini` items that have text content.
- **CodeBlocks**: Converted to markdown fenced code blocks and appended to text, since `HistoryItemGemini` only has a `text` field — there's no separate code display type.
- **MediaBlocks**: Silently skipped for both human and AI. Terminal UI has no media rendering for static history items.
- **Tool responses**: ToolResponseBlock uses `error?: string` (NOT `isError: boolean`). If `error` is truthy, status is `Error`; otherwise `Success`.
- **resultDisplay**: `IndividualToolCallDisplay.resultDisplay` is typed as `ToolResultDisplay | undefined` where `ToolResultDisplay = string | FileDiff | FileRead | AnsiOutput` (from `packages/core/src/tools/tools.ts` line 642). For resume, we always produce `string` (either directly if the result is already a string, or via `JSON.stringify`). This is type-safe because `string` is one of the union members. The structured types (`FileDiff`, `FileRead`, `AnsiOutput`) are only produced during live tool execution by the tool implementations themselves — they are never serialized to JSONL. When replaying from JSONL, `result` is always a JSON-deserialized value (string, number, object, etc.), so stringifying it to `string` is the correct representation for restored history.

---

## Test Plan

### Test 1: Unit Tests for `iContentToHistoryItems()`

**File**: `packages/cli/src/ui/utils/iContentToHistoryItems.test.ts` (new file)

| Test Case | Input | Expected Output |
|---|---|---|
| Human text → user | `[{ speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] }]` | `[{ type: 'user', text: 'Hello' }]` |
| AI text → gemini | `[{ speaker: 'ai', blocks: [{ type: 'text', text: 'Hi!' }], metadata: { model: 'claude-4' } }]` | `[{ type: 'gemini', text: 'Hi!', model: 'claude-4' }]` |
| AI text + thinking → gemini with thinkingBlocks | `[{ speaker: 'ai', blocks: [{ type: 'thinking', thought: 'hmm' }, { type: 'text', text: 'Answer' }] }]` | `[{ type: 'gemini', text: 'Answer', thinkingBlocks: [{ type: 'thinking', thought: 'hmm' }] }]` |
| AI tool_call + tool response → tool_group with result | `[{ speaker: 'ai', blocks: [{ type: 'tool_call', id: 'c1', name: 'read_file', parameters: {} }] }, { speaker: 'tool', blocks: [{ type: 'tool_response', callId: 'c1', toolName: 'read_file', result: 'content' }] }]` | `[{ type: 'tool_group', tools: [{ callId: 'c1', name: 'read_file', resultDisplay: 'content', status: 'Success' }] }]` |
| AI text + tool_call → gemini + tool_group | Two items produced from one IContent | Gemini item first, tool_group second |
| AI code block → gemini with markdown | `[{ speaker: 'ai', blocks: [{ type: 'code', code: 'x=1', language: 'python' }] }]` | `[{ type: 'gemini', text: '```python\nx=1\n```' }]` |
| Tool error response → Error status | Response with `error: 'Permission denied'` | `status: 'Error'` |
| Empty input → empty output | `[]` | `[]` |
| Orphan tool response (no matching call) → skipped | Only `speaker: 'tool'` with no matching `ai` `tool_call` | `[]` |
| Golden test data | Full multi-turn conversation (see Golden Test Data above) | Exact expected output as specified |

### Test 2: Recording Non-Duplication (Behavioral)

**File**: `packages/core/src/recording/RecordingIntegration.test.ts` (extend existing)

**Test**: "does not record content added to HistoryService before subscription"

```
Setup:
  1. Create real HistoryService
  2. Create real SessionRecordingService (writes to temp dir)
  3. Create RecordingIntegration(recordingService)

Act:
  4. historyService.add({ speaker: 'human', blocks: [{ type: 'text', text: 'restored' }] })
     → This emits contentAdded, but nobody is listening
  5. recordingIntegration.subscribeToHistory(historyService)
     → NOW the listener is attached
  6. historyService.add({ speaker: 'human', blocks: [{ type: 'text', text: 'new message' }] })
     → This emits contentAdded, listener fires, records to JSONL

Assert:
  7. Read JSONL file from temp dir
  8. Count content events: exactly 1 (the "new message")
  9. The "restored" message is NOT in the JSONL
```

This test uses the **same real-service pattern** as the existing `RecordingIntegration.test.ts` (which uses real `HistoryService`, real `SessionRecordingService` writing to temp dirs, real `replaySession` for round-trip validation — see test file lines 1-46).

### Test 3: Existing Tests Pass Unchanged

All existing tests in `packages/cli/src/ui/hooks/useSessionRestore.test.ts` (lines 1-150) verify that `resetChat()` + `historyService.addAll()` works. These continue to pass because `restoreHistory()` internally calls the same path.

---

## Verification Checklist

Each item is tied to a specific test and expected observable output:

| # | Claim | Test | Expected Observable |
|---|---|---|---|
| 1 | Model context is restored on `--continue` | Smoke Test 1 (below) | AI references prior conversation content when asked "what was the haiku about?" |
| 2 | UI displays prior messages on interactive resume | Smoke Test 2 (below) | Terminal shows previous messages before new input prompt |
| 3 | No duplicate JSONL entries on resume | Test 2 (recording non-duplication) | JSONL file has exactly 1 content event (the new message), not 2 |
| 4 | All IContent block types handled | Test 1 (golden test + per-type cases) | Each block type produces correct HistoryItem variant |
| 5 | Empty history is a no-op | Test 1 (empty input case) + `restoreHistory()` early return (client.ts line 769) | No crash, no UI change, session starts fresh |
| 6 | `restoreHistory()` failure is non-fatal | Existing `useSessionRestore.test.ts` test "continues session restore even if resetChat fails" (line 118) | Warning printed, session continues without history |
| 7 | Non-interactive mode gets model context | Smoke Test 3 (below) | Non-interactive `--prompt --continue "what was it about?"` produces coherent response |
| 8 | TypeScript compiles cleanly | `npm run typecheck` | Zero errors |
| 9 | All tests pass | `npm run test` | Zero failures |
| 10 | Code is formatted | `npm run format` | No changes |

---

## Smoke Test Procedures

### Smoke Test 1: Model context restored

```bash
# Create a session
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"

# Resume and ask about it
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key --continue "what was the haiku about?"

# EXPECTED: AI references the haiku topic, proving model has history context.
# FAILURE: AI says "I don't have any previous conversation context."
```

### Smoke Test 2: UI shows prior messages

```bash
# Start interactive, send a message, exit
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key
# Type: "Hello, my name is TestUser123"
# Wait for response, type /exit

# Resume interactively
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key --continue

# EXPECTED: Terminal displays "Hello, my name is TestUser123" and the AI's prior response
# before showing the input prompt.
# FAILURE: Empty conversation, only input prompt shown.
```

### Smoke Test 3: No double-recording

## Out of Scope / Known Limitation

- Non-interactive `--continue --prompt` mode is in scope only for **model context restoration**.
- Non-interactive recording bridge behavior is intentionally unchanged: this plan does not add `RecordingIntegration` subscription in non-interactive execution.
- If future work requires parity for non-interactive recording capture during resumed sessions, handle that as a separate issue.


```bash
# After Smoke Test 2, inspect the JSONL:
cat ~/.llxprt/chats/*/session-*.jsonl | grep '"type":"content"' | wc -l

# For a 1-turn session (user + AI), expect ~2 content events from original session.
# After resume with 1 new turn, expect ~2 more (new user + new AI).
# Total: ~4 content events.
# FAILURE: ~6+ events (the original 2 were re-recorded on resume).
```

### Smoke Test 4: Non-interactive resume

```bash
# Create session first (interactive or non-interactive)
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku about cats"

# Resume non-interactively
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key --continue --prompt "what was the haiku about?"

# EXPECTED: Output references cats/haiku, proving model sees prior history.
```

---

## Summary of Changes

| File | Change | Estimated Lines |
|---|---|---|
| `packages/cli/src/gemini.tsx` | Capture `resumedHistory` from `resumeResult`, call `restoreHistory()`, add `resumedHistory` param to `startInteractiveUI()`, pass to `<AppWrapper>` | ~25 lines |
| `packages/cli/src/ui/App.tsx` | Add `resumedHistory?: IContent[]` to `AppProps`, import `type IContent` | ~3 lines |
| `packages/cli/src/ui/AppContainer.tsx` | Add `resumedHistory` to `AppContainerProps` + destructure, import `type IContent`, add `useEffect` for UI restoration, import `iContentToHistoryItems` | ~12 lines |
| `packages/cli/src/ui/utils/iContentToHistoryItems.ts` | New file: conversion function | ~85 lines |
| `packages/cli/src/ui/utils/iContentToHistoryItems.test.ts` | New file: unit tests for conversion | ~150 lines |
| `packages/core/src/recording/RecordingIntegration.test.ts` | Extend: add non-duplication test | ~30 lines |

**Total**: ~305 lines across 6 files (4 production, 2 test). Zero changes to any recording/replay/core service code.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `restoreHistory()` throws due to auth not ready | Medium | Low | try/catch wrapping in gemini.tsx; non-fatal fallback; `restoreHistory()` itself throws descriptive errors (client.ts lines 781-783, 794-796) |
| Double-recording of restored items | **None** | N/A | Architectural guarantee: `restoreHistory()` `await`ed in `main()` before `startInteractiveUI()` → before `render()` → before `useEffect` → before polling interval fires → before `subscribeToHistory()`. Test 2 proves this. |
| UI conversion misses edge cases | Low | Low | Golden test covers multi-block mixed turns. Code/media blocks degrade gracefully (code → markdown, media → skipped). Thinking blocks → attached to gemini items per existing pattern. |
| Non-interactive `--prompt --continue` | **None** | N/A | `restoreHistory()` runs before `runNonInteractive()`. No `RecordingIntegration` subscription in non-interactive path (verified: `nonInteractiveCli.ts` has zero references to `RecordingIntegration`). |
| ID collision between restored and new items | **None** | N/A | Restored items use negative IDs (from `-Date.now()`); normal items use positive IDs (from `baseTimestamp * 1000 + counter`). No overlap possible. |
| Prop threading breaks existing types | Low | Low | `resumedHistory` is optional (`?:`). Spread-based threading in `App.tsx` already works for `recordingIntegration` (same pattern). `npm run typecheck` catches any drift. |
