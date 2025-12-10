# Plan: OpenTUI Chat Interface

## Goals

- Build a terminal chat UI using **OpenTUI React** (React flavor only) with four bands: Header (1–5 lines), Scrollback (dominant), Input (multiline 1–10 lines), Status (1–3 lines).
- Support streaming responses into scrollback; user can scroll during/after streaming without the viewport snapping.
- Echo user input into scrollback, then clear input; trigger mock streaming responder emitting 5–800 philosophical lines (existential/nihilistic/hedonistic/Camus/Nietzsche).
- Default header text: `New UI Demo 20251204`.

## Constraints & Quality Gates

- Strong typing; no `any`; no lint/ts-ignore comments or rule disables.
- Lint with strict TypeScript config; enforce rule for no-disable comments.
- Complexity/size thresholds:
  - Cyclomatic (or similar): warn >15, error >30.
  - File length: warn >800 lines, error >1200 lines.
  - Function length: warn >80 lines, error >120 lines.

## Layout & Interaction

- Vertical layout: Header (top, fixed height within 1–5 lines, default text `New UI Demo 20251204`), Scrollback (fills remaining space), Input (bottom, grows up to 10 lines), Status (bottom-most or just below input within 1–3 lines).
- Scrollback view keeps a viewport offset; when user scrolls up, new stream lines append but viewport stays put until user jumps to bottom.
- Keybinds: scroll up/down, page up/down, jump to bottom, submit input; optional scroll-lock indicator in status.

## State Model

- Messages: role (user/system/stream), content as lines, timestamp, streaming flag.
- Scrollback: list of messages/lines, viewport offset, auto-follow boolean.
- Input: text buffer, cursor, line clamp to 1–10.
- Status: stream state (idle/streaming/done), scroll-lock indicator, prompt count (user submissions), responder word count, streaming vs waiting label.

## Implementation Steps

1. **Project setup**: initialize TypeScript OpenTUI React app; add strict tsconfig; add ESLint with no-disable enforcement and no-`any` rules; add scripts for lint/test. Configure complexity/file/function length rules to match thresholds.
2. **UI scaffold**: build OpenTUI layout with the four regions and sizing priorities; apply simple theme/colors; set default header text to `New UI Demo 20251204`.
3. **Input handling**: multiline input capture with submit; clamp to 1–10 lines; on submit, append user message to scrollback and clear buffer.
4. **Scrollback & viewport**: data structure to append lines/messages; render window based on viewport offset; auto-follow when at bottom; preserve viewport when user scrolls during streaming.
5. **Streaming mock**: generator producing 5–800 themed lines with small delays; append incrementally to scrollback; mark completion and update status.
6. **Status bar**: display stream state (streaming/waiting), scroll-lock indicator, prompt count, responder word count, and hints.
7. **Controls & UX**: keybinds for scroll/page, jump-to-bottom, submit; ensure redraws do not override manual scroll positions.
8. **Testing & checks**: add unit/interaction tests for input submission, streaming append, scroll-lock behavior, and status updates; run lint/complexity/size checks.

## Risks & Notes

- Keep functions/files within limits; refactor early to avoid threshold violations.
- Ensure streaming and scrollback updates are non-blocking to prevent UI freezes.
- No alternate UI libs; stay within OpenTUI primitives.\*\*\*
