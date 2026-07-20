# Contributing

## Prerequisites

- [Zotero](https://www.zotero.org/download/) matching the targeted major version
  - Use a [beta build](https://www.zotero.org/support/beta_builds) if that version is pre-release
- [Node.js](https://nodejs.org/) latest LTS
- [prek](https://github.com/j178/prek) for pre-commit hooks

## Setup

```shell
git clone git@github.com:jamesbraza/zotero-context.git
cd zotero-context
npm install
prek install
```

Then create a `.env` pointing at your Zotero binary and development profile.
On Linux this discovers both automatically
(macOS/Windows paths differ, see the comments in `.env.example`):

```shell
cp .env.example .env
ZOTERO_BIN=$(command -v zotero)
: "${ZOTERO_BIN:?zotero not found on PATH - set ZOTERO_BIN manually}"
PROFILES_DIR=~/.zotero/zotero
PROFILE=$PROFILES_DIR/$(awk -F= '/^Path=/ {print $2; exit}' $PROFILES_DIR/profiles.ini)
sed -i \
  -e "s|^\(ZOTERO_PLUGIN_ZOTERO_BIN_PATH = \).*|\1$ZOTERO_BIN|" \
  -e "s|^\(ZOTERO_PLUGIN_PROFILE_PATH = \).*|\1$PROFILE|" \
  .env
```

This snippet uses the first profile in `profiles.ini`;
pick a different `Path=` if your dev profile isn't first.
Also, profiles with `IsRelative=0` carry absolute paths,
in which case set `PROFILE` manually.

## Development

`npm start` builds the plugin in development mode, launches Zotero with it loaded,
and watches `src/**` and `addon/**` to rebuild and hot-reload on change.

Debugging tips: run snippets in Zotero via Tools → Developer → Run JavaScript,
and log with `Zotero.debug()` (view via Help → Debug Output Logging → View Output).

## Checks

Pre-commit hooks run automatically on staged files via prek.
To run all hooks against the whole repo:

```shell
prek run --all-files
```

Or run tools individually:

```shell
npm run lint:check  # Prettier + ESLint, check only
npm run lint:fix    # Prettier + ESLint with autofix
npm run typecheck   # tsc --noEmit
npm run test        # Build and run tests in a live Zotero instance
npm run build       # Production build into .scaffold/build/, with .xpi
```

GitHub Actions CI runs the same hooks (plus build and test)
on pushes to `main` and pull requests targeting `main`.

## Release

Publish a release on GitHub whose tag is a `v`-prefixed
[Semantic Versioning 2.0.0](https://semver.org) version (e.g. `v1.2.3-beta.1`).
Note the workflow fires on publish, so a draft release triggers nothing until published.
Publishing triggers the Release GitHub Actions workflow,
which validates the tag shape, stamps its version into `package.json`
(the committed version intentionally stays `0.0.0`),
builds the plugin, and publishes the `.xpi` and update manifests.
