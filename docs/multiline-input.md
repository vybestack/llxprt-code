# Input While the Agent Is Working

This page covers what happens to your input when the agent is idle versus when
it is actively working. It explains how to insert a line break, what happens to
messages you submit while the agent is busy, and how to steer a turn that is
already in progress.

## Insert a line break

The key you press for a new line depends on your platform and terminal:

| Platform / terminal      | Newline key                      |
| ------------------------ | -------------------------------- |
| macOS                    | `Ctrl+J`                         |
| Windows                  | `Ctrl+Enter` (when idle)\*       |
| Linux                    | `Ctrl+J`                         |
| Linux (some terminals)   | `Alt+Enter`                      |
| VS Code / Cursor / forks | `Shift+Enter`                    |
| Any platform             | `\` at end of line, then `Enter` |

On macOS and Linux the newline key is `Ctrl+J`. On Windows it is `Ctrl+Enter`.
`Alt+Enter` also inserts a newline on some Linux terminals. If you are running
LLxprt Code inside VS Code, Cursor, or another VS Code-based terminal,
`Shift+Enter` inserts a newline as well.

\* On Windows, `Ctrl+Enter` inserts a newline while the agent is idle, and also
while it is streaming if there is nothing to steer (empty input, nothing
queued). Otherwise, while streaming, it steers the active turn instead. See the
[Windows note](#the-same-key-two-behaviors) below. Backslash continuation works
in every state.

> **Note:** `Ctrl+Enter` does two different things depending on what the agent
> is doing. See [Steer a turn in progress](#steer-a-turn-in-progress) below.

### Backslash continuation

End the current line with a backslash (`\`) and press `Enter`. The backslash is
removed and a new line begins. This works on every platform.

### Regular Enter

`Enter` (no modifiers) submits the current prompt. If the input is empty, it
does nothing — unless there are queued messages, in which case it sends them all
(see [Submit while the agent is working](#submit-while-the-agent-is-working)).

## Submit while the agent is working

When you press `Enter` while the agent is generating a response, LLxprt Code
does not drop your message or interleave it into the active response. Instead,
the message is **queued** and held until the agent finishes and becomes idle.

### The queued-messages panel

Queued messages are shown in a panel above the input area. The panel has three
states:

- **Expanded** — the default. Lists every queued message with a one-line
  preview of each, numbered in send order. If the list is longer than the panel
  can show, a count of additional messages is displayed.
- **Collapsed** — a single summary line showing the message count and a preview
  of the next message to send.
- **Compact** — used in small terminals where there is no room for the full
  panel. Shows only the message count.

When there are no queued messages, the panel is hidden entirely.

### Toggle the panel

Press `Ctrl+]` to switch between the expanded and collapsed states. This does
not affect the messages themselves; it only changes how much of the panel is
shown.

### When queued messages are sent

Queued messages are sent automatically, in order, once the agent finishes its
current response and returns to idle. Each queued message becomes its own turn.

If you want to send the queued messages immediately rather than waiting, press
`Enter` on an **empty** input line. This drains the entire queue right away.

### Clear the queue

Press `Backspace` on an **empty** input line to discard every queued message at
once.

## Steer a turn in progress

`Ctrl+Enter` is a **steering** shortcut: it injects the text in your input
buffer into the response that is currently streaming, instead of waiting for
that response to finish. The agent incorporates your steer at its next
opportunity to act (the next tool-call boundary).

This differs from queuing in two ways:

- A **queued** message waits for the current turn to finish, then starts a new
  turn.
- A **steer** becomes part of the current turn, influencing it as it happens.

### The same key, two behaviors

`Ctrl+Enter` is bound to both steering and newline. Which one fires depends on
whether the agent is streaming:

- **While the agent is streaming**, `Ctrl+Enter` steers the active turn — using
  the text you have typed, or, on an empty input, every queued message. If
  there is nothing to steer (the input is empty **and** nothing is queued), it
  falls back to inserting a newline.
- **When the agent is idle**, `Ctrl+Enter` inserts a newline (the same as
  `Ctrl+J` or `Shift+Enter`).

This contextual resolution is why `Ctrl+Enter` appears in both lists. There is
no separate key to remember — it always does the thing that makes sense for the
current state.

> **Windows note:** Windows consoles deliver `Ctrl+Enter` and `Ctrl+J` as the
> same byte, so on Windows **both** keys follow the rules above: they steer
> while the agent is streaming and there is something to steer, and otherwise
> insert a newline. To insert a newline while the agent is streaming on
> Windows with text in the input, use
> [backslash continuation](#backslash-continuation): end the line with a
> backslash and press `Enter`. (`Shift+Enter` only inserts a newline in
> VS Code-based terminals that have been configured by `/terminal-setup`; a
> plain Windows console reports it as an ordinary `Enter`.) On macOS and Linux
> `Ctrl+J` and `Ctrl+Enter` are distinct keys and behave exactly as described in
> the tables below.

### Steer queued messages

If the input is **empty** and there are queued messages, pressing `Ctrl+Enter`
while streaming steers every queued message into the active turn at once and
clears the queue. Use this when you want to redirect the current response with
all your accumulated follow-ups rather than waiting for separate turns.

## Key reference

The table below summarizes each key and what it does in each state. Special
cases for an empty input line with queued messages are described in
[Submit while the agent is working](#submit-while-the-agent-is-working) and
[Steer queued messages](#steer-queued-messages).

| Key                                | Agent idle                       | Agent streaming                  |
| ---------------------------------- | -------------------------------- | -------------------------------- |
| `Enter`                            | Submit the prompt                | Queue the prompt                 |
| `Ctrl+J`                           | Insert a newline                 | Insert a newline                 |
| `Ctrl+Enter`                       | Insert a newline                 | Steer the active turn\*\*        |
| `Shift+Enter`                      | Insert a newline                 | Insert a newline                 |
| `Alt+Enter` (some Linux terminals) | Insert a newline                 | Insert a newline                 |
| `Ctrl+]`                           | Toggle the queued-messages panel | Toggle the queued-messages panel |
| `Esc`                              | Clear the current input          | Cancel the active response       |

\*\* If the input is empty and nothing is queued there is nothing to steer, so
`Ctrl+Enter` inserts a newline even while streaming.

> **Windows:** `Ctrl+J` and `Ctrl+Enter` are the same key on Windows. So the
> `Ctrl+J` row above (newline / newline) only applies on macOS and Linux. On
> Windows that key behaves like the `Ctrl+Enter` row. See the
> [Windows note](#the-same-key-two-behaviors) above.

When the input is **empty** and there are queued messages, two extra behaviors
apply:

| Key          | Agent idle                   | Agent streaming                                |
| ------------ | ---------------------------- | ---------------------------------------------- |
| `Enter`      | Send all queued messages now | Resume draining; messages send when idle       |
| `Ctrl+Enter` | Insert a newline             | Steer all queued messages into the active turn |
| `Backspace`  | Clear all queued messages    | Clear all queued messages                      |

> **Windows:** on Windows `Ctrl+J` is the same key as `Ctrl+Enter`, so pressing
> either on an empty input while streaming steers all queued messages into the
> active turn (same as the `Ctrl+Enter` row above).

## What happens when you cancel

When you cancel an in-progress response with `Esc`, LLxprt Code **keeps** your
queued messages rather than discarding or sending them. The queue stays in the
panel so you can review it, edit your plans, send them with `Enter`, or clear
them with `Backspace`.

Automatic draining is paused after a cancellation, so the queue will not start
sending on its own. Drain resumes as soon as you submit a new message or press
`Enter` on an empty input to send the queue manually.
