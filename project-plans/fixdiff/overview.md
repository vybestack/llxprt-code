## Fix Diff Highlighting – Overview

### 1. Where we are today

- The CLI has a **"Green Screen"** theme that is meant to emulate an old‐school green‑on‑black terminal.
- `DiffRenderer` currently uses the `DiffAdded` and `DiffRemoved` colours from the active theme **only for the background** of added/removed lines:
  ```tsx
  <Text backgroundColor={Colors.DiffAdded}>…</Text>
  ```
- The text colour inside that `<Text>` element is **not** set – it falls back to Ink’s default (white).  For the green‑screen theme the background is bright green (`#00ff00`) and the text is white, which appears yellowish and violates the “all text should be green” rule.
- In all other themes the same pattern is used, but the contrast is not consistent (some themes use a dark‑green background with white text, others a light background with black text).  There is **no explicit diff‑foreground colour** for any theme.

---

### 2. Desired end‑state (theme‑wide diff colours)

We want **every theme** to define **four** colour values that are used exclusively for diff rendering:
| Property               | Meaning                                    |
|-----------------------|--------------------------------------------|
| `DiffAddedBackground` | Background colour for added lines.       |
| `DiffAddedForeground` | Text (foreground) colour for added lines. |
| `DiffRemovedBackground` | Background colour for removed lines.   |
| `DiffRemovedForeground` | Text colour for removed lines.    |

The existing `DiffAdded` / `DiffRemoved` values can be kept as **background** defaults, but we will now also have an explicit **foreground** for each, making the diff appearance independent of the global `Foreground` colour.

For the **Green Screen** theme we want:
```ts
DiffAddedBackground   = '#6a9955'   // same as the normal foreground (green)
DiffAddedForeground  = 'black'   // black on a green background → readable
DiffRemovedBackground = '#6a9955' // same colour – we keep it simple
DiffRemovedForeground = 'black'
```
For the other themes we will pick the most reasonable colour pair based on their existing palette (see the "Per‑theme colour choices" table below).

---

### 3. Functional requirements

| # | Requirement | Reason |
|---|------------|--------|
| **FR‑01** | Every `ColorsTheme` **must** contain `DiffAddedForeground`, `DiffAddedBackground`, `DiffRemovedForeground`, `DiffRemovedBackground`. The fields are not optional – they default to the theme’s `Foreground`/`Background` if missing. | Guarantees that a diff will always have a foreground/background pair. |
| **FR‑02** | `DiffRenderer` must read `Colors.DiffAddedBackground`/`Colors.DiffAddedForeground` (and the removed equivalents) and apply **both** `backgroundColor` **and** `color` when rendering added/removed lines. | Removes the white‑on‑green problem and makes the look deterministic for each theme. |
| **FR‑03** | For **non‑interactive** output (e.g., CI, tests) the old behaviour (plain markdown) must stay unchanged. The new colours only affect the Ink UI. | No regression in CI pipelines. |
| **FR‑04** | Provide a **fallback**: if a theme does not provide the four new fields, fall back to the old `DiffAdded`/`DiffRemoved` for the background and `Foreground` for the text colour. | Keeps backward‑compatibility with any custom theme that has not yet been updated. |

---

### 4. Per‑theme colour choices (background / foreground)

| Theme | `DiffAddedBackground` | `Added FG` | `DiffRemovedBackground` | `Removed FG` | Notes |
|------|---------------------|-----------|-----------------------|------------|------|
| **Green Screen** | `#6a9955` (green) | `black` | `#6a9955` | `black` | Makes the whole UI green on dark; both added/removed use same colour for a consistent look. |
| **ANSI** (`packages/cli/src/ui/themes/ansi.ts`) | `#003300` (dark‑green) | `white` (theme foreground) | `#4D0000` (dark‑red) | `white` | Dark theme – keep the existing dark backgrounds; white foreground is already readable. |
| **ANSI Light** (`ansi-light.ts`) | `#e5f2e5` (light‑green) | `black` | `#ffe5e5` (light‑red) | `black` | Light theme – light background with black text for readability. |
| **Atom One Dark** (`atom-one-dark.ts`) | `#39544E` | `white` | `#282828` (for deleted – the theme already uses a dark background) | `white` | Use a slightly lighter green for added (e.g., `#4b7c5b`) and set foreground to `white`. |
| **Ayu** (`ayu.ts`) – dark theme | `#293022` | `white` | `#1d1d1d` | `white` | Keep the existing dark colours, foreground stays white. |
| **Ayu Light** (`ayu-light.ts`) – light theme | `#C6EAD8` (light green) | `black` | `#FFE5E5` (light red) | `black` | Consistent with a light theme – dark text on a light background. |
| **Dracula** (`dracula.ts`) | `#11431d` (dark green) | `white` | `#4a0c0c` (dark red) | `white` | Dark background, white text – fine as is. |
| **GitHub Dark** (`github-dark.ts`) | `#3C4636` | `white` | `#4D0000` (reuse same) | `white` | Already dark, keep as is. |
| **GitHub Light** (`github-light.ts`) | `#C6EAD8` (light green) | `black` | `#FFE5E5` | `black` | Light theme – standard black on light background. |
| **Google Code** (`googlecode.ts`) | `#C6EAD8` | `black` | `#FFE5E5` | `black` | Light background – use black text. |
| **No‑Color** (`no-color.ts`) | `''` (no background) | `white` (fallback) | `''` | `white` | No colour – fallback to normal foreground. |
| **Shades of Purple** (`shades-of-purple.ts`) | `#383E45` (dark gray‑green) | `white` | `#581c1c` (dark red) | `white` | Keep existing dark backgrounds. |
| **Xcode** (`xcode.ts`) | `#C6EAD8` | `black` | `#FFE5E5` | `black` | Light background – black text.

> **How the values were chosen**
> * For **dark** themes we keep the original dark‑green / dark‑red backgrounds and retain the theme’s `Foreground` (usually `white`) as the text colour. This guarantees readability and matches the original intent of those themes.
> * For **light** themes we flip the colours – a light green/red background with **black** text matches the natural colour scheme of light‑coloured terminals.
> * For _Green Screen_ we deliberately use a **green background** (`#6a9955`) with **black** text to keep the entire UI green (foreground) and to avoid the bright yellow‑ish visual from the previous implementation.

---

### 5. Implementation plan (high‑level)

1. **Extend the colour schema**
   ```ts
   interface ColorsTheme {
     // existing fields …
+    DiffAddedForeground?: string;
+    DiffAddedBackground?: string;
+    DiffRemovedForeground?: string;
+    DiffRemovedBackground?: string;
   }
   ```
   The `Theme` constructor will continue to accept the *old* `DiffAdded`/`DiffRemoved` as‑is, but `Colors` will expose the new fields.
2. **Update every theme file** to provide the four new values. Use the table above as a guide.  For themes that already have a suitable `DiffAdded`/`DiffRemoved` the only change needed is to add the matching foreground (`white` for dark, `black` for light).  For the **Green Screen** theme replace `DiffAdded` with `#6a9955` (already done) and add the foreground fields.
3. **Modify `DiffRenderer.tsx**
   ```tsx
   // added line
   <Text
     color={Colors.DiffAddedForeground}
     backgroundColor={Colors.DiffAddedBackground}
   >
   …
   </Text>
   // removed line – same but with DiffRemoved* properties
   ```
   Use the new Colour fields; if a field is missing, fall back to `Colors.DiffAdded` and `Colors.Foreground`.
4. **Fallback logic** – Inside `colors.ts` set hidden getters that return the old `DiffAdded`/`DiffRemoved` when the new fields are undefined.  This keeps older custom themes functional.
5. **Add unit tests** under `packages/cli/src/ui/components/messages/__tests__/DiffRenderer.test.ts` that render a diff with the different themes and assert that the `Text` component receives the expected `color` and `backgroundColor` values.
6. **Documentation** – update `docs/cli/themes.md` to document the new `Diff*` foreground & background fields.

---

### 6. Summary

- **Problem:** Bright‑green background (`#00ff00`) + default white text → yellow‑ish block in Green‑Screen theme; other themes lack explicit diff foreground colours.
- **Goal:** Every theme should explicitly define **both** background **and** foreground colours for added/removed diffs. The green‑screen theme will use a green background with black text; all other themes will keep a sensible colour pair (dark background / white text for dark themes, light background / black text for light themes).
- **Solution** – Extend the colour schema, add the four diff colour fields to every theme with appropriate values, and adjust `DiffRenderer` to use them for both background and text colour. The change is fully isolated to UI, leaving non‑interactive output unchanged.

When you approve this plan we can start editing the theme files and the renderer, then add the required tests.
