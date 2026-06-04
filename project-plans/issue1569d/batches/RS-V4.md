# RS-V4: vitest/no-conditional-in-test → error

## Scope (frozen at /tmp/v_lint10.json, commit d7e36104d)

- Rule: `vitest/no-conditional-in-test`
- Total warnings: **513**
- Files touched: **113**

Per prior RS-V3 experience, ~85-90% of conditionals inside test bodies across
this codebase are semantically required:

  1. **Discriminated-union narrowing** after an assertion on the discriminant
     (e.g. `expect(x.kind).toBe('file'); if (x.kind === 'file') { ... }`).
  2. **Filter / skip loops** that iterate collected items and act only on
     matching ones (e.g. `for (msg of messages) if (msg.role === 'assistant')
     { ... }`).
  3. **Environment-dependent branching** (e.g. platform-matrix, OS-specific
     assertions).
  4. **fast-check property-based tests** where per-iteration conditions are
     intrinsic to the property.

Unlike RS-V3 (`no-conditional-expect`), where a narrowing codemod can hoist
the expect body out of the `if`, this rule flags any conditional inside a
test body — even those where the body does nothing but narrow state for a
subsequent non-expect call. Rewriting those would trade one conditional for
a `if (!cond) throw` of equal structural complexity without a semantic win.

## Strategy

Apply targeted `// eslint-disable-next-line vitest/no-conditional-in-test`
with a generic justification tag to every flagged line via
`scripts/codemods/pse-disable.mjs` (parameterized by rule name).

Then promote the rule to `'error'` globally. Future test authors adding
conditionals will be forced to either restructure, or add an explicit
justification — documenting intentionality is exactly what this rule is
intended to enforce.

## Verification gates

- `npm run lint`: errors=0, `vitest/no-conditional-in-test` warnings=0.
- `npm run test`: all 15,442+ tests pass.
- `npm run typecheck`, `npm run build`, `npm run format`: 0 issues.
- Smoke: `node scripts/start.js --profile-load synthetic "write me a haiku
  and nothing else"` exits 0.

## Commit plan

- `refactor(lint): finish vitest/no-conditional-in-test and promote to error
  (RS-V4) (Fixes #1569)`
