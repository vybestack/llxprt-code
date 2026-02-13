# High Density Context — Functional Overview

**Issue**: #236
**Status**: Proposal

## Problem

Context compression is a heavy, lossy operation. Every time the LLM summarizes
conversation history, fidelity drops — the model loses nuance about why tasks
exist, what the user corrected, what was tried and failed, and what code actually
looks like. Meanwhile, a large portion of context space is consumed by tool
outputs that are either stale (a file was read and then rewritten) or redundant
(the same file was `@`-included twice). We can reclaim significant context space
through deterministic pruning *before* resorting to LLM summarization, and we
can make LLM summarization itself much smarter when it does run.

## Design Principles

1. **One active strategy** — the system runs a single configured compression
   strategy at a time, not a chain or cascade. This avoids coordination
   complexity, race conditions, and unpredictable interaction between strategies.

2. **Strategy declares its trigger** — each strategy declares whether it runs
   continuously (on every turn) or only at a token threshold. The orchestrator
   does not hardcode trigger behavior — it reads the strategy's declaration.

3. **Lazy batch optimization** — continuous strategies do not mutate history in
   event callbacks. Instead, optimization runs as a batch step at the natural
   read boundary (before the threshold check), avoiding re-entrancy and token
   count drift.

4. **Pluggable** — all strategies implement the same interface and register
   through the same factory. A new strategy only needs to declare its trigger
   mode and implement the appropriate methods.

---

## What a Strategy Is

Every compression strategy implements a common interface with two capabilities:

- **`optimize`** (optional) — deterministic, synchronous density optimization.
  Examines history and a configuration object (density toggles, workspace
  root) and returns surgical edits (remove or replace entries). Runs lazily
  before every threshold check. Strategies that only compress at threshold
  don't implement this.

- **`compress`** — the full compression operation. Receives the complete
  history context and returns a replacement history. Called when the token
  count exceeds the strategy's configured threshold.

Each strategy also declares a **trigger mode**:

- **`continuous`** — the strategy has an `optimize` method. The orchestrator
  calls it before every threshold check, so density improvements happen on
  every turn. If the optimized history is still over the threshold, `compress`
  runs as well.

- **`threshold`** — the strategy only runs `compress` when the token count
  exceeds the configured threshold. No per-turn optimization.

This means the `high-density` strategy can both prune continuously *and* do a
more aggressive strip-tool-responses compression when the threshold is hit —
all in one strategy, one configuration, no cascade.

---

## High Density Strategy — What It Does

The `high-density` strategy is a new strategy that registers alongside
`middle-out`, `top-down-truncation`, and `one-shot`. It declares
`trigger: continuous` and `requiresLLM: false`.

### Continuous Optimization (runs every turn)

When the orchestrator calls `optimize()`, the strategy examines the history
and returns removals/replacements:

**READ → WRITE Pair Pruning** — When a file is read by a tool and subsequently
written by a tool, the read's tool call and tool response are stale. The write
supersedes the content that was read. The strategy identifies these pairs and
marks the read call + response for removal. The write and any reads *after*
the write are preserved.

**Duplicate `@` File Inclusion Dedup** — When a user `@`-includes a file and
later `@`-includes the same file again, the earlier inclusion is stale. The
strategy marks the older inclusion content for removal, keeping only the
most recent.

**Tool Result Recency Pruning** (optional, off by default) — For tool types
that produce large outputs (shell commands, grep results, file reads, web
fetches), keep the last N results per tool type. Older tool response content is
replaced with a compact pointer: `"[Result pruned — re-run tool to retrieve]"`.
The tool *call* block is preserved so the model sees what was attempted.

### Threshold Compression (runs when over threshold)

If the optimized history still exceeds the token threshold, `compress()` runs.
This is a more aggressive pass:

- Strip tool response content beyond the recent tail, replacing full payloads
  with compact one-line summaries: tool name, key parameters, and outcome
  (success/error)
- Keep all tool *call* blocks and all human/AI message text intact
- Return the result as a new history — no LLM call needed

### Relationship to Other Strategies

| Strategy | LLM? | Trigger | Continuous opt? | Preserves conversation flow |
|----------|------|---------|-----------------|----------------------------|
| **high-density** | No | continuous | Yes | Yes — all messages kept, tool output trimmed |
| top-down-truncation | No | threshold | No | No — drops oldest messages |
| middle-out | Yes | threshold | No | Partial — summary + top/bottom literal |
| one-shot | Yes | threshold | No | Partial — summary + recent tail |

---

## Enriched Summarization Context

Independently of the high-density strategy, all LLM-based strategies benefit
from improvements to what they receive and produce during compression.

### Richer Compression Prompts

The current compression prompt asks for a `<state_snapshot>` with five
sections. This loses critical context in complex sessions. Proposed additions:

- **`<task_context>`** — For each active task or todo, explain *why* it exists,
  what user request originated it, what constraints apply, and what has been
  tried
- **`<user_directives>`** — Specific user feedback, corrections, and
  preferences that must be honored going forward
- **`<errors_encountered>`** — Errors hit, root causes, and resolutions —
  preventing the model from repeating mistakes
- **`<code_references>`** — Actual code snippets, exact file paths, and
  function signatures rather than prose descriptions

### Todo-Aware Summarization

When compression runs, active todo items are included as additional context.
The prompt instructs the model to explain the context behind each todo — why
it exists, what created it, and what progress was made. This bridges the gap
between the persistent todo list and the conversation context being compressed.

### Transcript Fallback Reference

After compression, a pointer to the full pre-compression conversation log is
included in the summary message, giving the model an escape hatch to re-read
original details if the summary is insufficient.

---

## Configuration Surface

- **`compression.strategy`** — existing setting, gains `'high-density'` as an
  option
- **`compression.density.readWritePruning`** — enable/disable READ→WRITE
  pruning (default: true when strategy is high-density)
- **`compression.density.fileDedupe`** — enable/disable `@` file dedup
  (default: true when strategy is high-density)
- **`compression.density.recencyPruning`** — enable/disable tool result
  recency pruning (default: false)
- **`compression.density.recencyRetention`** — results to keep per tool type
  (default: 3)

Existing settings (`compression.threshold`, `compression.profile`) continue
to work as before. The threshold applies to the high-density strategy's
`compress()` phase the same way it applies to other strategies.

---

## Expected Outcomes

- **Delayed compression** — continuous pruning keeps history lean, so the
  threshold is reached later in sessions
- **Reduced LLM compression frequency** — when high-density is the active
  strategy, compression is deterministic and free (no LLM call)
- **Better post-compression fidelity** — when LLM strategies do run, enriched
  prompts capture task rationale, user directives, and technical specifics
- **Todo continuity** — after compression, the model understands *why* each
  todo exists, not just that it's on the list
- **Pluggable architecture** — new strategies can declare continuous or
  threshold trigger and implement optimize/compress accordingly
