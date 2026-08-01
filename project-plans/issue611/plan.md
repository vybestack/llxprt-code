# Issue #611 — Autoformat links to be clickable

## Problem statement (issue + comment thread)

The original issue is terse ("make any link clickable"). The comment thread
supersedes and expands it:

1. **LLM output links are not clickable.** Model/tool output is rendered by
   `MarkdownDisplay` → `InlineMarkdownRenderer`. That renderer recognizes bare
   `http(s)://` URLs and markdown `[label](url)` links, but emits both as plain
   coloured text. Only *file paths* are converted to OSC 8 hyperlinks
   (added by #2848).
2. **OAuth authorization links are not reliably clickable.** `OAuthUrlMessage`
   attaches the OSC 8 escape to a short `Click here to authorize with X` label.
   The label contains no URL, so if OSC 8 metadata is unsupported or stripped
   (tmux, older terminals, log capture) there is *no* click target at all.
3. **Long URLs get "borked" by wrapping.** The OAuth "Or copy this URL:" line
   is a plain `wrap="wrap"` `<Text>`; a Claude OAuth URL hard-wraps across four
   terminal rows, defeating both terminal URL auto-detection and copy/paste.

## Evidence gathered before implementation

Measured against real Ink 6.4.8 (not the vitest ink stub), rendering at
`columns: 100`:

- A plain long URL with `wrap="wrap"` is emitted as four separate rows with no
  link metadata — reproduces symptom 3.
- Ink's tokenizer (`@alcalzone/ansi-tokenize` via `measure-text` /
  `wrap-text`) understands BEL-terminated OSC 8: a link's escape bytes measure
  **zero width** (`stringWidth` of a 38-char label link is `38`).
- When a long OSC 8 *URL* link wraps, Ink **re-emits the complete hyperlink on
  every wrapped row** (verified: 4 rows, 8 OSC 8 sequences, each row's target
  is the full URL). So a wrapped URL-labelled link stays clickable on every
  fragment.

Conclusion: making the **visible URL itself** the link target fixes symptoms
2 and 3 simultaneously, and is robust in terminals without OSC 8 support
(the raw URL is still on screen for auto-detection/copy).

## Acceptance matrix

| ID | Accepted behavior | Verification |
| --- | --- | --- |
| AC-1 | A bare `http://` / `https://` URL in rendered markdown becomes an OSC 8 hyperlink whose target and visible label are both the URL. | `InlineMarkdownRenderer.test.ts` |
| AC-2 | A markdown `[label](url)` link with an `http(s)` target renders the label as an OSC 8 hyperlink to `url`; the visible `(url)` fallback is retained and is itself a hyperlink. | `InlineMarkdownRenderer.test.ts` |
| AC-3 | URLs with a non-`http(s)` scheme (`javascript:`, `data:`, `file:`, `vbscript:`, …) or containing ESC/BEL/other control characters are **not** linkified; they render as plain text. | `terminalLinks.test.ts`, `InlineMarkdownRenderer.test.ts` |
| AC-4 | Trailing sentence punctuation adjacent to a bare URL (`.` `,` `;` `:` `!` `?`, and an unbalanced `)`) is excluded from the link target but remains visible. | `InlineMarkdownRenderer.test.ts` |
| AC-5 | `OAuthUrlMessage` renders the full authorization URL as the primary OSC 8 link (target **and** label are the complete URL), so the URL is clickable and copyable. | `OAuthUrlMessage.test.tsx` |
| AC-6 | `OAuthUrlMessage` keeps a supplemental short "Click here to authorize with X" hyperlink and the existing mouse/selection tip; the provider extraction behavior is unchanged. | `OAuthUrlMessage.test.tsx` |
| AC-7 | OSC 8 escapes produced by `terminalLinks` are zero-width under the same width measurement Ink uses, so link text does not distort layout regardless of URL length. | `terminalLinks.test.ts` (`string-width`) |
| AC-8 | Link generation is BEL-terminated (Ink compatibility) and never emits a partially-formed escape. | `terminalLinks.test.ts` |

## Explicit non-goals

- **Not** fixing the `packages/cli` vitest Ink stub. `ink` is aliased to
  `test-utils/ink-stub.ts` while `ink-testing-library` drives the *real* Ink
  renderer, so component render frames are Ink error boxes. Tests follow the
  existing project convention (invoke the component/render function directly
  and assert on the produced React tree / emitted strings), as established by
  `InlineMarkdownRenderer.test.ts`.
- **Not** adding terminal-capability detection or a settings toggle for
  hyperlinks. The codebase already emits OSC 8 unconditionally for file paths
  and OAuth; this change follows that existing convention.
- **Not** changing existing file-path linkification behavior (#2848).
- **Not** linkifying bare hosts (`www.example.com`), email addresses, or
  `file://` URIs typed by the model.
- **Not** linkifying URLs in other UI surfaces (footer, update notices, tool
  output components) beyond the shared markdown rendering path.
- **Not** altering `escapeAnsiCtrlCodes` sanitization of model output.

## Bounded vertical slices

**Slice 1 — safe URL link primitive (`terminalLinks.ts`)**
- `isLinkableHttpUrl(candidate)`: `http:`/`https:` only, parses via `URL`,
  rejects any C0/C1 control character.
- `createUrlLink(url, label?)`: returns an OSC 8 link (label defaults to the
  URL) or `null` when the URL is not linkable.
- Reuses the existing `createOsc8Link` BEL-terminated helper.

**Slice 2 — markdown link rendering (`InlineMarkdownRenderer.tsx`)**
- Bare URL branch: split trailing punctuation, linkify the URL portion.
- Markdown-link branch: linkify the label and the visible `(url)` fallback.
- Falls back to today's plain-text rendering when `createUrlLink` returns
  `null`.

**Slice 3 — OAuth message (`OAuthUrlMessage.tsx`)**
- Full URL becomes the primary link (label = URL). Supplemental short label
  link retained. "Or copy this URL:" line becomes the linked URL itself.
- Replace the existing mock-theater tests with tests that invoke the component
  and assert the emitted escape bytes.

## Expected paths

- `packages/cli/src/ui/utils/terminalLinks.ts`
- `packages/cli/src/ui/utils/terminalLinks.test.ts`
- `packages/cli/src/ui/utils/InlineMarkdownRenderer.tsx`
- `packages/cli/src/ui/utils/InlineMarkdownRenderer.test.ts`
- `packages/cli/src/ui/components/messages/OAuthUrlMessage.tsx`
- `packages/cli/src/ui/components/messages/OAuthUrlMessage.test.tsx`
- `project-plans/issue611/plan.md`

## Scope ledger

| Item | Status |
| --- | --- |
| Planned files | 7 |
| Hard stop | 40 files / 2500 net lines |
| Review threshold | 25 files / 1500 net lines |
| Unplanned subsystem / public abstraction | none — stop for approval |
| Workflow / dependency / quality-tool change | none — stop for approval |
| Lint, complexity, suppression rules | unchanged; no new disables |
