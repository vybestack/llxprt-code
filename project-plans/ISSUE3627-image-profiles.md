# Issue 3627: Image model profiles

Plan ID: PLAN-20260910-ISSUE3627
Generated: 2026-09-10

## Goal

Add typed model and image profiles. Model profiles may refer to one image profile by name. Loading a model profile resolves that reference before changing runtime state and fails with the missing profile name when the reference is dangling. With no image profile, image operations retain the existing `gpt-image-2` and Codex OAuth behavior.

## Preflight findings

- Model profile persistence and command parsing already live in the CLI profile command, load, schema, bootstrap, resolution, and runtime application modules named in the issue.
- Image operations converge through the resolver installed in `postConfigRuntime.ts`.
- `codexImageBackend.ts` owns request-body defaults and response parsing; its generate and edit tests pin request bodies.
- `ImageGenerationService.ts` owns the public quality type.
- Image profile resolution must remain separate from `profileLoadBalancer.ts`.

## Phase 1: Profile types and persistence

Requirements:

- Accept `/profile load|save model <name>` and `/profile load|save image <name>`.
- Keep `/profile load|save <name>` as model aliases.
- Treat files without a discriminator as model profiles.
- Persist image model, base URL, auth reference, and quality, size, and background defaults.

TDD:

1. Add schema and profile-manager tests for legacy model parsing and image profile round trips.
2. Add command tests for typed forms and alias equivalence.
3. Implement the discriminated profile types and typed persistence paths.

## Phase 2: Reference lifecycle

Requirements:

- Saving a model profile records the active image profile name.
- Loading a model profile resolves its image profile reference.
- A missing referenced image profile aborts the load with an error naming it.
- Loading another image profile replaces the active image profile.

TDD:

1. Add behavioral tests for capture, resolution, replacement, and dangling-reference failure.
2. Thread the resolved image profile through bootstrap/runtime state only after successful validation.

## Phase 3: Configurable backend

Requirements:

- Active image profile values select model slug, base URL, auth, and operation defaults for all image surfaces.
- Without an active image profile, preserve the current backend and resolver behavior.
- Edit requests forward effective quality, size, and background instead of forcing `auto`.
- Add `xhigh` and `max` to the quality union.

TDD:

1. Extend, never relax, generation and edit body-pinning tests for profile values and fallback values.
2. Add resolver tests for profile auth/base URL selection and default Codex OAuth selection.
3. Implement backend options and composition-root wiring.

## Phase 4: Response metadata and documentation

Requirements:

- Parse response `usage`, resolved `quality`, and resolved `size`, without expecting a model field.
- Surface those fields through the result and debug logging at minimum.
- Document typed profile syntax, image payload fields, references, and fallback behavior.

TDD:

1. Add response parsing tests using the documented response shape.
2. Implement typed response metadata and logging.
3. Update profile documentation.

## Verification

Run focused Bun tests after each red-green slice. Before handoff run:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Keep each working slice committed on `issue3627`. Do not push, create a pull request, or merge.
