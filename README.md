# omp Engine

A Cindy plugin that runs tasks on the `omp` CLI installed on this computer. It
registers `omp` as a task execution engine; Cindy drives it over the Agent Client
Protocol (ACP) exactly like its built-in engines.

The plugin ships no agent tools. Pick **omp** as the engine when creating a task.

## Requirements

- Cindy **0.1.144** or newer (the harness API version this plugin is verified on).
- The `omp` CLI on the same computer, signed in the way plain `omp` is.
- macOS or Linux. Windows is not supported: the entry refuses to start rather
  than spawning a `.cmd` shim.

## Install

Import `omp-engine-<version>.cindy` from the [releases](../../releases) page (or
the file in this repository) via Cindy's plugin installer. The install card lists
the engine, which can read and write the task working directory, run commands and
use the same Cindy tools as the built-in Pi engine.

## Configuration

| Variable | Meaning |
| --- | --- |
| `OMP_HARNESS_BIN` | Absolute path to the `omp` binary. Overrides discovery. |
| `OMP_HARNESS_PROFILE` | omp profile name; runs `omp --profile <name> acp`. Empty uses the default profile. |

Discovery checks `PATH`, Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`),
MacPorts (`/opt/local/bin`), `~/.local/bin`, `~/.bun/bin`, `~/.volta/bin`,
`~/.npm-global/bin` and nvm/fnm version bins.

The plugin settings page shows the probed engine state (version, modes, model
count) and can refresh it.

## Behaviour

- One `omp acp` process per task; stdin/stdout carry ACP verbatim, logs go to
  stderr and land in the plugin log.
- On shutdown the entry stops omp's whole process group (`SIGTERM`, then
  `SIGKILL` after 2 s), so task shell commands do not outlive the engine.
- Engine availability, version, modes (`default`, `plan`) and models are
  published to Cindy via `PUT /harnesses`, so the model selector can offer omp
  models before the first task. The probe uses a throwaway `--no-session`
  session and never calls a model.
- Unavailable engines are published with a reason: `not-installed`, `no-acp`
  (the CLI has no `acp` command) or `probe-failed`, with a short hint.
- Provider quota windows are reported through the host `usage` call
  (`reportsUsage: true`), read from `omp usage --json`. No data, a timeout or an
  error returns `null`.
- Cindy accepts at most 200 models per engine; omp currently reports 218, so the
  list is capped in omp's order. Per-model thinking levels are not published yet.
- Local tasks only: `remoteWorkspace` / `guestWorkspace` are not declared.

## Development

```sh
./scripts/pack.sh                   # builds omp-engine-<version>.cindy from ghost.json
node scripts/smoke.mjs              # ACP handshake and worker probe, isolated sessions
node scripts/test-publish.mjs       # publishing page with fake cindy/fetch/channel
node scripts/test-shutdown.mjs      # SIGTERM removes the agent and its children
node scripts/test-availability.mjs  # not-installed / no-acp / probe-failed states
```

`CHANGELOG.md` records every release; `ghost.json.version` drives the artifact
name. Vendor the source of truth, not the packed file.

## License

MIT — see [LICENSE](LICENSE).
