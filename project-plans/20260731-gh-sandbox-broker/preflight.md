# P01 Preflight Verification

**Phase ID**: `PLAN-20260731-GHBROKER.P01`
**Date**: 2026-07-31
**Base**: `main`, clean tree, 0 commits behind `origin/main`

Every assumption the plan rests on, verified against source or live API before
any code is written.

| # | Assumption | Result | Evidence |
|---|---|---|---|
| 1 | `MAX_FRAME_SIZE` = 64 KB | ✅ | `packages/auth/src/proxy/framing.ts:26` → `65536`, enforced in both `encodeFrame` and `FrameDecoder.feed` |
| 2 | `REQUEST_TIMEOUT_MS` = 30 s | ✅ | `proxy-socket-client.ts:21` → `30000`, applied per request in `sendRequest` |
| 3 | `IDLE_TIMEOUT_MS` = 5 min, closes hard | ✅ | `proxy-socket-client.ts:22` → `300000`; `gracefulClose()` rejects every entry in `pendingRequests` |
| 4 | Dispatch serialized per connection | ✅ | `credential-proxy-server.ts` `shouldContinueProcessing()` chains on `state.inFlight` |
| 5 | Request map resolves once per id | ✅ | `resolvePendingRequest()` deletes before resolving |
| 6 | No cancellation op exists | ✅ | No cancel in `ProxySocketClient`; absent from server handler table |
| 7 | `get_api_key` serves sandbox callers; `has_api_key` blocked | ✅ | `handleGetApiKey` returns `{ key }` with an explicit "intentionally allowed" comment; `handleHasApiKey` gated by `rejectIfSandbox` |
| 8 | Capability token via inherited fd, module-private cache | ✅ | `sandbox-capability.ts:95` writes `LLXPRT_CAPABILITY_TOKEN` to a descriptor; `credential-store-factory.ts:54` `let cachedCapabilityToken`, consumed from fd 3, duplicate-transport guard at :150 |
| 9 | Host `gh` authenticated, ≥ 2.x | ✅ | `gh version 2.83.2`; `gho_` token in keyring, account `acoliver` |
| 10 | `gh` present in sandbox image | ✅ | `Dockerfile:19`, apt list, alongside `jq` |
| 11 | `updateIssue` accepts type/labels/projects | ✅ | Live introspection: `UpdateIssueInput` includes `issueTypeId issueType labelIds labels projectIds assigneeIds milestoneId state stateInput` |
| 12 | `resolveReviewThread` takes only `threadId` | ✅ | Live introspection: `ResolveReviewThreadInput` = `clientMutationId threadId` |
| 13 | at-completion has non-file source precedent | ✅ | `useAtCompletion.ts:198` `CommandKind.SUBAGENT` |
| 14 | Default sandbox profile has network on | ✅ | `sandboxProfiles.ts:60` `network: 'on'` |

## Payload sizing (REQ-006)

Measured with `gh ... --json ... | wc -c`:

| Payload | Bytes | vs 64 KB |
|---|---|---|
| issue #1663 + comments | 50,512 | 77 % |
| issue #135 + comments | 8,801 | 13 % |
| PR view + comments + reviews | 13,774 | 21 % |

The issue this feature was requested on consumes three-quarters of the frame
budget. Confirms REQ-006 is real, not theoretical.

## Hardening lineage (REQ-015)

- **#1954** — abliterated-model pentest. Chain: connect → handshake →
  `list_api_keys` → `get_api_key`.
- **#2467** — capability token auth (`timingSafeEqual` over SHA-256) plus
  enumeration restrictions.
- **#2784** — capability bootstrap boundary: host-only 0600 env file in a 0700
  directory outside sandbox mounts, trusted fd 3 handoff, consumed before
  settings/hooks/MCP/providers/agents start, retained only in the private
  factory cache; capability transport state stripped from Bun launcher parents
  and Seatbelt children.

Steps 1–3 of the chain are closed. **Step 4 is deliberately open** — the
sandbox needs provider keys by name to configure LLM clients — so the residual
mitigation is name secrecy.

**Consequence, binding on this plan:** a GitHub PAT must not be stored under
`/key`. A guessable name (`github-pat`) would re-open precisely the step #1954
left standing. Host `gh` auth is the only credential source in v1.

## Constraints carried into implementation

1. No new listener, socket path, port, or auth mechanism (REQ-003).
2. No new env var, mount, or file carrying a secret (REQ-015).
3. `list_api_keys` empty / `has_api_key` blocked stay exactly as-is (REQ-015).
4. Frame capacity is raised but stays **bounded** — an unbounded frame is a
   memory-exhaustion vector from a hostile sandbox.
5. Broker must never import or reference `providerKeyStorage` (REQ-004).

## Result

**PASS** — 14/14 assumptions hold. No plan amendment required. P02 may begin.
