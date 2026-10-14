# altium-auth for Go

[![Go Reference](https://pkg.go.dev/badge/github.com/AltiumDeveloper/altium-auth/libs/go.svg)](https://pkg.go.dev/github.com/AltiumDeveloper/altium-auth/libs/go)
[![CI](https://github.com/AltiumDeveloper/altium-auth/actions/workflows/go-ci.yml/badge.svg)](https://github.com/AltiumDeveloper/altium-auth/actions/workflows/go-ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/AltiumDeveloper/altium-auth/blob/main/libs/go/LICENSE)

Altium 365 OAuth2 / OpenID Connect authentication library for Go. Supports both client types, and Commercial Cloud, GovCloud, and AES (on-prem) deployments:

- **Public clients** (desktop, CLI, native) — browser sign-in with PKCE over Altium's **ActionWait** long-poll: `Config.SignIn`.
- **Confidential clients** (web/server backends with a secret) — the standard **authorization-code redirect** flow: `Config.CreateAuthorizationURL` + `Config.ExchangeCode`.
- **Workspace tokens**, **token refresh**, **revocation**, and first-class **GovCloud** and **AES** (on-prem) support.

**Standard library only — no dependencies.** Requires Go 1.25 or later.

## Documentation

The library implements the flow described in these guides (protocol-level, independent of this package) — start here if you're new to Altium Identity:

- [Authentication overview](https://altiumdeveloper.github.io/altium-auth/guides/overview/) — endpoints, key terms, and the recommended flow
- [Register your application](https://altiumdeveloper.github.io/altium-auth/guides/register-your-application/) — client types, redirect URLs, credentials
- [Web / server apps](https://altiumdeveloper.github.io/altium-auth/guides/web-and-server-apps/) — authorization-code redirect flow (confidential clients)
- [Desktop apps](https://altiumdeveloper.github.io/altium-auth/guides/desktop-apps/) — the ActionWait pattern (public clients)
- [GovCloud](https://altiumdeveloper.github.io/altium-auth/guides/govcloud/) — Commercial vs Gov and the `secure=1` two-token model
- [AES (on-prem)](https://altiumdeveloper.github.io/altium-auth/guides/aes/) — customer-hosted installations
- [Access token claims](https://altiumdeveloper.github.io/altium-auth/guides/token-claims/) — what's inside a token (`iss`, `workspaceId`, `secure`, scopes)

The full API reference is on [pkg.go.dev](https://pkg.go.dev/github.com/AltiumDeveloper/altium-auth/libs/go).

## Installation

```bash
go get github.com/AltiumDeveloper/altium-auth/libs/go
```

```go
import altiumauth "github.com/AltiumDeveloper/altium-auth/libs/go"
```

## Quick Start

Only `ClientID` and `Scopes` are required — the endpoints default to the Altium 365 Commercial Cloud. Every network call takes a `context.Context`; cancel it to abandon the call.

### Public apps (desktop / CLI — ActionWait sign-in)

For clients that **can't host a public redirect**. `SignIn` opens the browser, waits for the callback over Altium's ActionWait long-poll, and returns tokens. See [Desktop apps](https://altiumdeveloper.github.io/altium-auth/guides/desktop-apps/).

```go
cfg := altiumauth.Config{ClientID: "your-client-id", Scopes: "openid profile"}

// Opens a browser login page and waits for the callback (default timeout: 3 minutes).
tokens, err := cfg.SignIn(ctx, altiumauth.SignInOptions{})
if err != nil {
	return err
}
// Persist tokens yourself — e.g. the OS keychain or a file.

// Exchange the global token for a workspace-scoped token.
ws, err := cfg.SignIntoWorkspace(ctx, tokens.AccessToken, "workspace-id-here")
```

The library returns tokens and never stores them — persistence, refresh, and sign-out are yours to manage.

To open the URL through a host API instead of the OS browser, pass `OpenBrowser`. The library still owns PKCE, ActionWait polling, state correlation, CSRF validation, and the token exchange:

```go
tokens, err := cfg.SignIn(ctx, altiumauth.SignInOptions{
	OpenBrowser: func(url string) error { return myHost.OpenExternal(url) },
})
```

### Confidential apps (web / server — authorization-code redirect)

For backends that **host their own redirect endpoint**. Set `ClientSecret` to authenticate as a confidential client (HTTP Basic). See [Web / server apps](https://altiumdeveloper.github.io/altium-auth/guides/web-and-server-apps/).

```go
cfg := altiumauth.Config{
	ClientID:     "your-client-id",
	ClientSecret: os.Getenv("A365_CLIENT_SECRET"), // confidential client → HTTP Basic
	Scopes:       "openid profile offline_access",
}
const redirectURI = "https://my-service.example.com/oauth/callback"

// Login route: build the URL, stash State + CodeVerifier in the session, redirect.
authz, err := cfg.CreateAuthorizationURL(altiumauth.AuthorizationURLOptions{RedirectURI: redirectURI})
session.Save(authz.State, authz.CodeVerifier)
http.Redirect(w, r, authz.URL, http.StatusFound)

// Callback route: verify state, then exchange the code.
if r.URL.Query().Get("state") != session.State {
	http.Error(w, "state mismatch", http.StatusBadRequest)
	return
}
tokens, err := cfg.ExchangeCode(r.Context(), altiumauth.ExchangeCodeParams{
	Code:         r.URL.Query().Get("code"),
	CodeVerifier: session.CodeVerifier,
	RedirectURI:  redirectURI,
})
```

`CreateAuthorizationURL` does no network I/O. `SignIntoWorkspace`, `RefreshToken`, and `RevokeRefreshToken` also send the `ClientSecret` automatically when it's set.

### GovCloud

Use `GovCloudEndpoints`. The library detects the Gov token endpoint and adds the required `secure=1` to token requests automatically.

```go
cfg := altiumauth.Config{
	ClientID:  "your-gov-client-id",
	Scopes:    "openid profile",
	Endpoints: altiumauth.GovCloudEndpoints,
}
```

`secure=1` is driven by the token endpoint — Gov → sent, Commercial → omitted — so pointing `TokenEndpoint` at the Gov host is all it takes to exchange a Commercial token for a Gov workspace token. Set `Config.Secure` only to force it for a non-standard host.

> Gov tokens must never be used against Commercial services, and vice versa. See the [GovCloud](https://altiumdeveloper.github.io/altium-auth/guides/govcloud/) guide.

### AES (on-prem)

AES runs on a customer-controlled origin, so derive the endpoints with `AESEndpoints`. AES never uses `secure=1`. It hosts one workspace, so discover its scope and request it at sign-in (one trip):

```go
const clientID = "your-aes-client-id"
endpoints := altiumauth.AESEndpoints("https://aes.server.example:9785")
scopes, err := altiumauth.GetClientScopes(ctx, nil, endpoints.ScopeEndpoint, clientID)
if err != nil {
	return err
}
cfg := altiumauth.Config{ClientID: clientID, Scopes: strings.Join(scopes, " "), Endpoints: endpoints}
tokens, err := cfg.SignIn(ctx, altiumauth.SignInOptions{})
```

See the [AES (on-prem)](https://altiumdeveloper.github.io/altium-auth/guides/aes/) guide.

#### TLS trust for AES

AES servers often use a certificate from a private or corporate CA. Go verifies TLS against the **operating system's trust store** (the Keychain on macOS, the certificate store on Windows, the system CA bundle on Linux), so a CA installed there is trusted with no extra configuration. On Linux, you can also point Go at a bundle with `SSL_CERT_FILE` or `SSL_CERT_DIR`.

To trust a CA only for this client, pass your own HTTP client:

```go
pool, _ := x509.SystemCertPool()
pool.AppendCertsFromPEM(aesRootCAPEM)
cfg.HTTPClient = &http.Client{Transport: &http.Transport{
	Proxy:           http.ProxyFromEnvironment,
	TLSClientConfig: &tls.Config{RootCAs: pool},
}}
```

Never disable verification (`InsecureSkipVerify`): the token endpoint receives your authorization codes, and with a client secret configured, the secret as well. An untrusted certificate fails sign-in with `ActionWait TLS error: …`.

### Custom deployments

Override individual endpoint fields; anything left empty falls back to the Commercial Cloud:

```go
cfg := altiumauth.Config{ClientID: "your-client-id", Scopes: "openid profile"}
cfg.AuthEndpoint = "https://auth.my-custom-deployment.example/connect/authorize"
cfg.TokenEndpoint = "https://auth.my-custom-deployment.example/connect/token"
```

## API

| Function | Description |
| --- | --- |
| `(Config) SignIn(ctx, SignInOptions)` | ActionWait browser sign-in (public clients). Options: `Timeout` (default 3 min), `SelectWorkspace`, `OpenBrowser`. |
| `(Config) CreateAuthorizationURL(AuthorizationURLOptions)` | Build the authorize URL with PKCE; returns `URL`, `State`, `CodeVerifier`. Options: `RedirectURI`, `State`, `CodeVerifier`, `Scopes`, `SelectWorkspace`. |
| `(Config) ExchangeCode(ctx, ExchangeCodeParams)` | `authorization_code` grant: `Code`, `CodeVerifier`, `RedirectURI`. |
| `(Config) SignIntoWorkspace(ctx, baseAccessToken, workspaceAuthID)` | Token exchange (RFC 8693) for a workspace-scoped token. |
| `(Config) RefreshToken(ctx, refreshToken)` | `refresh_token` grant. Sends no `scope`, so global stays global and workspace stays workspace. Persist a rotated `RefreshToken`. |
| `(Config) RevokeRefreshToken(ctx, refreshToken)` | RFC 7009 revocation at `/connect/revocation`; idempotent. |
| `GetClientScopes(ctx, httpClient, scopeEndpoint, clientID)` | Scopes registered for a client (`httpClient` may be `nil`). Errors rather than returning `[]` on a bad response. |
| `CommercialCloudEndpoints`, `GovCloudEndpoints`, `AESEndpoints(origin)` | Endpoint presets. |

`SelectWorkspace` takes `SelectWorkspaceStrict`, `SelectWorkspaceOptional`, or `SelectWorkspaceNone` / empty (omitted) — see [login-into-workspace mode](https://altiumdeveloper.github.io/altium-auth/guides/overview/#login-into-workspace-mode).

`TokenSet` has `AccessToken`, `RefreshToken`, `IDToken`, `TokenType`, `ExpiresIn`, `ExpiresAt` (epoch seconds, computed as `now + expires_in − 30`), and `Scope`, plus an `Expired()` helper. The access token is a signed JWT — see [Access token claims](https://altiumdeveloper.github.io/altium-auth/guides/token-claims/).

Pass your own `*http.Client` in `Config.HTTPClient` (proxies, custom TLS roots, tracing). Bound calls with the `context` rather than `http.Client.Timeout`, which would cut ActionWait long polls short.

Every request carries `User-Agent: altium-auth-go/<version>` (`altiumauth.UserAgent`). Keep it if you supply a custom transport, and set it on your own calls to Altium endpoints (e.g. `/connect/userinfo`).

## Error handling

| Situation | Error |
| --- | --- |
| Token endpoint returns an OAuth error | `*TokenError` — `StatusCode`, `Code` (e.g. `access_denied`, `invalid_grant`), `Description`, `Body` |
| OAuth error delivered via ActionWait (e.g. cross-partition `access_denied`) | `*AuthorizationError` — `Code`, `Description` |
| Wait token gone (410) or `ctx` cancelled | `ErrSignInCancelled` (wraps `context.Canceled` when cancelled) |
| Sign-in timed out | wraps `context.DeadlineExceeded` |
| Returned `state` does not match (CSRF) | `ErrStateMismatch` — the code is not exchanged |
| TLS failure during ActionWait | message `ActionWait TLS error:`, wrapping the `crypto/tls` / `crypto/x509` error |
| Missing `ClientID`/`Scopes`, invalid endpoint URL, empty token/code argument | descriptive error, no request sent |

```go
var te *altiumauth.TokenError
if errors.As(err, &te) && te.Code == "invalid_grant" {
	// Refresh token expired or revoked — sign in again.
}
```

## Development

```bash
go vet ./...
go test -race ./...   # unit tests + the shared conformance vectors (spec/conformance/vectors.json)
```

### E2E sign-in test

Run the sign-in flow against a live Altium environment. It opens your browser, waits for the ActionWait callback, and prints the resulting tokens. It can also exercise workspace exchange, refresh, and revocation. Its CLI is identical to the TypeScript, .NET, and Python harnesses.

```bash
# Commercial Cloud, public client
go run ./tools/signintest YOUR_CLIENT_ID

# GovCloud — verifies the secure=1 two-token model
go run ./tools/signintest --env gov YOUR_GOV_CLIENT_ID

# AES (on-prem) — verifies the origin-derived endpoints, no secure=1
go run ./tools/signintest --env aes --aes-origin https://aes.server.example:9785 YOUR_AES_CLIENT_ID

# Also exchange a workspace token and exercise refresh
go run ./tools/signintest --workspace <authId> --refresh YOUR_CLIENT_ID

# Confidential client (HTTP Basic) — pass the secret via env, never on the CLI
A365_CLIENT_SECRET=... go run ./tools/signintest YOUR_CLIENT_ID
```

Options include `--env prod|gov|aes`, `--aes-origin` (required for `--env aes`), `--workspace-env`, `--secure`/`--no-secure`, `--scopes`, `--workspace`, `--select-workspace`, `--refresh`, `--userinfo`, `--revoke`, plus `--authorize-url`/`--exchange-code`/`--code-verifier`/`--redirect-uri` for confidential (custom-callback) clients — see the header of [`tools/signintest/main.go`](https://github.com/AltiumDeveloper/altium-auth/blob/main/libs/go/tools/signintest/main.go). The client secret is read from `A365_CLIENT_SECRET` so it never appears in shell history or the process list.

## Releasing

Go modules are published by tagging; there is no registry upload. The module lives in a subdirectory, so the tag carries the path: `libs/go/vX.Y.Z`. Pushing it runs `.github/workflows/go-release.yml`, which gates on the conformance suite and then registers the version with `proxy.golang.org` (and so pkg.go.dev).

## License

MIT — see [LICENSE](https://github.com/AltiumDeveloper/altium-auth/blob/main/libs/go/LICENSE).
