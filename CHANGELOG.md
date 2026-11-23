# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-11-23

### Added

- Publishes the engine's availability, version, work modes (`default`, `plan`)
  and model list to Cindy via `PUT /harnesses`, so the model selector can offer
  omp models before the first task runs.
- The node worker probes `omp acp` in a throwaway `--no-session` session
  (initialize + `session/new` only, no model calls).
- Settings page shows the probed state and refreshes it on open or on demand.

### Notes

- Cindy accepts at most 200 models per engine; omp currently reports 218, so the
  published list is capped at 200 in omp's own order.
- Per-model thinking levels are not published yet.

## [1.0.6] - 2026-11-23

### Changed

- Moved omp binary discovery into `lib/find-omp.cjs`, shared by the ACP entry
  and the node worker. No behavior change.

## [1.0.5] - 2026-11-23

### Changed

- Removed the unused `echo` method from the bundled Node worker; it now only
  answers `-32601`, keeping the `node.entry` required by the harness declaration.

## [1.0.4] - 2026-11-23

### Changed

- `minCindyVersion` is now `0.1.144`, the host version the harness API was
  verified on. (Per the plugin manual, the field records the tested host floor.)

## [1.0.3] - 2026-11-23

### Changed

- Binary discovery also checks `~/.bun/bin`, `~/.volta/bin`, `~/.npm-global/bin`,
  `/opt/local/bin` and nvm/fnm version bins, so an npm-installed `omp` is found
  without a login shell.
- `OMP_HARNESS_BIN` is resolved to an absolute path; relative values now work.
- Windows is explicitly unsupported instead of failing to spawn a `.cmd` shim.

## [1.0.2] - 2026-11-23

### Fixed

- Shut down omp's whole process group on POSIX (`SIGTERM`, then `SIGKILL` after
  2 s), so shell commands started by a task do not outlive the engine.
  A `SIGKILL` of the entry itself still cannot run cleanup: omp exits when its
  stdin closes, but may linger while a turn is in flight.

## [1.0.1] - 2026-11-23

### Fixed

- Handled closed ACP pipes: an unavailable or already-exited `omp`, and a client
  that closes the task, no longer crash the entry with an unhandled `EPIPE`.
  The entry now stops `omp` and exits cleanly.

## [1.0.0] - 2026-11-23

### Added

- Registers the local `omp` CLI as a Cindy ACP execution engine (`harnesses`).
- Byte-forwarding ACP entry `omp-acp.js`: `OMP_HARNESS_BIN` override, `PATH` lookup,
  optional `OMP_HARNESS_PROFILE`.
- Packaged artifact `omp-engine-1.0.0.cindy`.
