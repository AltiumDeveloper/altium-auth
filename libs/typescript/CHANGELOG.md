# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Zero runtime dependencies. Runs on Node ≥18, Bun, and Deno.
- Conforms to the shared, language-neutral vectors in `spec/conformance/vectors.json`.

[0.1.0]: https://github.com/AltiumDeveloper/a365-auth/releases/tag/ts-v0.1.0
