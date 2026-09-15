# Issue #2195: Parse tool output token limits without re-widening to unknown

Follow-up to audit issue #2159 (unknown-type abuse used to silence lint rules).
Branch: `issue2195`. Milestone 0.12.0.

## Problem

Both `packages/core/src/utils/toolOutputLimiter.ts` and
`packages/tools/src/utils/toolOutputLimiter.ts` read the ephemeral setting
`tool-output-max-tokens` (a `Record<string, unknown>` value) by casting it
`as number | undefined` inside `getOutputLimits`, then — because the raw value
can actually be `false`, `''`, `0`, or `NaN` — `limitOutputTokens` re-widens the
narrowed value with `limits.maxTokens as unknown` so sentinel checks like
`rawMaxTokens === false` compile. That cast-to-unknown-then-narrow loop is the
exact anti-pattern #2159 bans: the type lies, lint is silenced, and the trust
boundary is never established.

## Shaped acceptance criteria

### AC1 — Parse once at the boundary into an honest type

A single parser accepts the raw `unknown` value and returns a discriminated
union ("small parsed config object" per the issue):

```ts
export type ParsedToolOutputMaxTokens =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'limited'; readonly maxTokens: number };
```

Parse semantics (each row notes the behavior being preserved from today):

| raw value                       | result                    | vs. today |
| ------------------------------- | ------------------------- | --------- |
| `undefined` (unset)             | `limited(50000)`          | same (`?? DEFAULT`) |
| `null`                          | `limited(50000)`          | same (`??` treats null as unset) |
| `false`                         | `disabled`                | same (skip truncation) |
| `''` (empty string)             | `disabled`                | same (skip truncation) |
| number `0`                      | `disabled`                | same (`maxTokens === 0` skip) |
| `NaN`                           | `disabled`                | same (`Number.isNaN` skip) |
| other numbers (negative, frac, `Infinity`) | `limited(raw)` | same |
| any other value (`'50'`, `'abc'`, `true`, `{}`) | `disabled`     | **documented change**: today these ride accidental JS coercion (`'50' * 0.8 === 40`) or fall into NaN-path incoherence; the issue groups "NaN/non-number" as one test bucket, so non-numbers now coherently disable truncation instead |

### AC2 — Effective limit derived from the parsed value

`limitOutputTokens` branches on `kind`: `disabled` returns the content
untruncated immediately; `limited` computes
`getEffectiveTokenLimit(parsed.maxTokens)` and applies the configured
truncate mode unchanged.

### AC3 — `as unknown` re-widening removed

`rawMaxTokens`, `isDisabledMaxTokens(rawMaxTokens: unknown, ...)`, and
`shouldSkipTruncation(rawMaxTokens: unknown, ...)` disappear from both
limiter modules; their replacements take honest types. No lint suppressions
are added and no lint/type rules are loosened.

### AC4 — Shared parser

The parser lives in a new `packages/tools/src/utils/toolOutputMaxTokens.ts`
exported as `./utils/toolOutputMaxTokens.js` in the tools package exports map
(same `types`/`bun`/`import` conditions as sibling entries). Both limiter
modules use it: tools via relative import, core via
`@vybestack/llxprt-code-tools/utils/toolOutputMaxTokens.js` (core already
depends on `@vybestack/llxprt-code-tools`). `DEFAULT_MAX_TOKENS` moves to the
shared module and each limiter re-exports it so the existing public surface
(`estimateTokens`, `DEFAULT_MAX_TOKENS`, `ToolOutputSettingsProvider`,
`limitOutputTokens`, `formatLimitedOutput`, ...) stays import-compatible.
`getOutputLimits` stays exported in both packages but its
`OutputLimitConfig.maxTokens: number | undefined` field becomes
`tokenLimit: ParsedToolOutputMaxTokens` (only the modules' own tests consume
this shape; repo-wide grep confirms no other importers of `getOutputLimits` /
`OutputLimitConfig`).

### AC5 — Focused tests (bun, co-located)

- New `packages/tools/src/utils/toolOutputMaxTokens.test.ts`: table-driven
  parse coverage for every row of the AC1 table (false, empty string, zero,
  NaN, non-number `'50'`/`'abc'`/`true`/`{}`, undefined, null, normal numeric,
  negative number).
- Extend `packages/core/src/utils/toolOutputLimiter.test.ts`: update
  `getOutputLimits` shape assertions; add over-limit content cases where
  `false` / `''` / `0` / `NaN` / `'abc'` settings pass content through
  untruncated.
- New `packages/tools/src/utils/toolOutputLimiter.test.ts`: the tools
  implementation currently has no direct unit tests; add focused behavior
  tests for the same sentinel pass-through plus one normal-numeric warn-mode
  case proving truncation still fires.

### Out of scope (do not touch)

- The other independent cast sites reading the same key:
  `agents/src/scheduler/result-aggregator.ts` (~L412),
  `tools/src/tools/read-many-files.ts` (~L518),
  `tools/src/tools/codesearch.ts` (~L354),
  `core/src/tools-adapters/CoreShellToolHostAdapter.ts` (~L133).
  These deserve their own follow-ups once the shared parser lands.
- `tool-output-truncate-mode` parsing honesty (its cast stays as-is).
- Any change to truncation/sampling behavior itself.

## TDD order

1. RED: `toolOutputMaxTokens.test.ts` (parse table) — fails, module missing.
2. GREEN: shared parser module + tools package.json export entry.
3. RED: extend core `toolOutputLimiter.test.ts` (new shape + sentinels); new
   tools `toolOutputLimiter.test.ts` — fail against old implementation.
4. GREEN: rewrite `getOutputLimits`/`limitOutputTokens` in both limiter
   modules on the parsed union; remove `rawMaxTokens`/sentinel helpers.
5. Full verification cycle (test, lint, typecheck, format, build, smoke test).

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, plus the stepfun-37 startup smoke test. Review by
deepthinker (max 2 rounds). OCR is currently disabled by Andrew until
further notice — skip it.

## Review-triage policy

Classify every finding as Blocker-Fix / In-scope-Fix / Reject / Defer.
Reviewer suggestions do not authorize scope expansion beyond this plan.
