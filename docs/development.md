# Development and packaging

[English](development.md) · [Русский](development.ru.md) · [README](../README.md)

BURO runs from source; there is no transpiler, bundle, or mandatory server.
Use Node.js 24.14 or newer. `node:sqlite` is provided by Node; `js-yaml` is the
only external runtime dependency.

```sh
git clone https://github.com/Krablante/buro.git
cd buro
npm ci
node src/cli.js help
```

Keep experiments away from your normal registry. These environment settings
select a disposable local instance and do not replace your normal config:

```sh
export BURO_CONFIG=/tmp/buro-development/config.json
export BURO_ROOT=/tmp/buro-development/data
export BURO_MODE=local
node src/cli.js init
node src/cli.js draft new example project
# Edit the printed draft; add one important rule.
node src/cli.js draft diff
node src/cli.js draft push
node src/cli.js example
```

Use another empty directory if that one already contains work. Windows users
set the same variables with PowerShell's `$env:` syntax and choose Windows
paths. Public CLI and connection files support Windows/macOS; the Politia
deployment script is Linux-specific.

## What belongs where

`src/` contains the program, `types/` contains independent public definitions,
and `presets/` contains the starter selection and Politia's full model.
`presets/legacy/` holds exact historical definitions needed to recognize old
databases and exports. They are compatibility data, not another active model.
`integrations/` and `skills/` are files installed by `buro connect`; `scripts/`
holds rollout and terminal-media tooling. Runtime databases, backups, drafts,
packages, and audit evidence belong outside the checkout. Component boundaries
are described in [architecture](architecture.md).

Fix behavior at its owner. Validation belongs in the schema or resolver, not
in a separate implementation for each CLI/API route. Client display logic must
not need a full registry export. Reuse the existing indexes before adding more
tables or infrastructure.

## Verify the behavior you changed

Exercise the real interface in the disposable instance. For a draft change,
complete create, pull, diff, push, and delete; confirm that a failed push keeps
the draft. For a model change, preview a compatible addition and an incompatible
removal, confirm the latter leaves data untouched, and restore an export in a
second instance. For a transport change, start the source API and use the CLI
as a client against it:

```sh
node src/cli.js serve --port 18765
# In a second terminal with the same isolated config/root:
BURO_MODE=client BURO_API_URL=http://127.0.0.1:18765 node src/cli.js example
```

Check JavaScript syntax in touched files, `bash -n scripts/deploy-live.sh` for
rollout edits, and `npm audit --omit=dev` for dependency changes. For large-data
work, record registry size and payload size, measure the same operation before
and after on the same machine, and account for full-database backup I/O. Avoid
using the operator's registry as a benchmark fixture.

## Package and release

`npm pack` is the build. Choose a directory outside the checkout and inspect
the package before installing it in an isolated prefix:

```sh
npm pack --dry-run
npm pack --pack-destination /tmp
npm install -g /tmp/buro-<version>.tgz --prefix /tmp/buro-package-check
/tmp/buro-package-check/bin/buro --version
```

Use the actual version from `package.json` in those paths. Verify the installed
CLI with a fresh isolated registry, including `buro agent` and a connection to
a temporary client profile. A source checkout passing checks does not prove
that an installed package works.

Public packages are GitHub release assets. A release should use one matching
package version and lockfile, a tag identifying the reviewed source, and the
verified tarball. Update installation URLs in both READMEs only when that asset
exists. Verify its checksum after download. Publishing and deploying are
separate operations; [operations](operations.md) owns the latter.

## Terminal demos

`npm run demos` renders the English and Russian GIFs from actual CLI use in
isolated starter instances. `npm run demos:check` regenerates and compares them.
Use the same ffmpeg/font environment for byte comparisons; renderer changes
can change pixels without changing BURO behavior. Inspect the generated frames
when command output or layout changes.

Rendering requires ffmpeg's ass/palette filters and DejaVu Sans/Mono. Set
`BURO_DEMO_FONTS_DIR` if the fonts live elsewhere. Media tooling is optional for
ordinary source work, packaging, and runtime rollout.

## Documentation languages

English uses the unsuffixed filename; each additional locale uses a language
suffix: `README.ru.md`, `docs/model.ru.md`, and so on. Use this rule for every
category. Add `*.uk.md` or `*.de.md` without moving existing files or changing
the program. Keep the language links at the top of each document and the README
topic table in sync with the available translations.

The README introduces the product and first use. Model, agents, drafts,
interfaces, architecture, operations, and development each own one subject.
Change the relevant translations together when behavior changes; equivalent
meaning matters more than sentence-by-sentence translation. A new language
must follow the same topic boundaries. Terminal media translations live in
the generator's `translations` object.
