# Ink Fork Research: @jrichman/ink (jacob314/ink)

## Summary

**Both LLxprt and upstream gemini-cli are on the same ink version: `@jrichman/ink@6.4.8`.**
The fork is still actively maintained. Upstream ink (vadimdemedes/ink) is at `6.6.0`.
The fork has NOT been merged back to mainline ink — and won't be anytime soon.

---

## Version Timeline

| Date | Event | Version |
|------|-------|---------|
| 2025-10-31 | gemini-cli switches to @jrichman/ink fork | 6.4.0 |
| 2025-11-07 | First fork version bump (6cf1c985) | 6.4.x |
| 2025-11-17 | v0.15.4 tag (our sync target) | 6.4.3 |
| 2025-11-22 | Update ink to 6.4.6 (b3fcddde) | 6.4.6 |
| 2026-01-10 | Update ink to 6.4.7 (b54e688c) | 6.4.7 |
| 2026-01-26 | Update ink to 6.4.8 (b5fe372b) | 6.4.8 |
| 2026-02-04 | Latest published @jrichman/ink on npm | 6.4.9 |

### All Published Versions of @jrichman/ink

```
6.3.1, 6.4.0, 6.4.1, 6.4.2, 6.4.3, 6.4.4, 6.4.5, 6.4.6, 6.4.7, 6.4.8, 6.4.9
```

### Official ink (vadimdemedes/ink) Latest Versions

```
6.3.0, 6.3.1, 6.4.0, 6.5.0, 6.5.1, 6.6.0
```

---

## What the Fork Adds

The fork (github.com/jacob314/ink) adds **native overflow scrolling** to Ink's `<Box>` component:

1. **`overflow: 'scroll'`** — Boxes don't expand beyond flexbox height; content scrolls
2. **Virtual scrollbar** — Visual scrollbar rendered in the terminal (non-interactive by default)
3. **`scrollTop`/`scrollLeft` props** — Programmatic scroll position control
4. **`initialScrollPosition`** — Start at top or bottom (crucial for chat UIs)
5. **`scrollHeight`/`scrollWidth` APIs** — Query scroll dimensions
6. **Horizontal scrolling** — Full horizontal scroll support
7. **`maxWidth`/`maxHeight`** — Additional layout constraints

The scrolling feature was proposed as [vadimdemedes/ink#765](https://github.com/vadimdemedes/ink/issues/765) by jacob314 on Sep 11, 2025, with the implementation PR merged to the fork on Oct 15, 2025 ([jacob314/ink#1](https://github.com/jacob314/ink/pull/1)).

---

## Why the Fork Exists

gemini-cli needed native terminal scrolling for their chat UI. The official ink library only supports `overflow: 'hidden'` and `overflow: 'visible'`. jacob314 (a gemini-cli dev) implemented `overflow: 'scroll'` with Yoga's `YGOverflowScroll` in a fork, intending to upstream it later.

**Key quote from PR**: "Goal is to iterate in this fork to ensure the behavior is what we want before upstreaming."

The upstream issue (#765) is still **OPEN** — the fork's changes have NOT been merged to mainline ink.

---

## Can LLxprt Switch Back to Mainline ink?

**No, not yet.** Here's why:

1. **The scrolling feature is essential** — gemini-cli (and LLxprt) depends on `overflow: 'scroll'` for the entire chat UI
2. **Upstream issue still open** — vadimdemedes/ink#765 has no PR from jacob314 to upstream
3. **Version gap growing** — Fork is at 6.4.x while mainline is at 6.6.0, meaning the fork is diverging
4. **No reversion signals** — Upstream gemini-cli continues bumping the fork version (6.4.6 → 6.4.7 → 6.4.8) with no indication of switching back

### When Could We Switch?

- When jacob314's scrolling PR is accepted into mainline ink (vadimdemedes/ink)
- Or when mainline ink independently adds `overflow: 'scroll'` support
- Neither appears imminent

---

## LLxprt's Ink Version Status

| Project | Current Version | Status |
|---------|-----------------|--------|
| LLxprt | @jrichman/ink@6.4.8 | [OK] In sync with upstream |
| gemini-cli HEAD | @jrichman/ink@6.4.8 | Current |
| Latest on npm | @jrichman/ink@6.4.9 | Published 2026-02-04 |
| Mainline ink | 6.6.0 | Cannot use (missing scroll) |

---

## Recommendations

1. **Stay on @jrichman/ink** — No choice until scrolling is in mainline
2. **Consider bumping to 6.4.9** — Latest on npm, published 2026-02-04. Check changelog before bumping.
3. **Monitor vadimdemedes/ink#765** — When/if scrolling lands upstream, evaluate switching back
4. **Track fork divergence** — As mainline goes to 6.7, 6.8, etc., the fork may miss important fixes. Periodically diff fork vs mainline.

---

## Fork Author

- **jacob314** = Jacob Richman, Google engineer working on gemini-cli
- **jrichman** = same person (npm username)
- Fork repo: https://github.com/jacob314/ink
- PR reviewers included SandyTao520 and galz10 (also gemini-cli team)
