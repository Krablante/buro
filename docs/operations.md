# Operations

Normal operation is reading entities and reviewing drafts. Administrative commands are:

```text
buro init
buro backup
buro export <file>
buro import <file> [--adopt]
buro serve --host 127.0.0.1 --port 8765
```

`buro init` creates the registry or explicitly adopts the active preset after validating every stored entity. It backs up an existing database before validation. Ordinary reads refuse a preset id, version, or hash mismatch.

`buro backup` uses SQLite's online backup API and applies retention in-process. Every successful entity mutation also creates a pre-mutation snapshot. BURO has no database daemon, backup timer, alternate storage model, or migration language.

`buro export` and `buro import` are the full-registry portability path. Keep exports in private state: they contain instance facts. For an incompatible schema change, export under the old preset, transform the entities, then import under the new preset with explicit `--adopt`. Import validates everything before changing SQLite and replaces the registry in one transaction.

`init`, `backup`, `export`, `import`, and `serve` require local or central mode. Client mode has no local storage.

`buro serve` has no built-in authentication or TLS. Bind it to `127.0.0.1` unless a trusted private network or external proxy provides the access boundary.

## Politia maintainer deployment

The repository's `npm run deploy:politia` / `npm run deploy:live` script is the real Politia operator deployment, not a generic installer. It packs once, writes explicit `politia` central/client configs, installs the package centrally, takes an online backup, restarts the API, installs the same package on reachable workers, verifies generic entity output, and removes package artifacts. Worker topology comes from `buro list host`; `BURO_WORKER_HOSTS` overrides discovery.

```sh
npm run deploy:politia -- --dry-run
npm run deploy:politia
```

An offline worker is reported and left untouched. Copy, install, cleanup, or configuration failure on a reachable worker fails the deployment.

## Verification

Verification uses real source, SQLite, export/import, API, draft, package, service, and worker surfaces. This repository deliberately keeps no unit, integration, or smoke-test files; the operator workflow validates the actual interfaces that users and agents run.
