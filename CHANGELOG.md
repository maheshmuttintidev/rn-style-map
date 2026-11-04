# Changelog

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
