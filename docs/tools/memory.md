# Memory

LLxprt Code has a memory system that persists information across sessions. When you tell the model to "remember" something, or it decides a fact is worth saving, it writes to markdown files that are loaded into future session contexts.

## How It Works

Memory is stored in `LLXPRT.md` files under a `## LLxprt Code Added Memories` section. These files are loaded into context at the start of each session, so the model sees your saved facts automatically.

You can also edit these files directly — they're plain markdown.

## Memory Scopes

There are four scopes, controlling where the fact is saved:

| Scope               | File Location                                     | Loaded When                                |
| ------------------- | ------------------------------------------------- | ------------------------------------------ |
| `project` (default) | `.llxprt/LLXPRT.md` in the project directory      | Working in that project                    |
| `global`            | `~/.llxprt/LLXPRT.md`                             | Every session                              |
| `core.project`      | `.llxprt/.LLXPRT_SYSTEM` in the project directory | Working in that project (in system prompt) |
| `core.global`       | `~/.llxprt/.LLXPRT_SYSTEM`                        | Every session (in system prompt)           |

**Project** memories apply only when you're working in a specific project. **Global** memories apply everywhere.

## How Memory Files Are Discovered

Memory loading isn't just "read one file." LLxprt Code discovers memory files across your directory hierarchy:

### 1. Global Memory (always loaded)

`~/.llxprt/LLXPRT.md` is loaded in every session, regardless of where you are.

### 2. Upward Walk (project root to CWD)

Starting from your current working directory, LLxprt Code walks **up** to the project root (detected by `.git`, `package.json`, etc.), loading any `LLXPRT.md` or `.llxprt/LLXPRT.md` it finds at each directory level.

This means if you have a monorepo:

```
my-monorepo/
├── .llxprt/LLXPRT.md          ← loaded (project-level)
├── packages/
│   ├── frontend/
│   │   └── .llxprt/LLXPRT.md  ← loaded if CWD is here or deeper
│   └── backend/
│       └── LLXPRT.md           ← loaded if CWD is here or deeper
```

Each directory level can have its own memory file with context specific to that part of the codebase.

### 3. Downward Search (subdirectories)

From CWD, LLxprt Code also searches **downward** into subdirectories (breadth-first, limited depth) for `LLXPRT.md` files. This catches memory files in child packages you might work with.

### 4. JIT Loading (on-demand)

When the model reads or modifies a file in a subdirectory it hasn't visited yet, any `LLXPRT.md` or `.llxprt/LLXPRT.md` files along that path are loaded on-demand. This keeps the initial context lean while still picking up relevant memories as the model explores your project.

### Load Order

The final context includes memory from:

1. **Global** `~/.llxprt/LLXPRT.md`
2. **Upward** from project root down to CWD (outermost first)
3. **Downward** from CWD into subdirectories
4. **JIT** as the model touches new directories

Each file is loaded only once, even if discovered by multiple paths.

## Core Memory vs Regular Memory

Regular memory (`project`, `global`) is appended to the context as additional information the model can reference. It appears in blocks labeled `--- Context from: ... ---`.

**Core memory** (`core.project`, `core.global`) is saved to `.LLXPRT_SYSTEM` files and injected directly into the **system prompt**. This makes core memories higher priority — the model treats them as instructions rather than context. Use core memory for behavioral directives like "always use TypeScript" or "never auto-commit without asking."

Core memory requires an explicit opt-in:

```
/set model.canSaveCore true
```

### Why Core Memory?

Regular memory works for most facts ("my project uses PostgreSQL", "the CI runner is GitHub Actions"). But if you want the model to **always follow a rule** — like a coding style or workflow preference — core memory is stronger because it sits in the system prompt alongside the model's base instructions.

The tradeoff: core memory consumes system prompt tokens every session. Keep it concise.

## Saving Memories

The model saves memories when you ask it to:

```
Remember that this project uses pnpm, not npm.
```

Or it may decide to save something on its own if it seems important for future sessions.

You can also manually edit the LLXPRT.md files:

```markdown
## LLxprt Code Added Memories

- This project uses pnpm
- Tests are in the **tests** directory
- Prefer functional React components
```

## Viewing and Managing

View your current memories by reading the files directly:

```
cat ~/.llxprt/LLXPRT.md
cat .llxprt/LLXPRT.md
```

Or use the `/memory` command:

```
/memory            # Show memory status
/memory import     # Import memories from other formats
```

To remove a memory, edit the file and delete the line.

## Tips

- **Keep memories concise.** Each memory is loaded into context every session, consuming tokens.
- **Use project scope for project-specific facts** and global scope for preferences that apply everywhere.
- **Use subdirectory memory files** in monorepos to give the model package-specific context without loading everything everywhere.
- **Don't store secrets in memory files.** They're plain text and loaded into model context.
- **Use core memory sparingly.** It's for behavioral rules, not facts. Too much core memory bloats the system prompt.

## Related

- [Tools](./index.md) — all built-in tools
- [Prompt Configuration](../prompt-configuration.md) — how prompts and context work
- [Settings](../settings-and-profiles.md)
