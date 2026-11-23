# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-11-23

### Added

- Publishes the engine's availability, version, work modes (`default`, `plan`)
  and model list to Cindy via `PUT /harnesses`, so the model selector can offer
  omp models before the first task runs.
- The node worker probes `omp acp` in a throwaway `--no-session` session
  (initialize + `session/new` only, no model calls).
- Settings page shows the probed state and refreshes it on open or on demand.
- README shipped as the plugin's `readme`.
- `scripts/smoke.mjs` (repository only): ACP handshake, missing-binary
  regression and worker probe checks; no model calls. The run uses a throwaway
  session dir, so it does not write to the user's omp history.
- `scripts/test-publish.mjs` (repository only): covers the publishing page with
  fake `cindy`, `fetch` and `BroadcastChannel`, including refresh and failure.

### Fixed

- Closed ACP pipes no longer crash the entry with an unhandled `EPIPE`; the
  entry stops omp and exits cleanly.
- The published model list now keeps only omp's chat models, removes duplicate
  ids and still caps the list at 200. If the chat catalog is unavailable, the
  ACP list is used as-is.
- Shutdown reaches omp's whole process group (`SIGTERM`, then `SIGKILL` after
  2 s), so shell commands started by a task do not outlive the engine.
- `minCindyVersion` raised to `0.1.144`, the host the harness API was verified
  on.

### Changed

- Binary discovery checks `~/.bun/bin`, `~/.volta/bin`, `~/.npm-global/bin`,
  `/opt/local/bin` and nvm/fnm version bins; `OMP_HARNESS_BIN` is resolved to an
  absolute path; Windows is rejected explicitly instead of spawning a `.cmd`
  shim.
- omp discovery moved to `lib/find-omp.cjs`, shared by the ACP entry and the
  node worker.
- The node worker no longer exposes the unused `echo` method.

### Notes

- Cindy accepts at most 200 models per engine; only omp's chat models are
  published (84 at the time of writing), so the cap is a guard, not a filter.
- Per-model thinking levels (`efforts`) are not published yet.
- A `SIGKILL` of the entry cannot run cleanup: omp exits on stdin EOF but may
  linger while a turn is in flight.

## [1.0.0] - 2026-11-23

### Added

- Registers the local `omp` CLI as a Cindy ACP execution engine (`harnesses`).
- Byte-forwarding ACP entry `omp-acp.js`: `OMP_HARNESS_BIN` override, `PATH` lookup,
  optional `OMP_HARNESS_PROFILE`.
- Packaged artifact `omp-engine-1.0.0.cindy`.
