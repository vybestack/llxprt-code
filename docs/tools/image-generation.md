# Image Generation and Editing

Generate or edit PNG images from a text prompt. This page covers the three ways
to reach the feature — the `/image` slash command, the `generate_image` tool the
model calls on its own, and the non-interactive CLI flags — and the rules that
apply to all of them.

## Audience and goal

You want to create a new image or change an existing one from inside LLxprt
Code. You may be using any conversational provider (Anthropic, z.ai, Gemini, a
local model, or any other). This page shows you the fastest path and then the
rules and limits that apply to every entry point.

## Two things to know first

These two facts trip up most first-time users, so read them before anything else.

1. **Image generation runs on your Codex account, not your chat provider.** It
   uses ChatGPT Plus/Pro subscription OAuth through Codex. It is completely
   independent of the provider you are chatting with. You can be talking to
   Anthropic, z.ai, Gemini, or a local model and still generate images.
   Generating an image does not change your active provider or model in any way.

2. **Setup is `/auth codex enable`.** If image generation reports that it is
   unavailable, that is almost always the reason.

## Prerequisites

- An **active ChatGPT Plus or Pro subscription**, plus Codex OAuth. Enable it
  with:

  ```text
  /auth codex enable
  ```

  Enabling is lazy: nothing opens until your first Codex request, and the
  browser login appears when you run your first image operation. Use
  `/auth codex login` instead if you want to sign in immediately. See
  [Authentication](../cli/authentication.md) and
  [OAuth Setup](../oauth-setup.md) for the full setup walkthrough.

- The model behind image generation is `gpt-image-2`, and the output is always
  **PNG**. You cannot choose a different model or output format.

## Quick start

Once Codex OAuth is enabled, generate your first image from the REPL:

```text
/image output.png "Create a black-and-white line-art cat"
```

On success the command reports what it did and the absolute path it wrote:

```text
Generated image.
Saved to: /path/to/workspace/output.png
```

Open that file to see the result.

## The three entry points

All three entry points converge on one underlying image service, so the rules in
[Output rules](#output-rules) and [Input rules](#input-rules) apply to each of
them. How you supply the prompt and the paths differs, and so does the wording of
the errors you get back.

| Entry point                                             | When to use it                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| [`/image` slash command](#the-image-slash-command)      | You are in the REPL and want direct control over paths and prompt. |
| [`generate_image` tool](#the-generate_image-tool)       | You want the model to produce an image as part of a task.          |
| [Non-interactive CLI flags](#non-interactive-cli-flags) | You are scripting or automating an image operation.                |

### The `/image` slash command

The slash command is the most direct way to generate or edit an image from the
REPL.

#### Grammar

```text
/image <output.png> [<input.png> ...] "<prompt>"
```

- The **output path** is the first argument and is required.
- Zero **input paths** generates a new image; one to five input paths edit or
  compose from them.
- The **prompt** is the last argument and is required.

#### Quoting

Quote the prompt whenever it contains spaces, and **always** quote it when you
supply input paths. Only a single-word prompt with no input paths may be left
unquoted. Single quotes and double quotes both work. Inside a quoted string, a
backslash escapes the enclosing quote character, or another backslash. Quoted
paths may contain spaces.

The **last** argument is always taken as the prompt, so put every input path
before it. An unquoted argument after a quoted one is rejected as a trailing
argument. A `--` separator is not accepted.

#### Tab completion

Paths support tab completion, and what is offered depends on which argument you
are typing:

- **Output path** — workspace directories, plus a suggested `.png` filename.
  Existing images are not offered here, because the output must be a new file.
- **Input paths** — existing `.png` files and directories inside the workspace,
  plus a hint that you can start the prompt. Once five inputs are present, only
  the prompt hint remains.
- **Prompt** — no filesystem completion while you are typing inside the quotes.

Nothing outside the workspace is ever suggested.

#### On success

The command reports what it did and the exact absolute path it wrote:

```text
Generated image.
Saved to: /path/to/workspace/output.png
```

Editing reports `Edited image.` instead.

#### Examples

These are the three examples shown in the built-in usage text:

```text
/image output.png "Create a black-and-white line-art cat"
```

```text
/image fixed.png original.png "Correct the lettering"
```

```text
/image composite.png subject.png background.png "Place the subject into the background"
```

### The `generate_image` tool

The `generate_image` tool is what the model calls when you ask it to produce an
image as part of a task (for example, "generate a diagram of this architecture
and save it"). You do not call it directly.

#### Parameters

| Parameter     | Required | Description                                                                                                  |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `prompt`      | Yes      | A non-empty text description. Whitespace-only prompts are rejected.                                          |
| `output_path` | Yes      | Where to save the result. Must end in `.png`. Relative to the workspace root, or an absolute path inside it. |
| `input_paths` | No       | An array of zero to five input images. Omit (or leave empty) to generate; supply one to five to edit.        |

There is **no** model parameter. The backend owns the model identity, and
calling the tool never changes your active conversational provider or model.

#### What it returns

The tool returns the saved path as text **plus the image itself as media**, so
the model can see what it produced and continue working with it.

The prompt, the output extension and workspace containment, and every input path
are validated before the provider request is made, so a bad path costs you
nothing. The no-overwrite rule is the exception: it is enforced when the result
is saved, so an output path that already exists fails _after_ the image has been
generated.

### Non-interactive CLI flags

For scripting and automation, LLxprt Code accepts dedicated image flags.

| Flag                        | Short | Purpose                                                                                         |
| --------------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| `--image-output <path.png>` | `-O`  | The output path (required).                                                                     |
| `--image-prompt "<text>"`   | `-P`  | The prompt (required).                                                                          |
| `--image-input <path.png>`  | `-I`  | An input image. Repeatable up to five times; order is preserved and values are not comma-split. |

Both `-O` and `-P` are required whenever any image flag is present. Supplying
only one is an error.

#### Generate

```bash
llxprt -O out.png -P "a photorealistic cat"
```

#### Edit with two inputs

```bash
llxprt -O composite.png -I subject.png -I background.png -P "Place the subject into the background"
```

#### Conflicts and restrictions

- Image mode is **mutually exclusive** with a conversational prompt. You cannot
  combine the image flags with a positional prompt, `--prompt`/`-p`, or
  `--prompt-interactive`/`-i`.
- `--output-format stream-json` is **not** supported with image mode.

#### Output

By default the process prints human-readable text:

```text
Generated image via <backend> (<model>).
Saved to: <absolute path>
```

Editing prints `Edited image via …` instead.

With `--output-format json` you get a JSON object containing:

| Field                  | Description                                  |
| ---------------------- | -------------------------------------------- |
| `operation`            | `generate` or `edit`                         |
| `output_path`          | The absolute saved path                      |
| `relative_output_path` | The path relative to the workspace root      |
| `mime_type`            | The image MIME type                          |
| `backend`              | The backend that produced the image          |
| `provider`             | The provider name                            |
| `model`                | The model name                               |
| `input_paths`          | The input images used (empty for generation) |

Base64 image data is **never** printed.

The process exits nonzero when the operation fails or is cancelled.

## Output rules

These rules come from the shared image service, so they apply to all three entry
points.

- The output path **must end in `.png`**.
- Relative paths resolve against the **workspace root**. Paths outside the
  workspace are rejected — including paths that escape through a symlink.
- **Missing parent directories are created** automatically.
- Existing files are **never overwritten**. The operation fails with a message
  of the form:

  ```text
  Output file already exists (will not overwrite): <absolute path>.
  ```

  Remove the file first if you want to replace it. This check happens when the
  image is saved, not before it is generated.

- Writes are **atomic**. A cancelled or failed operation never leaves a partial
  file at the target path.

## Input rules

Input rules apply when editing (the `/image` command with inputs, the
`generate_image` tool with `input_paths`, or `-I` flags).

- You can supply **one to five** input images. More than five is rejected.
- Inputs must be **PNG**: both a `.png` extension **and** a valid PNG file
  signature are required.
- Inputs must be **existing regular files inside the workspace**. Symbolic links
  are rejected.
- **Remote URLs** are rejected: a path beginning with `http://`, `https://`, or
  `file://` is refused. Copy the file into the workspace first.
- Each input is capped at **20 MiB** (20 × 1024 × 1024 bytes).

## Limitations

- While a `/image` request is running in the interactive UI, the input prompt is
  hidden and **Esc does not cancel the request**. Generation can take a minute
  or more, so check the paths and the prompt before you press Enter. See
  [the known-limitation tracking issue](https://github.com/vybestack/llxprt-code/issues/2976)
  for status. The non-interactive flags are not affected: Ctrl+C cancels an
  image operation started with `-O`/`-P`, and no partial file is left behind.
- **No model selection.** The model is always `gpt-image-2`.
- **PNG output only.**
- **No overwrite.** Remove an existing file before reusing its path.

## Troubleshooting

### Image generation reported as unavailable

Codex OAuth is almost always the reason. Run:

```text
/auth codex enable
```

then retry the image request; the browser opens for login on that first request.
Use `/auth codex login` if you would rather sign in straight away.

This is **not** related to your current provider. Image generation uses your
Codex account regardless of which provider you chat with.

### An error about the output file already existing

An image already exists at that path, and existing files are never overwritten.
Remove the file or choose a new output name.

### An error about the output path

The output path resolved outside the workspace, escaped through a symlink, or
does not end in `.png`. Use a path inside the workspace that ends in `.png`. The
exact wording differs slightly between `/image` and the CLI flags, but the fix
is the same.

### An input image was rejected

An input is refused when it is **not a PNG** (extension or file signature), is a
**symlink**, is **outside the workspace**, is a **URL**, or is **larger than
20 MiB**. Copy a valid PNG into the workspace and reference that local path.

### `/image` prompt quoting errors

- **Unquoted prompt** — quote it: `/image out.png "my prompt"`. A prompt with
  spaces always needs quotes, and so does any prompt used together with input
  paths.
- **Unterminated quote** — make sure every opening quote has a matching closing
  quote.
- **Trailing arguments after the prompt** — the prompt must be the final
  argument. Move any path arguments before it.

## Related

- [Tools](./index.md) — all built-in tools
- [CLI Commands](../cli/commands.md) — slash command reference
- [Authentication](../cli/authentication.md) — key management, keyring, OAuth
- [OAuth Setup](../oauth-setup.md) — OAuth configuration
- [CLI](../cli/index.md) — non-interactive mode and scripting
