# Contributing to a365-auth

This is a **spec-central monorepo**: a single language-neutral contract
(`spec/`) with idiomatic client libraries (`libs/<lang>/`) that are all held to the
**same conformance vectors**. Contributions that respect that model are very welcome.

> **Read [AGENTS.md](./AGENTS.md) first** — it's the working model for both humans and
> AI agents (the spec-first, vector-validated loop). This file is the quick reference.

## The model in one line

Behavior is defined by `spec/`, proven by `spec/conformance/vectors.json`, and
implemented identically in every library. Change the contract, not just a library.

## Repository layout

```
spec/            Normative spec (SPEC.md) + JSON Schemas + conformance vectors
docs/            Conceptual, language-neutral guides
libs/typescript/ @altium-developer/a365-auth  (npm)
libs/dotnet/     Altium.Auth                   (nuget.org)
.github/workflows/  Per-library, path-filtered CI + tag-prefixed release
```

`spec/` and `docs/` are shared. Everything a library needs to build/test/publish lives
under its `libs/<lang>/` directory.

## Development setup

```bash
git clone https://github.com/AltiumDeveloper/a365-auth.git
cd a365-auth
```

Then work inside the library you're changing:

**TypeScript** (`libs/typescript`)

| Command | What it does |
|---------|--------------|
| `npm ci` | Install dev dependencies |
| `npm test` | Unit tests (Vitest) |
| `npm run test:conformance` | Run the shared conformance vectors |
| `npm run lint` / `npm run typecheck` | Lint / type-check |
| `npm run build` | Compile `src/` → `dist/` |
| `npm run test:e2e -- <clientId>` | Live browser sign-in (needs network + browser) |

**.NET** (`libs/dotnet`)

| Command | What it does |
|---------|--------------|
| `dotnet test tests/Altium.Auth.Tests -c Release` | xUnit conformance over the shared vectors |
| `sh build-offline.sh` | Same vectors with no NuGet (locked-down environments) |
| `dotnet run --project tools/SignInTest -- <clientId>` | Live sign-in (needs network + browser) |

## Changing behavior (the contract)

Anything that changes what goes on the wire or how a response is interpreted starts in
`spec/`, not in a single library:

1. Update `spec/SPEC.md` (semantics) and any affected `spec/schemas/*.json`.
2. Add/adjust vectors in `spec/conformance/vectors.json` (format: `spec/conformance/README.md`).
3. Implement in **every** `libs/<lang>/` and update each library's API docs.
4. Make **all** conformance runners green (plus unit/lint/typecheck/build per library).
5. Update the root [README](./README.md) conformance matrix and each changed library's `CHANGELOG.md`.

Keep cross-language **parity**: a capability added to one library must be added to the
others, or recorded as an explicit gap in the conformance matrix. Keep the Altium
**delta thin** — don't re-implement standard OAuth/OIDC behavior; and don't add
dependencies to these security-sensitive clients without discussion.

**Update the human-visible docs too.** Any change to the contract or a library's public
behavior must be reflected in the affected `docs/*.md` guide(s) and each changed
library's README in the same PR — the conceptual docs live in-repo precisely so they
stay in lock-step with the spec and the code.

Adding a whole new language? See "Adding a new language" in the root README and the
playbook in AGENTS.md.

## Commit & PR conventions

- Follow [Conventional Commits](https://www.conventionalcommits.org/) where practical.
- A PR is complete only when every **affected** library passes conformance + unit tests
  + lint/typecheck/build, and the docs/READMEs are updated. CI enforces the build gates
  per library (a `spec/**` change triggers all).
- Explain material design decisions in the PR description (and the spec, where they
  affect the contract).
- **Never** put secrets in code, tests, or CLI args — they come from environment variables.

## Releasing (maintainers)

Libraries version and publish **independently**, from tag-prefixed releases:

- **TypeScript** → npm: move `## [Unreleased]` notes under a version in
  `libs/typescript/CHANGELOG.md`, bump the version, push a `ts-v<version>` tag.
  `typescript-release.yml` publishes with provenance.
- **.NET** → nuget.org: bump the version in `libs/dotnet/src/Altium.Auth/Altium.Auth.csproj`,
  push a `dotnet-v<version>` tag. `dotnet-release.yml` packs and pushes (gated on conformance).

## Reporting security issues

Please do **not** open public issues for security problems — see [SECURITY.md](./SECURITY.md).
