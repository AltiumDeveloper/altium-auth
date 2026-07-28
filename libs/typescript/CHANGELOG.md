# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- **TLS error handling in ActionWait polling** — a TLS/certificate error (e.g. a
  self-signed cert on an on-prem AES server) now fails the sign-in immediately
  instead of being retried forever as a transient network error.

## [0.1.2] — 2026-07-24

### Added

- `signIn` now accepts `openBrowser(url)` so desktop and extension hosts can
  launch the authorization URL through their own browser API while the library
  continues to own PKCE generation, ActionWait polling, state validation, and
  token exchange.

## [0.1.1] — 2026-07-24

### Added

- **Login-into-workspace mode** (`selectWorkspace` on `/connect/authorize`). Pass
  `selectWorkspace: "strict"` or `"optional"` to `createAuthorizationUrl` /
  `signIn` options to have the server prompt the user to select a workspace during
  authentication. When a workspace is selected, the code exchange returns a
  workspace-scoped token directly — no separate `signIntoWorkspace` step needed.
  `"none"` or omitting the option (default) preserves the existing global-token
  flow. Mirrors SPEC §3.1.

## [0.1.0] — Preview

First preview release of `@altium-developer/a365-auth`. Pre-1.0: the API may change
as the shared spec and sibling libraries evolve.

### Added

- **Public-client sign-in** — `signIn(config, options?)`: browser-based OAuth2
  PKCE sign-in using Altium's ActionWait long-polling. Returns a `TokenSet`;
  storage is the caller's concern.
- **Confidential / redirect-based flow** — `createAuthorizationUrl(config, options?)`
  and `exchangeCode(config, params)`: composable steps for web/server backends
  that host their own redirect endpoint. Set `OAuthConfig.clientSecret` to
  authenticate as a confidential client (HTTP Basic); public clients use PKCE.
- `signIntoWorkspace(config, baseAccessToken, workspaceAuthId)`: workspace-scoped
  token via the OAuth2 token-exchange grant.
- `refreshToken(config, refreshToken)`: refresh an expired access token via the
  OAuth2 `refresh_token` grant, without a full interactive sign-in.
- `revokeRefreshToken(config, refreshToken)`: revoke a refresh token via the OAuth2
  Token Revocation endpoint (RFC 7009), e.g. on sign-out. Client authentication
  follows the client type (confidential → HTTP Basic; public → `client_id` in body).
- **Gov Cloud support** — `GOV_CLOUD_ENDPOINTS`. The library auto-detects the
  Gov token endpoint and adds `secure=1` to token requests (the two-token model);
  `OAuthConfig.secure` is an optional override for non-standard hosts.
- `COMMERCIAL_CLOUD_ENDPOINTS`: exported Altium 365 Commercial Cloud endpoints.
  `OAuthConfig` requires only `clientId` and `scopes`; the four endpoints default
  to the Commercial Cloud and can be overridden individually for Dev/UAT or on-prem.
- `OAuthConfig`, `TokenSet`, and flow types (`SignInOptions`,
  `AuthorizationUrlOptions`, `AuthorizationRequest`, `ExchangeCodeParams`).
- Zero runtime dependencies. Runs on Node ≥20, Bun, and Deno.
- Conforms to the shared, language-neutral vectors in `spec/conformance/vectors.json`.

[0.1.2]: https://github.com/AltiumDeveloper/a365-auth/releases/tag/ts-v0.1.2
[0.1.1]: https://github.com/AltiumDeveloper/a365-auth/releases/tag/ts-v0.1.1
[0.1.0]: https://github.com/AltiumDeveloper/a365-auth/releases/tag/ts-v0.1.0
