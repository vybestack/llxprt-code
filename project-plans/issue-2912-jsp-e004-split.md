# Issue 2912 delivery plan — split the overloaded JSP-E004 bootstrap diagnostic

## Scope decision

One issue-linked pull request against `packages/cli/src/observation/jspSchema.ts`
and its test file. Primarily a diagnostics change. One deliberate exception to
that, accepted during review and recorded under A7: an endpoint carrying a bare
trailing `?` or `#` is now rejected, because the existing guard's own stated
purpose was already to reject it and it only escaped on a technicality. Apart
from A7, no input accepted today becomes rejected and no input rejected today
becomes accepted.

## Cross-repository determination (done before implementation)

The issue states that splitting the codes touches the frozen JSP/1 diagnostic
surface and must be coordinated with the Jefe broker. That coordination was
performed by reading the authority rather than assumed. The finding is that the
split can be made **inside** the frozen set, so no protocol change and no Jefe
change is required.

Evidence, from `llxprt-jefe` at `6b6d92896`:

- `dev-docs/jsp/v1/specification.md` §14 fixes a closed six-member code set.
  `src/jsp/v1/error.rs` and `tests/jsp_v1_snapshot_compliance.rs` both pin
  `JSP-E001..JSP-E006` exactly. Introducing a `JSP-E007` would be a protocol
  change; it is not needed and is therefore not proposed.
- §14 defines `JSP-E001` as "Closed JSON / syntax / shape violation" and
  `JSP-E004` as "Identity / **binding** violation".
- §2, line 108: "`lifecycle_generation` must be positive (`>= 1`). Zero fails
  with `JSP-E004`." This mandates `JSP-E004` for **zero** specifically. It does
  not mandate `JSP-E004` for every non-positive value. `src/jsp/v1/wire.rs:255`
  declares `lifecycle_generation: u64`, so a negative value fails serde
  deserialization, and `src/jsp/v1/parse.rs` maps deserialization/data failures
  to `JSP-E001`. The reference oracle therefore distinguishes zero
  (`JSP-E004`, the identity rule) from any negative (`JSP-E001`, outside the
  unsigned domain). The previous llxprt mapping collapsed both onto `JSP-E004`;
  splitting them so zero is `JSP-E004` and a negative is `JSP-E001` is exactly
  the split this issue asks for, and is what the code now does. The accept set
  is unchanged: only integers strictly greater than zero are accepted.
- Jefe never consumes llxprt's bootstrap rejection code. `JspCode` is used only
  on the broker's document-parsing path (`src/jsp/v1/`). `src/jsp_host/launch.rs`
  writes the bootstrap file and asserts loopback itself before writing
  (`endpoint.ip().is_loopback()`, then `"endpoint": format!("http://{endpoint}/jsp/1")`);
  it never reads a code back. Neither
  `dev-docs/jsp/v1/compliance/producer-contract.md` nor
  `src/bin/jefe-jsp-compliance.rs` asserts any bootstrap endpoint code.
  llxprt's only consumer is `jspWiring.loadBootstrapFromEnv`, which formats the
  code into a local `Error` message.

Conclusion: the genuine defect is that an unsupported **scheme** is reported as
a binding violation. A scheme that is not `http:`/`https:` is a shape violation
of the `endpoint` field, which is exactly what `JSP-E001` already means, and is
exactly how the same function already reports the other two malformed-endpoint
branches (unparsable URL, query/fragment present). Moving it to `JSP-E001`
leaves `JSP-E004` meaning precisely what §14 says it means — the loopback
binding boundary and the generation identity rule — and nothing else.

## Acceptance matrix

| ID | Behavior | Inputs / boundary cases | Success | Failure guarded against | Evidence |
| --- | --- | --- | --- | --- | --- |
| A1 | Unsupported endpoint scheme is a shape violation | `ws://`, `ftp://`, `file://`, and `javascript:` endpoints on a loopback host | Rejected with `JSP-E001` | Silently reclassifying it as the security-boundary code, or accepting a non-HTTP scheme | Schema tests |
| A2 | Non-loopback host stays the security boundary | `http://192.168.1.5:9123/jsp/1`, `http://example.com/jsp/1`, and the padded-octet near-misses already pinned | Rejected with `JSP-E004` | Weakening the loopback check while relabelling codes | Schema tests |
| A3 | Generation domain vs identity split | `0` → `JSP-E004`; `-1`, `-2`, `-999` → `JSP-E001`; `1.5` → `JSP-E001` | Zero rejected with `JSP-E004`; every negative and non-integer rejected with `JSP-E001` | Collapsing a negative (outside the reference `u64` domain) onto the identity code, or weakening the accept set | Schema tests |
| A4 | Every endpoint rejection carries a message describing its own branch | All four `classifyEndpoint` branches | Each branch yields a distinct, accurate message; the invalid-scheme branch no longer claims "endpoint not loopback" | One hardcoded message for semantically different failures | Schema tests asserting messages |
| A5 | Diagnostics never echo the rejected input | Endpoint containing a credential-like value, e.g. `ws://user:secret@127.0.0.1/` | Message is a fixed string; the rejected endpoint, its host, its scheme, and any userinfo never appear in it | Leaking bootstrap material into a diagnostic, contrary to Jefe specification decision 12 | Schema tests |
| A6 | Accepted inputs are otherwise unchanged | Existing valid corpus: `http`/`https`, `localhost`, `app.localhost`, `[::1]`, `[0:0:0:0:0:0:0:1]`, `127.x` including zero-padded octets | All still accepted | Altering the accept set anywhere other than A7 | Existing schema tests, unmodified |
| A7 | A bare query or fragment delimiter is rejected | `http://127.0.0.1:9123?`, `...#`, `...?#`, and the same with a `/jsp/1` path | Rejected with `JSP-E001` and the query/fragment message | Accepting an endpoint that then builds the request target `http://127.0.0.1:9123?/jsp/1`, folding the route into the query | Schema tests |

## Test-first sequence

RED first, in `packages/cli/src/observation/jspSchema.test.ts`:

1. Change the existing `rejects a non-http(s) scheme` expectation from
   `JSP-E004` to `JSP-E001` and extend it across `ws:`, `ftp:`, `javascript:`,
   and scheme-bearing endpoints that genuinely parse (`file:///jsp/1`,
   `urn:example:test`). Note that `file://127.0.0.1:9123/jsp/1` is **not**
   usable here: the `file` scheme forbids a port, so `new URL(...)` throws and
   the row hits the unparsable-URL branch, not the scheme branch. Pin that
   malformed case as its own assertion (`JSP-E001` + the unparsable-URL
   message), and assert the scheme message on every scheme row.
2. Add message assertions for all four endpoint branches (A4). These fail
   against current `main`, which returns `endpoint not loopback` for every one.
3. Add the no-echo assertion (A5).
4. Split the generation tests so `0` pins `JSP-E004`, a negative pins
   `JSP-E001`, a non-integer (`1.5`) pins `JSP-E001`, and positive and large
   positive integers are still accepted (A3, A6).

GREEN: have `classifyEndpoint` return a `JspError` (code plus message) instead
of a bare code, give each branch its own fixed message, and have
`parseBootstrap` propagate that error rather than substituting the hardcoded
`'endpoint not loopback'`.

## Explicit non-goals

- Adding `JSP-E007` or any change to the closed `JSP-E001..JSP-E006` set.
- Changing which bootstraps are accepted or rejected, other than the bare
  trailing `?`/`#` case in A7.
- Changing which generation values are accepted: only integers strictly
  greater than zero remain accepted. The codes change (`JSP-E004` for zero,
  `JSP-E001` for a negative, `JSP-E001` for a non-integer), but the
  accept/reject set is unchanged.
- Restructuring `zodToJspError` beyond what A1–A5 require.
- Any change to Jefe, to the compliance corpus, or to the wire protocol.
- Any lint ignore, ESLint disable, TypeScript suppression, or threshold change.
- Any `.llxprt` change.

## Scope ledger

| Item | Disposition | Notes |
| --- | --- | --- |
| Invalid scheme `JSP-E004` → `JSP-E001` | Accepted | The defect named in the issue |
| Per-branch endpoint rejection messages | Accepted | The issue names the wrong hardcoded message explicitly |
| Non-loopback stays `JSP-E004` | Accepted, no change | §14 "identity / binding violation" |
| Negative generation `JSP-E004` → `JSP-E001` (zero stays `JSP-E004`) | Accepted | `wire.rs:255` `u64` plus the parse mapping make negatives `JSP-E001`; §2 line 108 covers zero only. The accept set is unchanged |
| New `JSP-E007` | Rejected | Frozen set; unnecessary once scheme maps to `JSP-E001` |
| Jefe-side change | Not required | Jefe never consumes the bootstrap code; evidence above |

## Review dispositions

Independent review, cycle 1 of 2:

- **In-scope-Fix, adopted.** A negative `lifecycle_generation` was still mapped
  to `JSP-E004`. The Jefe specification mandates `JSP-E004` for **zero**
  specifically (§2 line 108); the reference parser types the field `u64`
  (`src/jsp/v1/wire.rs:255`) and maps deserialization failures to `JSP-E001`,
  so a negative value is a shape violation there. Zero now maps to `JSP-E004`
  and a negative to `JSP-E001`, matching the oracle.
- **In-scope-Fix, adopted.** The unsupported-scheme test used
  `file://127.0.0.1:9123/jsp/1`, which does not parse and so never reached the
  scheme branch; the row would have passed with the bug still present. It was
  replaced with `file:///jsp/1` and `urn:example:test`, which do parse, and the
  test now asserts the scheme **message** as well as the code.
- **Deferred.** LLxprt's accepted endpoint profile is broader than the Jefe
  embedded profile (it allows HTTPS, DNS `localhost` forms, and IPv6, where
  §15.1 describes IPv4 loopback HTTP), and userinfo-bearing loopback endpoints
  are accepted. Both predate this change and altering either would change the
  accept set, which this diagnostics-only issue must not do.
- **Deferred.** A non-loopback IPv6 near-miss such as `http://[::2]/` is not
  covered. The host predicate is unchanged here, so this is future hardening.

Local Open Code Review, run 1 of 2 (2 findings):

- **Rejected — factual error.** A high-severity finding claimed
  `new URL('file://127.0.0.1:9123/jsp/1')` succeeds and that the malformed-URL
  test therefore fails at runtime. It throws: the WHATWG URL parser makes a
  file URL carrying a port a parse failure. Verified empirically in Node
  (`Invalid URL`) and in Bun (`cannot be parsed as a URL`), and the suite
  passes 25/25 under both runners. The suggested replacement was not applied.
  The malformed-URL case was nonetheless broadened to cover a second,
  independent parse failure (an unterminated IPv6 literal) so the branch no
  longer rests on a single WHATWG rule.
- **Rejected as proposed; underlying readability point adopted.** A finding
  argued that `minimum: 0, inclusive: true` on the negative branch implies zero
  is valid, and proposed emitting `custom` for both branches. That change would
  remove the discriminator the split depends on and collapse negative and zero
  back onto one code — the exact defect this issue exists to fix. The bound is
  correct as written, because it expresses the unsigned **domain** rule, which
  is genuinely inclusive of zero and distinct from the positivity rule applied
  after it. A comment recording that distinction was added instead.

Additional change made during review, not from a reviewer: the negative/zero
split originally used `.min(0).refine(...)`, which emits **two** issues for a
negative value and therefore depended on Zod reporting `too_small` before
`custom` in `issues[0]`. It now uses `superRefine`, which emits exactly one
issue per value and removes that dependency on library-internal ordering.
Accept/reject behavior is identical; verified empirically across all boundary
values.

CodeRabbit, 1 review (1 finding):

- **Adopted (A7).** The endpoint guard tested `URL.search`/`URL.hash` against
  the empty string, but both return `''` for a *bare* trailing `?` or `#`, so
  `http://127.0.0.1:9123?` and `http://127.0.0.1:9123#` were accepted. Because
  `parseBootstrap` returns the raw endpoint string, appending the route segment
  yields `http://127.0.0.1:9123?/jsp/1`, which is exactly the malformed request
  target the guard exists to prevent. The guard now compares the serialisation
  against a copy with `search` and `hash` cleared.

  This was initially deferred as #3027 on the grounds that it moves the
  accept/reject set. That call was overruled by the maintainer: the guard's own
  stated purpose already covered this input, so closing the hole completes the
  existing intent rather than expanding scope, and splitting it into a separate
  pull request would not have been worth the overhead. #3027 is closed as
  delivered here.

## Review counters

- Independent review/remediation cycles: 1 of 2.
- Local OCR: 1 of 2.
- PR OCR: 1 of 2 (CI OpenCodeReview job, pass).
- CodeRabbit: 1 review, 1 finding, adopted as A7 with a recorded reply.
