Fixes #611

## What was actually broken

The issue body is terse; the comment thread supersedes it with three concrete symptoms. All three are addressed.

**1. Links in model output were never clickable.**
Model and tool output renders through `MarkdownDisplay` → `InlineMarkdownRenderer`. That renderer already *detected* bare `http(s)://` URLs and markdown `[label](url)` links, but emitted both as plain coloured text. Only file paths became OSC 8 hyperlinks (added in #2854). Any apparent clickability came from the terminal's own URL auto-detection, not from LLxprt.

**2. The OAuth authorization link was not a reliable click target.**
`OAuthUrlMessage` attached the OSC 8 escape to a short `Click here to authorize with X` label that contains no URL. If OSC 8 metadata is unsupported or stripped, that label has no fallback at all — there is nothing for terminal URL detection to find and nothing to copy.

**3. Long authorization URLs were mangled by wrapping.**
The `Or copy this URL:` line was a plain `wrap="wrap"` Text. Rendered against real Ink at 100 columns, a Claude OAuth URL hard-wraps across four rows with no link metadata, defeating both auto-detection and copy/paste.

## Evidence gathered before implementing

Measured against real Ink 6.4.8 (not the vitest Ink stub), at `columns: 100`:

- A long plain URL with `wrap="wrap"` is emitted as four separate rows with no link metadata — reproduces symptom 3.
- Ink's tokenizer understands BEL-terminated OSC 8: the escape bytes measure **zero width** (a 38-character label link measures 38 under `string-width`).
- When a long OSC 8 link **whose label is the URL** wraps, Ink **re-emits the complete hyperlink on every wrapped row** (4 rows, 8 OSC 8 sequences, every row targeting the full URL).

That last point is the key insight: making the visible URL itself the link target fixes symptoms 2 and 3 at once, and degrades gracefully — in terminals without OSC 8 the raw URL is still on screen for auto-detection and copy.

## The change

**`terminalLinks.ts`** — two new helpers beside the existing `createOsc8Link` / `createFilePathLink`:

- `isLinkableHttpUrl(candidate)` — parses with the WHATWG `URL` constructor, requires an `http:` or `https:` protocol, and rejects any C0/C1 control character.
- `createUrlLink(url, label?)` — returns a BEL-terminated OSC 8 link (label defaults to the URL) or `null` when the URL or label is not safe to linkify.

Link targets and labels come from language-model output, which is genuinely untrusted third-party input, so validation lives here rather than at every call site. BEL termination is retained deliberately — Ink's tokenizer only recognises BEL-terminated links.

**`InlineMarkdownRenderer.tsx`**

- Bare URLs become OSC 8 hyperlinks with the URL as both target and label. Trailing sentence punctuation (`.` `,` `;` `:` `!` `?`, plus an unbalanced `)`) is excluded from the link target but stays visible, using a character-set scan rather than a backtracking-prone regex.
- Markdown `[label](url)` links become a single hyperlink covering `label (url)`, keeping the visible URL as the non-OSC-8 fallback.
- A markdown link whose URL was truncated by the tokenizer at an unbalanced `(` is deliberately **not** linkified — a truncated target would navigate somewhere the author did not write, which is worse than plain text.
- Non-`http(s)` schemes fall back to exactly today's plain-text rendering.

**`OAuthUrlMessage.tsx`** — the full authorization URL is now the primary click target (target *and* label are the complete URL), still wrapping so the whole URL stays visible and copyable. The short `Click here` link is retained as supplemental text and now also runs through `createUrlLink`, so a malformed authorization URL is never turned into a link. The `Or copy this URL:` guidance and the mouse/selection tip are unchanged.

## Verification

End-to-end proof from a real terminal — raw byte stream captured from a tmux pane via `pipe-pane` while the CLI rendered model output:

    See ESC]8;;https://example.com/docs BEL https://example.com/docs ESC]8;;BEL . for details

The URL is a genuine OSC 8 hyperlink, the label is the full URL, and the trailing period sits outside the link.

The OAuth component was rendered against real Ink and confirmed to emit the complete hyperlink on each of the four wrapped rows of a long Claude OAuth URL.

Tests are behavioral and assert the actual emitted escape bytes. Note that `packages/cli` aliases `ink` to a stub in vitest while `ink-testing-library` drives the real Ink renderer, so component render frames are Ink error boxes and are not faithful; tests therefore invoke the render functions directly and inspect the produced tree, following the convention already established in `InlineMarkdownRenderer.test.ts`. The previous `OAuthUrlMessage.test.tsx` was mock theater — it re-implemented the provider regex in the test file and never rendered the component — and has been replaced.

Local gates: `npm run format`, `npm run typecheck`, `npm run lint`, `npm run lint:eslint-guard`, `npm run build` all pass. Full `packages/cli` suite: 512 files, 6418 passed, 4 skipped. Smoke test passes.

## Reviews

Open Code Review and an independent TypeScript review were run. Every finding was triaged and all Blocker-Fix and In-scope-Fix findings are resolved, including the truncated-markdown-URL defect, a test helper that mistook the text between two links for a link body, misleading test names, and missing case-insensitivity and punctuation-visibility coverage.

## Non-goals

- Not fixing the `packages/cli` vitest Ink stub fidelity.
- No terminal-capability detection or settings toggle — the codebase already emits OSC 8 unconditionally for file paths and OAuth; this follows that convention.
- No change to file-path linkification, to `escapeAnsiCtrlCodes` sanitization, or to bare hosts / email addresses / `file://` URIs in model text.
