# Root cause: libdbus `select()` / FD_SETSIZE overflow in `@napi-rs/keyring`

**Status: root-caused, with a minimal reproducer that involves none of our code.**

## Summary

`@napi-rs/keyring` on Linux uses `dbus-secret-service`, which binds the libdbus
C library. libdbus's mainloop uses `select()`, whose `fd_set` only has room for
`FD_SETSIZE` (1024) descriptors. When the D-Bus connection is assigned a file
descriptor >= 1024, `FD_SET(fd, &set)` writes past the end of the `fd_set` and
corrupts memory. The process then dies with SIGSEGV.

Nothing about this is specific to our code. It only looks Bun-specific because
Bun happens to have more descriptors open than Node at the moment the keyring is
first used, which pushes the D-Bus connection past the limit.

## Minimal reproducer

No agents code, no llxprt code — open descriptors, then use the keyring:

```ts
import { openSync } from 'node:fs';

// Hold enough descriptors that the next one allocated is >= FD_SETSIZE (1024).
const held = [];
for (let i = 0; i < 1200; i++) held.push(openSync('/dev/null', 'r'));

const { AsyncEntry } = await import('@napi-rs/keyring');
await new AsyncEntry('svc', 'acct').getPassword(); // SIGSEGV
```

Requires a live Secret Service (`dbus-run-session` + `gnome-keyring-daemon
--unlock --components=secrets`).

## Evidence

Descriptor-count sweep, everything else held constant:

| Descriptors held | Highest fd | Result |
| --- | --- | --- |
| 100 | ~190 | SURVIVED |
| 800 | ~890 | SURVIVED |
| 1200 | 1292 | **SIGSEGV** |
| 4000 | 4092 | **SIGSEGV** |

The transition brackets 1024, which is exactly `FD_SETSIZE`.

Backend A/B on the same machine, same test, same live Secret Service — built
from source at `Brooooooklyn/keyring-node@3e7bcc4`:

| Linux backend | Result |
| --- | --- |
| `dbus-secret-service` (libdbus, upstream default) | **SIGSEGV** |
| `linux-keyutils` only (secret-service path removed) | **18 pass, 0 fail** |

Removing the libdbus path removes the crash, and restoring it brings the crash
back — a clean, reversible A/B.

## Why the faulting frame looked opaque

The shipped `.node` sets `strip = "symbols"` in its release profile. Rebuilt
with `strip = "none"` and `debug = true`, the fault is a branch through a NULL
function pointer (`PC = 0`, `LR = 0`) with the frame chain running into
non-symbolised memory — the signature of a smashed stack rather than a bad call
site, consistent with `FD_SET` writing out of bounds.

Also ruled out as causes: a missing NAPI symbol (the addon's 43 undefined
`napi_*` imports are all provided by Bun once the `@@BUN_1.2` version suffix is
accounted for), `keyring_core::set_default_store` (a plain
`RwLock<Option<Arc<..>>>`), GC/allocation pressure, and thread-safety of
concurrent credential reads.

## Suggested fix (the basis for an upstream PR)

`keyring-node` already declares the pure-Rust alternative in `Cargo.toml`:

```toml
secret-service = { version = "5", features = ["rt-async-io-crypto-rust"] }
```

but `src/linux_credential_builder.rs` does not use it — it builds a
`dbus_secret_service_keyring_store::Store` and falls back to keyutils. The
pure-Rust `secret-service` crate talks D-Bus over `zbus`, which uses
`poll`/`epoll` and has no `FD_SETSIZE` ceiling.

The fix is to implement `keyring_core::CredentialStore` over `secret-service` v5
and prefer it on Linux, keeping `dbus-secret-service` only as a fallback (or
dropping it). There is no ready-made `secret-service-keyring-store` crate on
crates.io, so the store implementation has to be written — that is the shape of
the PR.

A narrower interim mitigation for libdbus is to ensure the connection's
descriptor stays below 1024 (e.g. `dup2`-ing it down), but that is a workaround,
not a fix.

## Reproduction environment

Native arm64 Linux container (crash reproduces in ~1.7s; x86_64 under emulation
on Apple Silicon is slow and breaks `ptrace`):

```bash
docker run -d --name llxprt-arm --platform linux/arm64 \
  --cap-add=SYS_PTRACE --security-opt seccomp=unconfined \
  -v "$PWD":/src:ro -w /work oven/bun:1.3.14 sleep infinity
```

then install `dbus-x11 gnome-keyring libsecret-1-0 gdb`, and for source builds
`git build-essential pkg-config libsecret-1-dev` plus rustup.

Reproduces on Bun 1.3.14 and on Bun canary 1.4.0.
