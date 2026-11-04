# Plan: lead the README with "Use it as a PR check"

Source: a Reddit suggestion to lead with `--diff` against a git ref plus `--audit` failing CI, with a copy-paste GitHub Actions snippet.

## Changes
1. Add `## Use it as a PR check` directly under the one-line pitch and badges (anchor `#use-it-as-a-pr-check`).
2. Snippet: `actions/checkout` with `fetch-depth: 0`, `actions/setup-node` (Node 22), `npx -y @shayrn/rn-style-map --audit` as the gate, and `--diff origin/${{ github.base_ref }} --budget 1500 -o ui-diff.txt` written to `$GITHUB_STEP_SUMMARY` and uploaded as an artifact.
3. Replace the old lower `## CI usage` YAML with a one-line link to the new section (keep the AI-agent tip).
4. Add `.github/workflows/pr-check-example.yml`: the same snippet run on every PR against `fixtures/themed`, plus a self-test that `--audit --strict` exits 1.
5. CHANGELOG 0.4.1 (docs only). Release via `publish.yml` with `bump=patch`.

## Verified against the real CLI (src/cli.ts, src/diff/git.ts, `--help`)
- `--audit`: exit 1 on error findings, 0 otherwise; `--strict` makes warnings fail; `--exit-zero` always 0; 2 on usage/config error.
- `--diff <ref>`: never fails the build (exit 0; 2 on unknown ref). Uses `git rev-parse` + `git diff --name-only` + `git archive`, so full history (`fetch-depth: 0`) is needed and `origin/<base>` works. **Prints nothing when no screen changed**, so the summary step prints "No UI changes." for an empty file.
- `-o` writes the file even when output is empty, so the artifact upload always has a file.
- Diff/upload steps use `if: ${{ !cancelled() }}` so the diff still shows when the audit fails.
