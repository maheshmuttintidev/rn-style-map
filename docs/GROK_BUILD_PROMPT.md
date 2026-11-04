# Agent prompt: build / extend `@shayrn/rn-style-map`

You are a coding agent. This prompt is self-contained: it tells you what to build, the rules, and when you are done. Do not call any LLM from the tool you build.

## Goal

An **offline, AI-agnostic, low-token** CLI + library for React Native projects. For each screen it prints a compact component tree with **resolved style values** and `file:line`. The output goes into an AI agent's context or a CI log. Nothing executes app code, starts Metro, or needs a device.

Package: `@shayrn/rn-style-map` · repo `maheshmuttintidev/rn-style-map` (MIT) · Node ≥ 20.19 · TypeScript, ESM + CJS via tsup · bin `rn-style-map`.

## Hard rules

- Do **not** publish to npm, create tags or releases, delete anything, or change repo settings. PRs into this repo are fine.
- Treat any real app you test on as **read-only**. Put outputs in a scratch dir, never in that app.
- Public docs may quote only **aggregate** numbers from private apps. No route names, paths, component names, colours or text.
- Never guess. If a value cannot be known statically, report it as unresolved with a reason code.

## Pipeline

`discover → parse (@babel/parser, jsx+typescript) → resolve/evaluate → build tree → normalise → [audit] → encode (compact|json|md) → budget`

1. **Discover routes.**
   - expo-router: `app/` or `src/app/`. Groups `(x)` do not appear in the path. `_layout` files are listed as layouts, `[id]` stays literal, and `+not-found` is kept.
   - React Navigation: walk `<X.Screen name component>` from the entry (`package.json` `main`, `index.js` or `App.tsx`). Screens whose component only renders a `*.Navigator` are skipped.
   - `--entry <file>` maps one file.
2. **Resolve imports.** Use tsconfig `paths`/`baseUrl`. If an `extends` target is missing, fall back to the file's own `paths`. Strip JSON comments in a string-aware way. Also read the babel `module-resolver` aliases with a static parse. Prefer platform files `.ios/.android/.native` for the chosen platform.
3. **Evaluate** a small JS subset over the AST:
   - literals, objects/arrays/spread, template strings, member access, `?.`/`??`/`&&`/`||`/ternary, arithmetic, function/arrow calls with default and rest params, destructuring, `.map/.filter`, `StyleSheet.create/flatten/compose`
   - `Platform.OS/select`, `Dimensions.get('window')` = viewport, `useWindowDimensions`, `useColorScheme` = `--scheme`
   - `createContext`/`useContext`, with the Provider `value` taken from the nearest rendered ancestor
   - custom hooks are evaluated
   - anything else becomes `Unknown(reason)`

   Route props (`navigation`, `route.params`, others) are runtime values.
4. **Scalers.**
   - `@shayrn/react-native-scaler` v1.2: reference 402×874, `uniform = min(W/402, H/874)`. `scale(n)=round(n*uniform)`; `scaleFont` clamps to [10,100]; `scaleWidth/Height` use the axis ratio; `useUniform:false` uses the width ratio. Honour `configureScaler({...})` in source.
   - `react-native-size-matters` (350/680).
   - Config `scalers` table for other libraries.
   - Mark these values `approx` (shown with `~`).
5. **NativeWind.** Load `tailwind.config.{js,cjs,mjs,ts}` with tailwindcss `resolveConfig`, and use rem = 14. Support arbitrary values, opacity `/50`, `dark:` `ios:` `android:` `native:` and breakpoint variants against the viewport, `cn`/`clsx`/`twMerge`, and CSS variables from `global.css` (`:root` and `.dark`). Unknown utilities give `UNKNOWN_CLASS`; state variants are ignored.
6. **Tree.** Inline local components, keeping `callsite`. External components are kept as leaves. `.map()` gives `×N`. Text children are joined and truncated to 48 characters. a11y data: `accessibilityRole/role`, `accessibilityLabel/aria-label`, `hitSlop`, `allowFontScaling`, `maxFontSizeMultiplier`.
7. **Normalise.** Expand shorthands (`padding` to four sides, `paddingHorizontal`, …). Colours become upper-case hex through `culori`; `#RRGGBBAA` is used when alpha < 1. Drop the default values of `--budget` trims only.

## Compact grammar

```
# <route>  <file>  <platform>·<scheme>·<W>x<H>  resolved <n>/<total> (<floor pct>%)  ~<o200k tokens> tok
layout <layouts outermost-first joined by ' › '>
fonts F1=<family> …                      (families used ≥ 3 times)
<Name>[×N] ["text"] <props>  <loc> [← :<callsite line>]
? <n> unresolved: REASON×n …             (detail with --unresolved)
· trimmed: …                             (with --budget)
```

- Props are short keys; the value is glued on for numbers and `#hex` (`p16`, `bg#FFF`) and joined with `:` otherwise (`alignSelf:flex-start`).
- Paddings and margins compress to `p`/`px`/`py`/`pt`/…, and borders to `bd1#HEX`. Typography is `Family-Weight size/lh #color`.
- `~` marks a scaler value and `?` an unresolved one.
- `loc` is `basename:line` inside the route file. Inlined component nodes show `Component:line ← :callsiteLine`.

## Flags (all must work)

`--route <glob>` (repeatable or comma-separated) · `--entry` · `--depth` (6) · `--only` · `--tokens` · `--format compact|json|md` · `--budget <n>` (≥ 50; trims in order: ×N collapse, default props, `$sN` refs, line-only loc, depth, text, then header-only) · `--diff <ref>` · `--platform android|ios` · `--scheme light|dark` · `--viewport WxH` (360x800) · `--unresolved` · `--audit` · `--strict` · `--exit-zero` · `--root` · `--config` (`<root>/rn-style-map.config.json`) · `-o/--out`.

**Exit codes:** 0 ok; 1 audit errors (or warnings with `--strict`); 2 usage or config error. `--exit-zero` always gives 0.

## Diff

1. Changed files come from `git diff --name-only --relative <ref>` plus untracked files.
2. `git archive <ref>` into a `mkdtemp` dir, symlink `node_modules`, and map the same routes there.
3. Compare node signatures and keep changed nodes along with their ancestors.
4. Route status is `added`, `changed` or `removed`. Removed lines print as `- …`.
5. Always remove the temp dir. Never touch the working tree.

## Audit (13 rules, each with a URL)

| Rule | Severity |
|---|---|
| `wcag-1.4.3` text contrast (4.5, or 3 for large text; background from ancestors, alpha composited) | error |
| `wcag-1.4.11` | warn |
| `wcag-2.5.8` 24×24 including hitSlop | error |
| `hig-target-44`, `md-target-48` | warn |
| `a11y-label`, `a11y-role` on interactive elements | warn |
| `ds-font-count`, `ds-color-count` | warn |
| `ds-near-dup-color` (ΔE < 3) | info |
| `ds-spacing-grid` (4) | info |
| `type-min-size` (12) | warn |
| `type-font-scaling` | warn |

- An image, gradient or unresolved background gives `unknown`; `unknown` and `info` never fail.
- Config can override severity per rule (or turn it `off`) and set thresholds.
- Findings are deduped and sorted.

## JSON

The output must validate against `schema/v1.json` (draft-07; covers `version`, `project`, `routes[].tree`, `stats`, `unresolved`, `diff`, `tokens`, `findings`). Each style entry is `{value, source, approx?, expr?, alt?}`.

## Tests and gates (vitest)

- **Unit tests:**
  - evaluator (StyleSheet, Platform, rest params, runtime props, inlining, ×N, scheme themes)
  - colour (normalise, contrast, compositing, ΔE)
  - NativeWind classes (rem 14, arbitrary values, theme colours, variants, unknown classes)
  - scaler at 360×800, 390×844 and 402×874 (identity), plus `configureScaler`
  - each audit rule (pass, fail, unknown, config off)
  - CLI exit codes
- **Golden tests** for each fixture in two variants: defaults, and `ios·dark·390x844`. `UPDATE_GOLDEN=1` rewrites them.
- **Other checks:** schema validation (ajv), determinism, `--budget` never exceeded (80/120/200), and `--diff` on a temp git commit pair. The diff test must also leave the working tree untouched.
- **Fixtures:**
  - `expo-nativewind`: expo-router, NativeWind, CSS vars, `cn`, the scaler
  - `bare-stylesheet`: React Navigation, babel aliases, `.ios/.android` files, `Platform.select`
  - `themed`: create-expo-app `Colors` + `useColorScheme` hook, legacy `useThemeColor`, Context provider, `getStyles(isDark)`

**Gates:**
- **Fixtures:** ≥ 90% resolved, and every route ≤ 1500 o200k tokens. Run `node scripts/metrics.mjs --gate <roots>` to check.
- **Real app:** ≥ 85% resolved, and median ≤ 1.5k tokens. If any route goes over by default, report it and show that `--budget 1500` fits.

## Repo conventions

- **Tooling:** npm, eslint flat config with typescript-eslint, prettier, tsup.
- **CI** (`ci.yml`) runs on Node 20, 22 and 24: typecheck, lint, build, test, metrics gate, `npm pack --dry-run` and `npm audit`.
- **`publish.yml`** is `workflow_dispatch` only, with a `bump` choice input. It publishes with `npm publish --provenance --access public` using `NPM_TOKEN`.
- **Dependabot** checks npm and actions weekly, grouped.

## Done when

- build, typecheck, lint and tests all pass, and CI is green
- `npm pack --dry-run` lists only `dist`, `schema`, README, LICENSE, CHANGELOG and `package.json`
- the version matches the milestone
- the README covers install, CLI, all flags, examples, the output format, audit, config, CI usage and aggregate metrics

## Report

Repo URL, CI status, version, pack summary, gate numbers (fixtures %, real-app % and token max/median, o200k), flags, any deviations with reasons, and anything that blocks publishing.
