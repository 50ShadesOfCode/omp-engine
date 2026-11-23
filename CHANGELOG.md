# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
