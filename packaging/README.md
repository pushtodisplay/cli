# Packaging

Distribution recipes for the pushtodisplay CLI, kept with the source of truth
so release bumps are reproducible.

## Channels

| Channel | Files | State |
|---|---|---|
| conda-forge | `conda-forge/recipe.yaml` (v1 format, single file) | PR [#34612](https://github.com/conda-forge/staged-recipes/pull/34612) open; feedstock `pushtodisplay-feedstock` auto-created on merge |
| AUR | `aur/` (PKGBUILD + .SRCINFO) | Packaged + validated; submission blocked until AUR reopens registration |

conda-forge package page (after merge): `anaconda.org/conda-forge/pushtodisplay`
AUR package page (after submission): `aur.archlinux.org/packages/pushtodisplay`

## Release bump checklist

For each new CLI release (`vX.Y.Z`, tagged upstream as `cli-vX.Y.Z`):

1. **conda-forge** — normally nothing to do: the autotick bot opens a version-bump
   PR on the feedstock when a GitHub Release is created. Create the GitHub Release
   (tags alone don't trigger the bot). If the bot misses it, edit `recipe.yaml`
   (source `url`/`sha256`) via a feedstock PR.
2. **AUR** — edit `aur/PKGBUILD`:
   - `pkgver=X.Y.Z`
   - `sha256sums` from `curl -sL https://github.com/pushtodisplay/cli/archive/refs/tags/cli-vX.Y.Z.tar.gz | sha256sum`
   - regenerate: `makepkg --printsrcinfo > .SRCINFO` (on an Arch machine; requires `makepkg`)
   - push to the AUR repo once registration is open again.

## Validation

- conda-forge: `conda smithy recipe-lint <dir>` (must be clean) and
  `conda build <dir>` (linux; Windows is covered by staged-recipes CI).
  Recipe must be v1 `recipe.yaml` — staged-recipes rejects modern recipes in the
  legacy `meta.yaml` format ("Mixing meta.yaml and recipe.yaml recipes is not
  supported"). Windows build notes: (1) `call` is required before `npm` —
  npm on Windows is npm.cmd, a batch file, and invoking a batch from a batch
  without `call` never returns to the caller (the rest of the script silently
  never runs); (2) npm's `--prefix` shims land in the prefix root, which is
  not on conda's Windows PATH — the win branch writes position-independent
  shims to `Library\bin` (cmd + PowerShell variants).
- AUR: `makepkg -f` + spot-check `pushtodisplay --version` / `--help`.