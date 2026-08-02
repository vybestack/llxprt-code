# Issue #1562 — Copy support for sandbox proxy

## Problem

When the TUI runs inside a sandbox, clipboard copies are lost:

- **Container (docker/podman):** `process.env.SANDBOX` is set to the container
  name. `clipboardy.write()` shells out to `pbcopy`/`xclip`/`wl-copy` *inside*
  the container, where they are absent or target an isolated clipboard.
- **macOS Seatbelt (`SANDBOX=sandbox-exec`):** the seatbelt profile is
  `(deny default)` with no grant for the pasteboard Mach service, so `pbcopy`
  is blocked.

The existing `copyToClipboard` (`packages/cli/src/ui/utils/commandUtils.ts`)
already implements an **OSC 52** terminal escape-sequence path, but it only
activates for SSH/WSL/WindowsTerminal. OSC 52 bytes flow transparently through
the sandbox PTY → container client → host terminal, where the host terminal
emulator writes to the **host** clipboard.

## Approach

Extend the existing OSC 52 mechanism to also cover sandbox environments. This
reuses tested code; it is **not** a new subsystem (no container mounts, no
daemon, no seatbelt-profile security change). A full host-side clipboard-proxy
daemon is a larger, separately-scoped effort and is deferred.

## Acceptance criteria

1. **AC1:** When `process.env.SANDBOX` is set (container name or
   `sandbox-exec`), `/copy` and mouse-selection copies route through the OSC 52
   terminal path instead of the local `clipboardy` utility.
2. **AC2:** OSC 52 is written to an appropriate TTY stream (preferring
   `/dev/tty`, falling back to stderr/stdout).
3. **AC3:** Non-sandboxed behavior is unchanged — local `clipboardy` is used
   when no remote/sandbox environment is detected.
4. **AC4:** tmux/screen wrapping and the empty-text no-op are preserved.
5. **AC5 (tests):** `SANDBOX` set → OSC 52 path (no `clipboardy`); `SANDBOX`
   unset → `clipboardy` path (no OSC 52).

## Scope boundaries

- In scope: `commandUtils.ts` sandbox detection + tests.
- Out of scope: host-side clipboard-proxy daemon, seatbelt profile clipboard
  grants, new settings/schema, container mount changes.

## Limitation

OSC 52 requires a terminal emulator that supports it (iTerm2, kitty, WezTerm,
Alacritty, Windows Terminal, recent GNOME Terminal). macOS Terminal.app does
not. This is the same limitation the existing SSH/WSL path has.
