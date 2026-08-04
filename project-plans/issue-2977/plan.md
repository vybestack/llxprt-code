# Issue 2977 — Document image generation and editing

## Goal

Ship user documentation for the image generation/editing feature. All three
user-facing surfaces are currently undocumented under `docs/`:

1. the `/image` slash command,
2. the `generate_image` tool the model can call,
3. the non-interactive `-I` / `-O` / `-P` flags.

Documentation only. No product-code behavior changes.

## Source of truth (verified against the implementation)

| Fact                        | Evidence                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Slash grammar               | `packages/cli/src/ui/commands/imageCommandTokenizer.ts` — `/image <output.png> [<input.png> ...] "<prompt>"`                          |
| Quoting rules               | same file — single/double quotes, backslash escape; a multiword prompt must be quoted, and so must any prompt used with input paths; `--` rejected; an unquoted token after a quoted one is a trailing-argument error |
| Max inputs                  | `IMAGE_MAX_INPUTS = 5`; `MAX_INPUT_IMAGES = 5` in `packages/core/src/services/image/imageOperation.ts`                                 |
| generate/edit selection     | zero inputs → generate; one to five → edit                                                                                            |
| Output rules                | `resolveOutputPath` — must end `.png`, resolved against workspace root, must stay inside the workspace, parent dirs created           |
| No overwrite                | `writeImageAtomically` publishes with `fs.link`; existing target fails with `Output file already exists (will not overwrite): <path>.` — detected at save time, after the provider call |
| Input rules                 | `resolveInputPaths` — local workspace paths only (no `http://`, `https://`, `file://`), `.png` extension **and** PNG signature, regular non-symlink file, 20 MiB cap |
| Tool surface                | `packages/tools/src/tools/generate-image/GenerateImageTool.ts` — `{ prompt, output_path, input_paths? }`, no model override           |
| Model / output format       | `packages/providers/src/openai/codexImageBackend.ts` — `CODEX_IMAGE_MODEL = 'gpt-image-2'`, PNG output                                 |
| Provider independence       | `packages/providers/src/openai/codexImageBackendResolver.ts` — active conversational provider is deliberately not a gate              |
| Setup                       | same file — "Codex image generation requires OAuth authentication. Run /auth codex enable."                                            |
| CLI flags                   | `packages/cli/src/config/yargsOptions.ts` — `--image-input/-I` (repeatable, ≤5), `--image-output/-O`, `--image-prompt/-P`             |
| CLI flag validation         | `packages/cli/src/config/imageMode.ts` — `-O` and `-P` both required, mutually exclusive with `-p`/`-i`/positional prompt, no stream-json |
| CLI output                  | `packages/cli/src/config/imageModeDispatch.ts` — text or `--output-format json`; never emits base64; nonzero exit on failure           |
| Tab completion              | `packages/cli/src/ui/commands/imageCommandCompletion.ts` — output phase offers directories plus a new `.png` name; input phase offers existing `.png` files, directories, and a prompt hint; no filesystem completion inside the quoted prompt; nothing outside the workspace |
| Success output              | `imageCommand.ts` — `Generated image.` / `Edited image.` then `Saved to: <absolute>`; `imageModeDispatch.ts` — `<Verb> image via <backend> (<model>).` then `Saved to: <absolute>` |
| Setup is lazy               | `docs/oauth-setup.md` — `/auth codex enable` defers the browser to the first request; `/auth codex login` opens it immediately        |

## Acceptance criteria

- **AC1 — canonical page.** `docs/tools/image-generation.md` exists and covers
  the feature end to end: prerequisites, quick start, `/image`, `generate_image`,
  CLI flags, path and format rules, limitations, troubleshooting, related links.
- **AC2 — Codex independence is prominent.** The page states, before the
  reference material, that image generation runs on the Codex account and is
  independent of the provider you are chatting with, and that setup is
  `/auth codex enable`.
- **AC3 — `/image` reference is accurate.** Grammar, generate-vs-edit rule,
  quoting (including the "quote whenever inputs are present" rule), per-phase
  tab completion, five-input limit, the success output, and the no-overwrite
  rule are documented and match the tokenizer/completion/service.
- **AC4 — `generate_image` reference is accurate.** Parameter names, required
  vs optional, the five-input cap, and the fact that the model cannot pick the
  model are documented and match the tool schema.
- **AC5 — CLI flags reference is accurate.** `-I`/`-O`/`-P` long and short
  forms, the both-required rule, mutual exclusion with conversational prompts,
  the stream-json restriction, and `--output-format json` output are documented.
- **AC6 — boundaries documented.** Workspace-relative output, rejection outside
  the workspace, PNG-only input with the signature check and 20 MiB cap, and
  `gpt-image-2` / PNG output are stated. Validation ordering is stated
  accurately: paths are checked before the provider request, no-overwrite at
  save time.
- **AC7 — known limitation.** The page notes that a long `/image` currently
  hides the input prompt and that Esc does not cancel it, linking issue 2976,
  without claiming more about interactive cancellation than is verified.
- **AC8 — cross-links.** The page is reachable from `docs/tools/index.md`,
  `docs/cli/commands.md` (`/image`), `docs/cli/index.md` (non-interactive
  section), and `docs/troubleshooting.md`; the page links back to the
  authentication/OAuth pages.
- **AC9 — style compliance.** The page follows
  `dev-docs/documentation-style-guide.md` (how-to structure, "you" voice,
  prerequisites/expected result, limitations before advanced setup, "LLxprt
  Code" in prose and `llxprt` for the command) and contains no plan/requirement
  bookkeeping markers.

## Boundary cases to document

- Output path that already exists (no overwrite; remove the file first).
- Output path outside the workspace, or reached via a symlink that escapes it.
- Output path without a `.png` extension.
- Six or more input images.
- Non-PNG or remote-URL input.
- `-O` without `-P` (and vice versa).
- Image flags combined with `-p` / `-i` / a positional prompt.
- Image flags with `--output-format stream-json`.
- Unquoted multiword prompt, unterminated quote, trailing arguments.
- Image generation reported unavailable (Codex OAuth not set up).

## Verification

Documentation change, so proof is mechanical and factual rather than behavioral:

1. `npm run lint:doc-links` — every repository-relative link and anchor resolves.
2. `npm run lint:doc-placement` — page is correctly placed and marker-free.
3. `npm run format` / prettier check — markdown formatting matches the repo.
4. Full local suite (`npm run test`, `lint`, `typecheck`, `build`) plus the CLI
   smoke test, confirming the docs-only change breaks nothing.
5. Every documented flag, parameter, limit, and error condition traced back to
   the source references in the table above.

## Out of scope

- Any change to image generation behavior, messages, or flags.
- Architecture/design notes (these belong in `dev-docs/`).
- Fixing the `/image` prompt-visibility and Esc-cancellation limitation (2976).
