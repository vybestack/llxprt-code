# Issue #2946 — Stop forwarding Google credential material into the container sandbox

## Problem

`packages/cli/src/utils/sandbox-containers.ts` forwards long-lived Google
credential material into Docker/Podman sandboxes, bypassing the credential
proxy that exists specifically to keep stored secrets on the host:

- `addContainerEnvVars` copies `GEMINI_API_KEY` and `GOOGLE_API_KEY` from the
  host process into the container with `--env`.
- `addContainerVolumeMounts` mounts `~/.config/gcloud` read-only when it exists,
  mounts the file named by `GOOGLE_APPLICATION_CREDENTIALS` read-only, and
  re-exports `GOOGLE_APPLICATION_CREDENTIALS` inside the container.

Any process inside the container — including anything an LLM-generated command
spawns — can read these from `env`, `/proc/self/environ`, or the mounted files.

## Accepted behavior (in scope)

**B1 — No secret Google API keys in the container environment.**
The container run arguments produced by `addContainerEnvVars` contain no
`--env GEMINI_API_KEY=…` and no `--env GOOGLE_API_KEY=…` entry, regardless of
whether those variables are set on the host.

**B2 — Non-secret Vertex/Gemini configuration still crosses.**
`GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_GENAI_USE_GCA`, `GOOGLE_CLOUD_PROJECT`,
`GOOGLE_CLOUD_LOCATION`, `GEMINI_MODEL`, `TERM`, and `COLORTERM` continue to be
forwarded when set. These are configuration, not credentials.

**B3 — No gcloud directory mount.**
`addContainerVolumeMounts` produces no `--volume` entry for
`~/.config/gcloud`, even when that directory exists on the host.

**B4 — No ADC mount and no ADC re-export.**
`addContainerVolumeMounts` produces no `--volume` entry for the file named by
`GOOGLE_APPLICATION_CREDENTIALS` and no
`--env GOOGLE_APPLICATION_CREDENTIALS=…` entry, even when the variable is set
and the file exists on the host.

**B5 — User-requested mounts are unaffected.**
Mounts supplied via `LLXPRT_SANDBOX_MOUNTS`, `SANDBOX_MOUNTS`, and profile
`mounts` continue to produce `--volume` entries exactly as before. The user
asked for those explicitly.

**B6 — Named-key resolution is proxy-aware in `BaseProvider`.**
`BaseProvider`'s default provider-key storage is obtained from
`createProviderKeyStorage()` (the sanctioned factory) instead of the direct
`getProviderKeyStorage()`. Inside a sandbox (`LLXPRT_CREDENTIAL_SOCKET` set)
this resolves `auth-key-name` through the credential proxy; on the host with no
socket set, behavior is unchanged (direct storage). Callers may still inject
`config.providerKeyStorage`.

This is what keeps Gemini and Vertex API-key auth working from inside the
container after B1: the key is saved on the host with `/key save`, referenced by
`auth-key-name`, and fetched over the proxy socket. Every other named-key
resolution path in the codebase (`runtime/keyResolution.ts`,
`runtime/profileApplication.ts`, `ui/commands/keyCommand.ts`,
`profile-application/loadBalancerProfile.ts`) already uses
`createProviderKeyStorage()`; `BaseProvider` is the last direct caller and would
otherwise reach for the host keyring from inside the container, where it is not
reachable.

**B7 — Documentation reflects the new boundary.**
`docs/sandbox.md` no longer describes these crossings as a known defect. The
threat-model bullet, the isolation table's "Stored secrets" row, the
filesystem-mounts list, and the "Known credential leakage in containers" section
are updated to state that stored provider credentials do not cross into the
container, and that Gemini/Vertex API keys are supplied with `/key save` and
resolved through the proxy.

**B8 — Seatbelt is untouched.**
No change to `sandbox-seatbelt.ts` or the `.sb` profiles. Seatbelt runs on the
host with full keyring access by design.

## Explicitly out of scope

- Any new host-side ADC/`google-auth-library` token-exchange op on the proxy.
  Per the issue addendum, ADC/gcloud material simply does not cross for now.
- A Gemini OAuth flow (Gemini has no OAuth flow in this codebase).
- An opt-in escape hatch to re-enable the forwarding. Not requested; the
  addendum says "I'm good just not passing it for now."
- Changing `envKeyNames` on `GeminiProvider`, `hasVertexAICredentials`,
  `contentGenerator.ts`, or any other host-side env reading. Those remain
  correct on the host; they simply find nothing inside the container.
- Any change to `addCustomMounts`, `buildSandboxEnvArgs`, `SANDBOX_ENV`,
  `VIRTUAL_ENV`, `NODE_OPTIONS`, or the capability-token transport.

## Boundary cases to cover

| Case                                                            | Expected                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------- |
| `GEMINI_API_KEY` set on host                                     | absent from generated args                                       |
| `GOOGLE_API_KEY` set on host                                     | absent from generated args                                       |
| Both unset                                                       | absent from generated args (no regression)                       |
| `~/.config/gcloud` exists on host                                | no `--volume` for it                                             |
| `GOOGLE_APPLICATION_CREDENTIALS` set and file exists             | no `--volume` for it, no `--env GOOGLE_APPLICATION_CREDENTIALS=`  |
| `GOOGLE_APPLICATION_CREDENTIALS` set and file missing            | no mount, no env (already true; must stay true)                  |
| `LLXPRT_SANDBOX_MOUNTS` set                                      | `--volume` entry still produced                                  |
| `SANDBOX_MOUNTS` set (legacy)                                    | `--volume` entry still produced                                  |
| Non-secret config vars set                                       | still forwarded with `--env`                                     |
| `LLXPRT_CREDENTIAL_SOCKET` set, `BaseProvider` resolves key name | request goes over the proxy socket, not the host keyring         |
| `LLXPRT_CREDENTIAL_SOCKET` unset, `BaseProvider` resolves        | direct storage, unchanged                                        |

## Tests that prove it (behavioral, no mock theater)

### `packages/cli/src/utils/sandbox-containers.test.ts`

Follow the existing patterns in that file: snapshot/restore `process.env`, real
temp fixture directory, `vi.mock('node:child_process')`.

1. `addContainerEnvVars` with `GEMINI_API_KEY` and `GOOGLE_API_KEY` set on
   `process.env` produces args whose `--env` values contain no entry starting
   with `GEMINI_API_KEY=` or `GOOGLE_API_KEY=`. Assert on the actual generated
   argument array, not on a mock.
2. The same call, with the non-secret configuration variables set, still emits
   `--env GOOGLE_CLOUD_PROJECT=…`, `--env GOOGLE_CLOUD_LOCATION=…`,
   `--env GOOGLE_GENAI_USE_VERTEXAI=…`, `--env GOOGLE_GENAI_USE_GCA=…`, and
   `--env GEMINI_MODEL=…`.
3. `addContainerVolumeMounts` with a real gcloud-directory fixture (created via
   a stubbed `os.homedir()` pointing at a temp dir containing `.config/gcloud`)
   produces no `--volume` argument referencing that path.
4. `addContainerVolumeMounts` with `GOOGLE_APPLICATION_CREDENTIALS` pointing at
   a real temp file produces no `--volume` referencing it and no `--env`
   argument starting with `GOOGLE_APPLICATION_CREDENTIALS=`.
5. `addContainerVolumeMounts` with `LLXPRT_SANDBOX_MOUNTS` set to a real temp
   directory still produces the corresponding `--volume` entry (guards B5).
6. Same as (5) for the legacy `SANDBOX_MOUNTS` name.

### `BaseProvider` proxy-aware key storage

Add coverage in the providers package (co-locate with existing `BaseProvider`
tests, e.g. `packages/providers/src/__tests__/`).

7. With `LLXPRT_CREDENTIAL_SOCKET` set to a real listening Unix-socket test
   double serving `get_api_key`, a `BaseProvider` subclass configured with
   `auth-key-name` resolves the key served by that socket. Prove it by
   asserting the resolved key equals the value the socket served — the host
   keyring is never consulted. Reuse the existing proxy test doubles under
   `packages/providers/src/auth/proxy/__tests__/` where available.
8. With `LLXPRT_CREDENTIAL_SOCKET` unset and no injected storage, construction
   and resolution behave exactly as today (direct storage path) — no throw, no
   proxy client created.
9. An explicitly injected `config.providerKeyStorage` still wins over the
   factory default.

Use `resetFactorySingletons()` in teardown so the proxy singletons do not leak
between tests.

## Implementation notes

- `packages/cli/src/utils/sandbox-containers.ts`
  - `addContainerVolumeMounts`: delete the gcloud block and the ADC block; keep
    the `LLXPRT_SANDBOX_MOUNTS` / `SANDBOX_MOUNTS` block. Update the JSDoc,
    which currently reads "Adds gcloud, ADC, and custom SANDBOX_MOUNTS volume
    flags." Drop now-unused imports only if they become unused (`os`, `fs`,
    `path` are used elsewhere in the file — verify before touching).
  - `addContainerEnvVars`: remove the two secret keys from `envMap`. Update the
    JSDoc, which currently reads "Adds environment variable flags for API keys,
    term, proxy, etc."
- `packages/providers/src/BaseProvider.ts`
  - Import `createProviderKeyStorage` from
    `./auth/proxy/credential-store-factory.js` directly (not from the heavy
    `./auth/index.js` barrel) to avoid an import cycle, and use it as the
    fallback at the `config.providerKeyStorage ?? …` site. Update the adjacent
    comment, which explains the current `getProviderKeyStorage()` fallback.
  - Verify no cycle is introduced (`credential-store-factory.ts` imports only
    `@vybestack/llxprt-code-auth`, `@vybestack/llxprt-code-core/auth-factories.js`,
    `@vybestack/llxprt-code-storage`, and `node:fs`).
- `docs/sandbox.md` — see B7. Also check `docs/cli/sandbox-profiles.md` and
  `docs/cli/google-cloud-auth.md` for links/anchors that break when the
  "Known credential leakage in containers" section is rewritten, and fix any
  that do.

## Guardrails

- No new `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `@ts-nocheck`.
- No loosening of any lint/complexity threshold.
- Fail fast; do not add defensive wrappers.
- Verification before commit: `npm run test`, `npm run lint`,
  `npm run typecheck`, `npm run format`, `npm run build`, and
  `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
