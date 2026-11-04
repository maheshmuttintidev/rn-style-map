# @shayrn/rn-style-map

> **Offline CLI that prints every React Native screen as a compact component tree with resolved styles and `file:line`, so AI agents and CI can reason about UI without a device, a screenshot, or an LLM.**

[![CI](https://github.com/maheshmuttintidev/rn-style-map/actions/workflows/ci.yml/badge.svg)](https://github.com/maheshmuttintidev/rn-style-map/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

```
# /settings  src/app/settings.tsx  android·dark·360x800  resolved 18/18 (100%)  ~145 tok
layout src/app/_layout.tsx
View px16 bg#1C1B1F flex1 pt24  settings.tsx:18
  Text "Settings" w700 22 #E6E1E5 mb16  settings.tsx:19
  View×3 py12 bdb1 bdbc#49454F  settings.tsx:21
    Text "Account" 16 #FFF  settings.tsx:22
  Text "Sign out" 14 #D0BCFF mt24  settings.tsx:25
```

- **Static.** Babel parse + a small evaluator. Nothing is executed, no Metro, no simulator, no network.
- **AI-agnostic.** Plain text, JSON, or Markdown. No model calls, no API keys.
- **Low-token.** About 150–500 tokens per screen (o200k). `--budget` caps it.
- **Honest.** Values it cannot know statically are listed as unresolved with a reason code. It never guesses.
- **Understands** `StyleSheet.create`, inline styles, style arrays and conditionals, `Platform.select`/`.ios.tsx`, NativeWind `className` (with `dark:`/`ios:` variants, `cn`/`clsx`, CSS variables), scheme-keyed theme constants via hooks and Context, and `@shayrn/react-native-scaler` / `react-native-size-matters` maths at a chosen viewport.
- **Routers:** expo-router (`app/` or `src/app/`), React Navigation (`Stack.Screen`/`Tab.Screen`), or a single `--entry` file.

## Install

```sh
npm i -D @shayrn/rn-style-map     # or: npx @shayrn/rn-style-map
```

Node ≥ 20.19. Your project does not need `node_modules` installed. A TypeScript `tailwind.config.ts` needs Node ≥ 22.6, because it is loaded with type stripping; `.js`/`.cjs`/`.mjs` configs work everywhere.

## CLI

```sh
rn-style-map                                   # every route, compact
rn-style-map --route /login --route "/(tabs)/*"
rn-style-map --platform ios --scheme dark --viewport 390x844
rn-style-map --format md --budget 1500         # fit each route into 1.5k tokens
rn-style-map --unresolved                      # list what could not be resolved, and why
rn-style-map --tokens                          # colour / font / spacing / radius usage table
rn-style-map --audit                           # WCAG 2.2 / HIG / Material checks; exit 1 on errors
rn-style-map --diff origin/main                # only routes and nodes changed vs a git ref
rn-style-map --entry src/components/Card.tsx   # one component, no route discovery
```

### Flags

| Flag | Meaning | Default |
|---|---|---|
| `--route <glob>` | Route path(s). Repeatable or comma-separated; `*` globs | all routes |
| `--entry <file>` | Map one component file instead of discovering routes | – |
| `--depth <n>` | Max tree depth; hidden children shown as `…+N` | `6` |
| `--only <names>` | Keep only these component names (ancestors shown as `…Name`) | – |
| `--tokens` | Print the token table (colours, fonts, font sizes, spacing, radii) with use counts | off |
| `--format <fmt>` | `compact` \| `json` \| `md` | `compact` |
| `--budget <n>` | Token cap per route (o200k, min 50). Trims in order: `×N` collapse, default-valued props, `$sN` style refs, line-only locations, depth, text. The footer says what was trimmed | none |
| `--diff <ref>` | Only routes/nodes changed vs a git ref. Removed nodes are listed as `- …` | – |
| `--platform <p>` | `android` \| `ios` | `android` |
| `--scheme <s>` | `light` \| `dark` | `light` |
| `--viewport <WxH>` | Window size in dp for scaler helpers and `%`/breakpoints | `360x800` |
| `--unresolved` | Detailed unresolved list (`file:line prop=expr (REASON)`) | summary only |
| `--audit` | Run the audit engine | off |
| `--strict` | With `--audit`: warnings fail too | off |
| `--exit-zero` | With `--audit`: report only, always exit 0 | off |
| `--root <dir>` | Project root | cwd |
| `--config <file>` | Config file | `<root>/rn-style-map.config.json` |
| `-o, --out <file>` | Write to a file instead of stdout | stdout |

Exit codes: `0` ok · `1` audit found errors (or warnings with `--strict`) · `2` usage/config error (bad flag, no routes found, unknown route). Set `RN_STYLE_MAP_DEBUG=1` for stack traces.

## Output format (compact)

```
# <route>  <file>  <platform>·<scheme>·<W>x<H>  resolved <n>/<total> (<pct>%)  ~<tokens> tok
layout <layout files, outermost first>
fonts F1=<family> …            # only when a family repeats ≥ 3 times
<Component>[×N] ["text"] <props…>  <file>:<line> [← :<callsite line>]
  <children, two-space indent>
? <n> unresolved: REASON×n … (--unresolved for details)
· trimmed: … (only with --budget)
```

Props use short keys followed by the value: `p` `px` `py` `pt`… padding, `m…` margin, `w` `h` `minW` `maxH`, `r` radius, `bd1#E4E4E7` border width+colour, `bg#FFF` background, `gap`, `flex1`, `row`, `center`, `ai-center`, `jc-between`, `o0.7` opacity, `abs`, `clip`. Typography is `Family-Weight size/lineHeight #color`. Anything without a short key is shown as `key:value`.

- `~` marks a value computed from a scaler at the chosen viewport (`~p21` = `scale(24)` at 360×800).
- `?` after a key (`w?`) marks an unresolved value.
- `a11y:button"Label"` shows role and label; `a11y:—` is an interactive element with neither.
- `×3` means rendered from `.map()` or list data, or repeated identical siblings.
- `← :58`: the node comes from a component used at line 58 of the route file.

`--format json` follows [`schema/v1.json`](schema/v1.json). Every style value carries its `source` (`stylesheet`, `inline`, `theme`, `nativewind`, `prop`); scaler values carry `approx: true` and the source `expr`. `--format md` gives one fenced block per route, plus tables.

### Unresolved reason codes

`RUNTIME_VALUE` (props, state, network, `Dimensions` at runtime) · `SPREAD` (spread of an unknown object) · `UNKNOWN_IMPORT` (file not found / package code) · `DYNAMIC_CLASS` (computed `className`) · `UNKNOWN_CLASS` (class not in your Tailwind theme) · `HOOK_UNSUPPORTED` · `CONDITIONAL_UNKNOWN` (branch could not be decided) · `EXTERNAL_COMPONENT` (third-party component internals).

## Audit

`--audit` checks the resolved tree. Every finding has a rule id, `file:line`, and a link to the guideline.

| Rule | Severity | Check |
|---|---|---|
| `wcag-1.4.3` | error | Text contrast ≥ 4.5:1 (3:1 for large text), against the nearest resolved ancestor background with alpha composited |
| `wcag-1.4.11` | warn | Border/icon contrast ≥ 3:1 |
| `wcag-2.5.8` | error | Touch target ≥ 24×24 (with `hitSlop`) |
| `hig-target-44` / `md-target-48` | warn | Platform target guidance (44pt iOS / 48dp Android) |
| `a11y-label` / `a11y-role` | warn | Interactive elements have a label and role |
| `type-min-size` | warn | Font size ≥ 12 |
| `type-font-scaling` | warn | `allowFontScaling={false}` / `maxFontSizeMultiplier` < 1.5 |
| `ds-font-count` / `ds-color-count` | warn | Too many font families/sizes/colours across the project |
| `ds-near-dup-color` | info | Colours within ΔE 3 of each other |
| `ds-spacing-grid` | info | Spacing off the 4-pt grid |

When a background is an image, a gradient or unresolved, the finding is `unknown`, not a guess. `unknown` and `info` never fail a build.

## Config (`rn-style-map.config.json`, optional)

```json
{
  "scaler": { "referenceWidth": 402, "referenceHeight": 874 },
  "scalers": { "my-scale-lib": { "wp": { "axis": "width", "reference": [375, 812] } } },
  "rem": 14,
  "css": ["src/global.css"],
  "ignore": ["**/*.stories.tsx"],
  "audit": {
    "severity": { "ds-spacing-grid": "off", "hig-target-44": "error" },
    "minFontSize": 12, "maxColors": 12, "maxFontFamilies": 3, "maxFontSizes": 8, "spacingGrid": 4, "nearDuplicateDeltaE": 3
  }
}
```

`configureScaler({...})` calls in your source are picked up automatically.

## CI usage

```yaml
# .github/workflows/ui.yml
on: pull_request
jobs:
  ui:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx @shayrn/rn-style-map --audit                       # fails on WCAG errors
      - run: npx @shayrn/rn-style-map --diff origin/${{ github.base_ref }} --budget 1500 -o ui-diff.txt
      - uses: actions/upload-artifact@v4
        with: { name: ui-diff, path: ui-diff.txt }
```

With an AI agent, put `npx @shayrn/rn-style-map --route <screen>` in your agent instructions and the agent can read layout, colours, spacing and `file:line` before it edits.

## Library API

```ts
import { map, tokens, audit, run } from '@shayrn/rn-style-map';
const result = map({ root: '.', platform: 'ios', scheme: 'dark' });   // MapResult (schema v1)
const { output } = await run({ root: '.', format: 'compact', depth: 6, platform: 'android', scheme: 'light', viewport: { width: 360, height: 800 }, unresolved: false, budget: 1500 });
```

## Measured

Token counts use `gpt-tokenizer` with the **o200k** encoding.

| Project | Routes | Style props resolved | Tokens/route (max · median) |
|---|---|---|---|
| `fixtures/expo-nativewind` | 4 | 100% | 323 · 257 |
| `fixtures/bare-stylesheet` | 3 | 100% | 255 · 233 |
| `fixtures/themed` | 3 | 100% | 165 · 146 |
| A real Expo app (StyleSheet + theme hook + scaler) | 13 | 99.9% (1489/1490) | 1661 · 491 (1467 max with `--budget 1500`) |

The real-app run takes about 0.25 s for 13 routes. CI fails if any fixture drops below 90% resolved or goes over 1500 tokens per route (`node scripts/metrics.mjs --gate`).

## Limits

- It reads code; it does not run it. Values from props, state, network or measured layout stay unresolved, and are reported.
- Shadows and transforms are shown as given, not composited. `trackColor`-style object props on third-party components are not shown.
- Tailwind `plugins` that add utilities at runtime are not executed; such classes report `UNKNOWN_CLASS`.

## License

MIT © Mahesh Muttinti
