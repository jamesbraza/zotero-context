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

### WSL

Zotero has no WSL build, but the Linux build runs fine under WSLg:

```shell
mkdir -p ~/.local/opt && cd ~/.local/opt
URL='https://www.zotero.org/download/client/dl?platform=linux-x86_64&channel=release'
wget -O zotero.tar.xz "$URL"
tar -xJf zotero.tar.xz && rm zotero.tar.xz
sudo apt-get install -y libasound2t64 libdbus-glib-1-2  # Ubuntu 24.04 runtime deps
```

Then point `.env` at `~/.local/opt/Zotero_linux-x86_64/zotero`,
use fresh directories for the profile and data-dir paths (they're created on first run),
and add `DISPLAY = :0` so the GUI appears on the WSLg desktop.
To sanity-check a build on Windows Zotero,
`npm run build` and install `.scaffold/build/*.xpi` via Tools → Plugins → Install Plugin From File
(bump `version` in `package.json` locally first, since same-version reinstalls don't reliably
swap the loaded code, but don't commit the bump).

## Testing

`npm test` builds the plugin and runs the mocha suites in `test/` inside a live Zotero instance,
so tests have the real `Zotero` API and reader available
(see `test/core.test.ts` for pure-logic tests; throwaway probe suites that open a real reader
and dump internals findings to JSON are a useful pattern for diagnosing reader-internals
issues, but are kept out of version control).
Caveats:

- Run one test invocation at a time;
  concurrent runs contend over the shared test profile and hang.
- A run takes minutes (it boots Zotero); killed runs can orphan `zotero-bin` processes
  that later runs then trip over.
- The generated `typings/i10n.d.ts` is rewritten by builds;
  concurrent build/typecheck can race on it (rerun typecheck if it flags locale keys).

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
