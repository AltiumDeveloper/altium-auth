# Security Policy

This policy covers all libraries in the `a365-auth` repository
(`@altium-developer/a365-auth` for npm, `Altium.Auth` for NuGet, and any future
language libraries under `libs/`).

## Reporting a vulnerability

If you believe you have found a security vulnerability, please report it privately
rather than opening a public issue.

- Use GitHub's [private vulnerability reporting](https://github.com/AltiumDeveloper/a365-auth/security/advisories/new)
  ("Report a vulnerability" under the repository's **Security** tab), or
- Email the maintainers at **security@altium.com**.

Please include enough detail to reproduce the issue (affected library and version, a
minimal example, and the impact). We aim to acknowledge reports within a few business days.

## Scope

These libraries perform an OAuth2 PKCE / token-exchange flow and **return tokens to the
caller**. A few things are intentionally **out of scope** because they are the caller's
responsibility:

- **Token storage.** The libraries never persist tokens — you choose where and how (e.g.
  an OS keychain, VS Code SecretStorage, ASP.NET data protection). Storing tokens
  insecurely is not a library vulnerability.
- **Endpoint trust.** Only override the default Commercial Cloud endpoints
  (`COMMERCIAL_CLOUD_ENDPOINTS` in TypeScript, `AltiumEndpoints.CommercialCloud` in .NET)
  with hosts you trust; the libraries send credentials to whatever endpoints you configure.
- **Client-secret handling.** For confidential clients, the secret is supplied by you and
  sent via HTTP Basic. Keep it out of source control, logs, and command lines (the E2E
  tools read it from an environment variable for exactly this reason).

In scope: anything that causes a library to deviate from the behavior specified in
`spec/SPEC.md` in a way that weakens the flow (e.g. dropping PKCE, mishandling `state`
CSRF verification, leaking tokens in errors, mixing Commercial and Gov tokens).

## Supported versions

Security fixes are provided for the **latest published release of each library**.
Because libraries version independently, "latest" is per-library (see each library's
`CHANGELOG.md`).
