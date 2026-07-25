# Documentation Style Guide

This guide defines the standards for writing and maintaining documentation in
the LLxprt Code repository. All contributors should follow these rules when
adding or modifying documentation.

## Audience and placement

### docs/ — for product consumers

`docs/` is for users of LLxprt Code: CLI users, administrators, supported public
API consumers, provider integrators, extension authors, and hook authors.

What belongs in `docs/`:

- How-to guides, tutorials, and reference material for supported features
- Configuration references for user-visible settings
- Migration guides that require external user action
- Supported public API documentation

What does **not** belong in `docs/`:

- Implementation plans, requirement tracking, and merge/cherry-pick records
- Architecture decision records and internal design documents
- Source-path references, internal type definitions, and test descriptions
- Issue/plan IDs used as structural elements (they may appear in prose as
  context, but should not drive document organization)

### dev-docs/ — for repository contributors

`dev-docs/` is for contributors and maintainers. This includes architecture,
internal APIs, source paths, tests, release/packaging mechanics, baselines,
implementation migrations, design decisions, plans, and historical engineering
records.

### Enforcement

The `lint:doc-placement` guard (see `scripts/check-doc-placement.ts`)
automatically fails if:

- `docs/` contains an `architecture/`, `plans/`, or `merge-notes/` directory.
- Any `docs/` page contains plan/requirement bookkeeping markers
  (`@plan:`, `@requirement:`, `PLAN-`, `REQ-`) outside fenced code blocks.

These markers are permitted in `dev-docs/` and inside fenced code blocks in
`docs/`.

## User-focused writing

- Start with the reader outcome and intended audience.
- Use "you" for actions and describe what the reader can see, configure, and
  verify.
- Put a minimal successful path before exhaustive reference material.
- For settings, state **scope**, **persistence**, **default**, **precedence**,
  and **valid values**.
- For commands and examples, state **prerequisites**, **expected result**, and
  **verification**.
- State limitations and security boundaries before advanced setup.
- Do not lead with source paths, class names, internal state machines,
  issue/plan IDs, test names, or implementation history.

## Tone

- Be direct, neutral, and factual. Replace hype with capabilities and
  constraints.
- Avoid absolute security/privacy/performance claims unless the boundary and
  evidence are explicit.
- Distinguish guarantees from recommendations. Use Warning, Note, and
  Experimental callouts consistently.
- Use "LLxprt Code" in prose and `llxprt` for the command.

## Standard structures

### How-to / tutorial

1. Goal and audience
2. Prerequisites
3. Quick start (minimal path)
4. Numbered steps
5. Expected result
6. Variations
7. Security and limitations
8. Troubleshooting
9. Related reference

### Reference

1. Purpose and scope
2. Syntax or schema
3. Defaults
4. Precedence and persistence
5. Valid values and errors
6. Minimal examples
7. Related guides

### Migration

1. Status, affected versions, and audience
2. Compatibility impact
3. Before and after
4. Migration steps
5. Verification
6. Rollback
7. Deprecation timeline

### Release note

1. Version, date, and status
2. User-visible changes
3. Breaking changes
4. Required actions
5. Security and privacy notes
6. Valid migration or reference links

### Internal design / record

1. Status, owner, and date
2. Authoritative vs historical
3. Context
4. Decision or architecture
5. Source and test locations
6. Verification
7. Tradeoffs
8. Follow-ups and supersession

## Maintenance rules

- Maintain one canonical page per subject. Link rather than copy.
- Identify generators and canonical sources for generated sections (e.g.,
  `KEYBINDINGS-AUTOGEN` markers in `docs/keyboard-shortcuts.md`).
- Run `npm run lint:doc-links` to check for broken repository-relative links.
- Test commands on stated platforms or label them unverified.
- Give mutable provider/model/pricing tables an "as of" date and owner, or link
  to provider-maintained data.
- Remove rollout phases from user docs once migrations ship.

## Documentation review checklist

Before submitting or reviewing a documentation change, verify:

- [ ] **Audience**: Does the page target product consumers (docs/) or
      contributors (dev-docs/)?
- [ ] **Placement**: Is the page in the correct directory? Internal-only content
      (architecture, plans, merge-notes) belongs in `dev-docs/`, not `docs/`.
- [ ] **Public-contract status**: If the page documents an API or setting, is
      the stability level (supported, experimental, deprecated) stated clearly?
- [ ] **Task-first structure**: Does the page lead with the reader's outcome and
      a minimal path, not implementation history?
- [ ] **Security claims**: Are security/privacy boundaries stated with evidence,
      not as absolute hype? Are limitations explicit?
- [ ] **Links**: Do all repository-relative links resolve? Run
      `npm run lint:doc-links`. Are `#anchor` fragments valid?
- [ ] **Duplication**: Is the content in one canonical place, with links to it
      rather than copies?
- [ ] **Bookkeeping markers**: Does the page avoid `@plan:`, `@requirement:`,
      `PLAN-`, `REQ-` markers (in `docs/`)? These belong only in `dev-docs/` or
      inside code fences.
- [ ] **Settings documentation**: If documenting a setting, are scope,
      persistence, default, precedence, and valid values stated?
- [ ] **Tone**: Is the writing neutral and factual? Use "LLxprt Code" in prose
      and `llxprt` for commands.
