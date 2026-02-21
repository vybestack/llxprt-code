# Continuation and Checkpointing

LLxprt Code automatically records your sessions so you can resume them later. It also has conversation branching via `/chat` for saving and restoring conversation state within a session.

## Session Recording and Continue

Sessions are recorded automatically. No configuration needed. When you quit LLxprt and come back, you can pick up right where you left off.

### Resuming Sessions

**From the CLI:**

```bash
# Resume the most recent session for this project
llxprt --continue

# Resume a specific session by ID or index
llxprt --continue <session-id>
llxprt --continue 1            # Most recent
llxprt --continue 2            # Second most recent
```

The `-C` short flag works too:

```bash
llxprt -C
llxprt -C 2
```

**From inside a session:**

```
/continue                   # Opens the session browser
/continue latest            # Resume the most recent session
/continue <session-id>      # Resume a specific session
```

The `/continue` command with no arguments opens an interactive session browser where you can scroll through previous sessions and pick one to resume. If you have an active conversation, you'll be asked to confirm before replacing it.

> **Note for Gemini CLI users:** LLxprt uses `/continue` and `--continue`, not `/resume` or `--resume`.

### Managing Sessions

```bash
# List all recorded sessions for the current project
llxprt --list-sessions

# Delete a session by ID, prefix, or index
llxprt --delete-session <id>
llxprt --delete-session 3
```

### How It Works

Sessions are recorded to `~/.llxprt/sessions/`. Each session file contains the full conversation history — model responses, tool calls and results, and thinking blocks. When you resume, the conversation is replayed into the model's context so it picks up with full awareness of what happened before.

Sessions are per-project. Running `llxprt --continue` in a different directory shows that directory's sessions.

## Conversation Branching with /chat

The `/chat` command lets you save and restore conversation state within a session. This is useful when you want to try different approaches and branch back to a known-good state.

```
/chat save before-refactor     # Tag the current conversation state
```

Try something. If it doesn't work out:

```
/chat resume before-refactor   # Roll back to the tagged state
```

### Commands

```
/chat save <tag>               # Save current conversation with a tag
/chat resume <tag>             # Restore conversation to a tagged state
/chat list                     # List saved tags
/chat delete <tag>             # Delete a saved tag
```

Chat tags are stored locally and persist across restarts. They capture the conversation history at the moment you save — not the file state. If you need file-level undo, use git.

## Checkpointing

Checkpointing saves a snapshot of your project files before `write_file` and `replace` tool calls execute. If an edit goes wrong, you can revert files and conversation to the pre-edit state.

It's disabled by default. Enable it with `--checkpointing`:

```bash
llxprt --checkpointing
```

Or in `~/.llxprt/settings.json`:

```json
{
  "checkpointing": {
    "enabled": true
  }
}
```

When enabled, LLxprt creates a shadow git snapshot (in `~/.llxprt/history/<project_hash>`, separate from your project's git) each time a `write_file` or `replace` tool is about to run. It also saves the conversation state and tool call details to `~/.llxprt/tmp/<project_hash>/checkpoints/`.

The `/restore` command (only available when checkpointing is enabled) lets you roll back:

```
/restore                    # List available checkpoints
/restore <checkpoint>       # Restore files and conversation to that point
```

Restoring reverts your project files via the shadow git snapshot, reloads the conversation history, and re-proposes the original tool call so you can retry or skip it.

> **Limitation:** Checkpointing currently only covers `write_file` and `replace` tool calls. Other file-modifying tools (`apply_patch`, `delete_line_range`, `insert_at_line`) are not checkpointed.
