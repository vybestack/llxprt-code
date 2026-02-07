# Session Resume Research — LLxprt vs upstream (6893d2744)

Date: 2026-01-28

## 1) LLxprt current session persistence + restore

### Files examined
- `packages/core/src/storage/SessionPersistenceService.ts` (session save/load)
- `packages/cli/src/gemini.tsx` (startup + `--continue` loading)
- `packages/cli/src/ui/AppContainer.tsx` (UI + core history restore)
- `packages/core/src/core/client.ts` (GeminiClient + restoreHistory + init)
- `packages/core/src/config/config.ts` (GeminiClient lifecycle + auth)

### Session persistence
**File:** `packages/core/src/storage/SessionPersistenceService.ts`
- Defines `PersistedSession` (schema v1).  
- Saves/loads `history: IContent[]` and `uiHistory?: PersistedUIHistoryItem[]`.  
- Loads **most recent** session (timestamp-based filename), validates project hash + version.

Relevant lines:
- `PersistedSession` definition: **L63–L86**
- `save(...)`: **L134–L169**
- `loadMostRecent()`: **L175–L219**

### `--continue` entrypoint
**File:** `packages/cli/src/gemini.tsx`
- On startup, if `config.isContinueSession()` then loads the most recent session via `SessionPersistenceService` and emits a console message.

Relevant lines:
- `--continue` load: **L226–L266**

### UI + core history restore flow
**File:** `packages/cli/src/ui/AppContainer.tsx`
- **Part 1:** UI restore (immediate) from `restoredSession.uiHistory` or derived from `restoredSession.history`.  
- **Part 2:** Core history restore using `geminiClient.restoreHistory(restoredSession.history)`.

Relevant lines:
- UI restore: **L597–L684**
- Core restore: **L693–L747**

Current error surfaced in UI:
```ts
// AppContainer.tsx
addItem({
  type: 'error',
  text: 'Could not restore AI context - client not initialized.',
}, Date.now());
```
**Location:** `packages/cli/src/ui/AppContainer.tsx` **L702–L711**

### GeminiClient init + restore
**File:** `packages/core/src/core/client.ts`
- `restoreHistory()` (LLxprt P0 fix already present) tries:
  1) `lazyInitialize()` to ensure content generator.
  2) `startChat([])` to ensure chat exists.
  3) `getHistoryService()` then `addAll()`.

Relevant lines:
- `restoreHistory(...)`: **L778–L850**
- `lazyInitialize()`: **L308–L332**
- `getHistoryService()`: **L591–L603**
- `isInitialized()`: **L611–L613**

### Where the reported error message comes from
User reported:
```
!  Could not restore AI context - history service unavailable.
```

In the current codebase, the **exact** string is now:
```
Could not restore AI context - client not initialized.
```
from `AppContainer.tsx` **L702–L711** (when `config.getGeminiClient()` is undefined).  

However, the **“history service unavailable”** phrase still exists as a thrown error **inside `restoreHistory()`**:
```ts
throw new Error(
  'Cannot restore history: History service unavailable after chat initialization',
);
```
**Location:** `packages/core/src/core/client.ts` **L828–L832**

This suggests the reported message likely came from a **previous AppContainer version** that surfaced the error string from `restoreHistory()` directly (or from an older polling-based restore that logged “history service unavailable”). The current flow catches and surfaces a generic “AI context could not be loaded” message (see `AppContainer.tsx` **L723–L742**), but the underlying failure reason is still the history service being null.

---

## 2) Upstream commit 6893d2744 (gemini-cli) — session resume

### Upstream diff summary
**Command:** `git show 6893d2744 --stat`  
- Adds **resume/list/delete** CLI flags and a session browser/selector.
- Adds `GeminiClient.resumeChat(...)` and `GeminiChat` session resume integration.
- Adds UI hook `useSessionResume` to restore both UI and client history.
- Adds session utils and formatting (first message preview, relative time).

### Key upstream change: ensure chat initialized before restoring history
Upstream adds explicit `GeminiClient.resumeChat(...)` which **calls `startChat(...)`** and initializes chat **with history** before resuming:
```ts
// packages/core/src/core/client.ts (upstream)
async resumeChat(history: Content[], resumedSessionData?: ResumedSessionData) {
  this.chat = await this.startChat(history, resumedSessionData);
}
```
Upstream then calls `geminiClient.resumeChat(...)` before UI shows the restored history:
```ts
// packages/cli/src/ui/hooks/useSessionResume.ts (upstream)
config.getGeminiClient()?.resumeChat(clientHistory, resumedData);
```
This guarantees the history service exists because `startChat` constructs `GeminiChat`, which initializes `HistoryService` during construction.

**Net effect:** The client is fully initialized *before* attempting to restore history, preventing `getHistoryService()` from returning null.

---

## 3) P0/P1/P2 implementation plan for LLxprt

### P0: Fix “history service unavailable” on `--continue`
**Goal:** Ensure Gemini client + chat are initialized before restoring persisted history.

**Root cause (current flow):**
- `--continue` restores UI immediately, then calls `geminiClient.restoreHistory(...)`.
- If auth/content generator isn’t ready, `lazyInitialize()` fails and `restoreHistory()` throws.
- In earlier code paths, the UI surfaced **“history service unavailable”** when `getHistoryService()` stayed null.

**Exact code to change (LLxprt):**

1) **Ensure `GeminiClient` exists and is initialized before restore**
   - `packages/cli/src/ui/AppContainer.tsx` **L702–L717**
   - If `config.getGeminiClient()` is undefined, we should ensure `config.initialize()` has been called earlier in the startup sequence (it already is), and **call `config.refreshAuth(...)` first** if needed (auth not ready), or defer `restoreHistory` until authentication completes.

2) **Guarantee chat is initialized with history**
   - Adopt upstream pattern: add a `resumeChat` method that calls `startChat(history, resumedSessionData)`.
   - Call that instead of `restoreHistory` (which only patches HistoryService after the fact).

**Concrete code plan for P0 (minimal fix):**
- **Core:** add `resumeChat(history: Content[])` to `packages/core/src/core/client.ts` (if not already) that calls `startChat(history)`.
- **UI:** in `AppContainer.tsx` replace:
  ```ts
  geminiClient.restoreHistory(restoredSession.history)
  ```
  with:
  ```ts
  geminiClient.resumeChat(restoredSession.history)
  ```
- **Guard:** ensure authentication is completed before calling `resumeChat` (see `isAuthenticating` flags in UI flow). If still authenticating, defer restore until auth complete (similar to upstream’s `useSessionResume` hook logic).

**Simplest viable fix:** reuse current `restoreHistory()` but **ensure `config.refreshAuth(...)` has completed** before invoking it (so `lazyInitialize()` succeeds). That means **deferring core restore until auth is ready** in `AppContainer.tsx` and retrying once auth is completed.

### P1: Add `--list-sessions` and `--delete-session`
Mirror upstream CLI behavior:
- **CLI flags** in `packages/cli/src/config/config.ts` and `packages/cli/src/gemini.tsx`.
- **Session utilities** in `packages/cli/src/utils/sessionUtils.ts` to list sessions with ordering and metadata.
- `--delete-session` should delete a session file by index or UUID (prevent deleting current session).

### P1: Allow `--continue` to accept optional session index/UUID
- Extend CLI parsing to allow `--continue` to accept value: `--continue`, `--continue latest`, `--continue 3`, `--continue <uuid>`.
- Internally map `--continue` to session selection (same as upstream `--resume`).

### P2: Display session list with first message preview + relative time
- Extract first meaningful user message (truncate to ~100 chars). 
- Show relative time “N minutes/hours/days ago” (as upstream `formatRelativeTime`).
- Example output:
  ```
  1. Fix login bug (2 hours ago) [uuid]
  2. Explore prompt caching (3 days ago) [uuid]
  ```

---

## 4) P0 fix: exact initialization sequence + failure point

### Current initialization sequence (LLxprt)
1) `config.initialize()` creates a `GeminiClient` **without** content generator.  
   **File:** `packages/core/src/config/config.ts` **L813–L842**
2) `config.refreshAuth(...)` (async) creates `ContentGenerator` and config for the client.  
   **File:** `packages/core/src/config/config.ts` **L844–L945**
3) `GeminiClient.lazyInitialize()` (inside `restoreHistory`) creates content generator if it’s missing.  
   **File:** `packages/core/src/core/client.ts` **L308–L332**
4) `GeminiClient.startChat([])` creates `GeminiChat`, which creates `HistoryService`.  
   **File:** `packages/core/src/core/client.ts` **L175–L221**, `packages/core/src/core/geminiChat.ts` (constructor at instantiation).

### When `getHistoryService()` becomes non-null
- Only after `GeminiChat` is constructed (via `startChat` or `resumeChat`).
- In LLxprt, `getHistoryService()` returns `null` if `chat` is undefined.  
  **File:** `packages/core/src/core/client.ts` **L591–L603**

### Why it stays null for `--continue`
- If auth is not ready, `lazyInitialize()` fails, chat isn’t created.
- Consequently `getHistoryService()` remains null, causing restore failure (`Cannot restore history: History service unavailable after chat initialization`).

### Simplest fix to ensure history service is available
- **Delay core restore until after auth is ready** (i.e., after `refreshAuth` completes).  
- Alternatively, **resume chat by initializing chat with history** (upstream’s `resumeChat` pattern) rather than “restore after the fact”.

---

## 5) Current broken path + proposed fix snippet

### Current path (broken when auth not ready)
```ts
// packages/cli/src/ui/AppContainer.tsx
if (!geminiClient) {
  addItem({ type: 'error', text: 'Could not restore AI context - client not initialized.' }, Date.now());
  return;
}

geminiClient
  .restoreHistory(restoredSession.history)
  .catch(...);
```

### Proposed fix (resume chat + auth-ready guard)
```ts
// packages/cli/src/ui/AppContainer.tsx
if (!geminiClient || isAuthenticating) {
  return; // defer until auth completes
}

await geminiClient.resumeChat(restoredSession.history);
```

And in core:
```ts
// packages/core/src/core/client.ts
async resumeChat(history: IContent[]): Promise<void> {
  this.chat = await this.startChat(history);
}
```

This matches upstream’s approach and ensures `HistoryService` exists immediately after resume.

---

## 6) Summary
- LLxprt already includes a `restoreHistory()` that tries to initialize chat before adding history, but it still depends on auth being ready; if auth isn’t ready, restore fails.
- Upstream solved this by explicitly resuming the chat (initializing chat with history) and by sequencing resume after initialization.
- P0 fix: gate restore on auth readiness and/or use a `resumeChat` API that initializes chat with history in one step.

