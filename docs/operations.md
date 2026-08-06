# Operations

Normal operation is reading entities and reviewing drafts. Administrative commands are:

```text
buro init
buro backup
buro serve --host 0.0.0.0 --port 8765
```

`buro init` creates or validates the active registry. `buro backup` uses SQLite's online backup API and applies retention in-process. BURO has no database daemon, backup timer, import pipeline, or alternate storage model.

## Deployment

The Politia operator deployment packs once, backs up the central database, installs the same package centrally and on reachable workers, restarts the API, verifies generic entity output, and removes package artifacts. Worker topology is read from `buro list host`; explicit `BURO_WORKER_HOSTS` overrides discovery.

```sh
npm run deploy:live -- --dry-run
npm run deploy:live
```

An offline worker is reported and left untouched. A worker that fails during copy, install, cleanup, or configuration makes the deployment fail.

## Verification

Verification uses real source, database, API, draft, package, service, and worker surfaces. This repository does not maintain unit, integration, or smoke-test files.
