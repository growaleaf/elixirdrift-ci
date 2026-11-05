# elixirdrift-ci

Fail CI when your Elixir version claims disagree with each other.

A project can declare its target Elixir version in four different places —
`.tool-versions` (asdf), `mix.exs`'s `elixir:` requirement, a `Dockerfile`'s
`FROM elixir:X.Y`, and a GitHub Actions workflow's `elixir-version:` — each edited by a
different person at a different time. They drift silently, and the bug that surfaces is
"works locally, breaks in the Docker image" (or the reverse), discovered in production, not
in review. Same shape as this lane's `nodedrift-ci`/`pydrift-ci`/`godrift-ci`/`rubydrift-ci`/
`javadrift-ci`/`rustdrift-ci`/`swiftdrift-ci`, ported to Elixir's own four files.

```
$ npx github:growaleaf/elixirdrift-ci check
elixirdrift-ci — mode: free (tool-versions + mix.exs only)
  no drift found.
  (free mode checked .tool-versions + mix.exs only — Pro also checks every Dockerfile and
  GitHub Actions workflow: https://elixirdrift-ci.madeforthisday.com)

$ ELIXIRDRIFT_KEY=... npx github:growaleaf/elixirdrift-ci check
elixirdrift-ci — mode: Pro (tool-versions + mix.exs + Dockerfile + CI workflows)
  DRIFT  [pinMismatch]  Pinned Elixir versions disagree: .tool-versions=1.17.3, Dockerfile:1=1.14-otp-25-slim, .github/workflows/ci.yml:8=1.17.3
  DRIFT  [mixElixirMismatch]  .tool-versions pins Elixir 1.17.3, which does not satisfy mix.exs elixir requirement "~> 1.15.0"
```

A deliberate CI version matrix (`elixir-version: ['1.15', '1.16', '1.17']`, used to test
multiple Elixir versions on purpose) is detected and reported as skipped — it is never
treated as drift.

## Install

No npm account needed — install straight from the GitHub repo:

```
npm install github:growaleaf/elixirdrift-ci
```

Or run it without installing:

```
npx github:growaleaf/elixirdrift-ci check
```

## Usage

```
node cli.js check [--dir <path>] [--json]
```

| Exit code | Meaning |
|---|---|
| 0 | no drift found |
| 1 | a drift finding exists — fail the build on this |
| 2 | configuration error — `--dir` does not exist |

`--json` writes the full report (every source checked, every finding, the skipped-matrix
list) to stdout, suited to a PR-comment bot or a lint-results artifact.

## Free vs. Pro

**Free, no key needed:** compares `.tool-versions`' `elixir` line against `mix.exs`'s
`elixir:` requirement. Useful on its own for a project with no Docker image and no
CI-declared Elixir version.

**Pro ($9, one time):** also scans every `Dockerfile` (any file matching `Dockerfile*`,
anywhere in the repo) and every `.github/workflows/*.yml` for an `elixir-version:`
declaration, and cross-checks every source against every other source — this is where the
real bugs are, since the Dockerfile and the CI workflow are usually the two files furthest
from active editing.

The license key is checked **offline** — an ECDSA-signed token verified locally; the CLI
makes no network call to check it, ever, and reads neither your source files nor your
repository name over the network at any point.

```
export ELIXIRDRIFT_KEY=<your key>       # CI secret
# or, on your own machine:
mkdir -p ~/.elixirdrift && echo "<your key>" > ~/.elixirdrift/license
```

Buy a key: https://elixirdrift-ci.madeforthisday.com (one-time purchase, no subscription).

## A real nuance in Elixir's own version requirement syntax

Elixir's `~>` ("tilde") requirement operator behaves differently depending on whether a
patch number is given — the *opposite* shape from this family's Python/Ruby siblings:

- `elixir: "~> 1.17"` (no patch) locks the **major** version: any `1.x` satisfies it, but
  `2.0` does not. At major.minor granularity this is a floor with an upper cap at the next
  major.
- `elixir: "~> 1.15.0"` (patch given) locks the **minor** version: only `1.15.x` satisfies
  it. At major.minor granularity this is an exact pin.

Both forms are handled. `==X.Y`, a bare `X.Y`, and `>=X.Y`/`>=X.Y and <X.Y` are also
supported.

## How this differs from an existing tool you may already know

A search of the npm registry and GitHub for a tool that cross-checks `.tool-versions` +
`mix.exs`'s `elixir:` requirement + `Dockerfile` + CI workflow `elixir-version` declarations
together turned up nothing with that exact scope as of 2026-11-05 — this is a narrow,
specific gap, not a crowded one. `driftcheck-py` (PyPI, Python) checks `mix.exs`'s `elixir:`
version against documentation (README), a different pair of sources with a different job;
it does not cross-check a Dockerfile or CI workflow.

## Source

Source is readable here before you buy. The free tier works as shipped; the Pro tier needs
a key (see `LICENSE`).
