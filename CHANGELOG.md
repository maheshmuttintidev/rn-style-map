# Changelog

## 0.5.0

- Opt-in `--explain` / `--why` (and `run({ explain: true })`): for each overridden style prop, print the layer stack and which source won (`↳ p=8 ← inline … over stylesheet …`). Works in compact, md, and json (json adds optional `layers` on style entries).
- Traces StyleSheet refs, style arrays, inline styles, conditionals, `Platform.select`, and NativeWind classes when feasible; untraceable values are labelled, never guessed.
- Without `--explain`, compact/md/json output is unchanged (goldens byte-identical). `--diff` signatures ignore explain text. `--budget` drops explain lines first when both flags are on.

## 0.4.2

- Docs: `Dimensions.get` / `useWindowDimensions` resolve from `--viewport` (not listed under `RUNTIME_VALUE`). Added a short FAQ on runtime/dynamic styles. CLI `--version` now tracks `package.json`.
- Test: fixture covering `Dimensions.get` and `useWindowDimensions` at the chosen viewport.

## 0.4.1

- Docs: README now leads with a copy-paste "Use it as a PR check" GitHub Actions workflow (`--audit` gate + `--diff origin/<base>` in the job summary). No code changes.

## 0.4.0

- `--diff <ref>`: only routes and nodes changed vs a git ref. It uses a temporary `git archive` checkout and never touches your working tree. Removed nodes are listed as `- …`.
- `--budget <n>`: per-route token cap (o200k), trimmed in priority order, with a `· trimmed:` footer.
- Font family aliases (`fonts F1=…`) when a family repeats.
- Route-level props (`navigation`, `route.params`, others) are reported as `RUNTIME_VALUE` instead of being dropped.

## 0.3.0

- `--audit`: 13 rules (WCAG 2.2 1.4.3 / 1.4.11 / 2.5.8, HIG/Material targets, a11y label/role, type size and scaling, design-system counts, near-duplicate colours, spacing grid). `--strict`, `--exit-zero`, exit codes 0/1/2.

## 0.2.0

- NativeWind: Tailwind config loading, rem 14, `dark:`/`ios:`/`android:` variants, `cn`/`clsx`/`twMerge`, CSS variables from `global.css`.
- Theme: scheme-keyed constants through hooks and Context, `useColorScheme`, `--scheme`, `--viewport`, `--tokens`.
- Scaler maths for `@shayrn/react-native-scaler` (reference 402×874) and `react-native-size-matters`.

## 0.1.0

- Route discovery (expo-router, React Navigation, `--entry`), StyleSheet/inline/array/conditional styles, `Platform.select`, platform files, compact/json/md output, `schema/v1.json`.
