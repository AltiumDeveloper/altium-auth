# Altium.Auth

[![NuGet](https://img.shields.io/nuget/v/Altium.Auth.svg)](https://www.nuget.org/packages/Altium.Auth)
[![CI](https://github.com/AltiumDeveloper/a365-auth/actions/workflows/dotnet-ci.yml/badge.svg)](https://github.com/AltiumDeveloper/a365-auth/actions/workflows/dotnet-ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/AltiumDeveloper/a365-auth/blob/main/LICENSE)

Altium 365 OAuth2 / OpenID Connect authentication client for .NET. Supports both
client types and both clouds:

- **Public clients** (desktop, native) — browser sign-in with PKCE over Altium's
  **ActionWait** long-poll: `SignInAsync`.
- **Confidential clients** (web/server backends with a secret) — the standard
  **authorization-code redirect** flow via composable steps: `CreateAuthorizationUrl`
  + `ExchangeCodeAsync`.
- **Workspace tokens**, **token refresh / revocation**, and first-class **Gov Cloud** support.

**Zero dependencies**, `net8.0`. Validated against the same language-neutral
[conformance vectors](https://github.com/AltiumDeveloper/a365-auth/blob/main/spec/conformance/vectors.json) as the TypeScript library —
see [How it's built](#how-its-built).

## Installation

```bash
dotnet add package Altium.Auth
```

## Documentation

The client implements the flow described in these protocol-level guides (independent of
this package):

- [Authentication overview](../../docs/guides/overview.md) — endpoints, key terms, recommended flow
- [Register your application](../../docs/guides/register-your-application.md) — client types, redirect URLs, credentials
- [Web / server apps](../../docs/guides/web-and-server-apps.md) — authorization-code redirect flow (confidential)
- [Desktop / on-prem apps](../../docs/guides/desktop-and-onprem-apps.md) — the ActionWait pattern (public)
- [Gov Cloud](../../docs/guides/gov-cloud.md) — Commercial vs Gov and the `secure=1` two-token model
- [Access token claims](../../docs/guides/token-claims.md) — what's inside a token (`iss`, `workspaceId`, `secure`, scopes)

## Quick start

Only `ClientId` and `Scopes` are required — endpoints default to the Altium 365
Commercial Cloud. You supply the `HttpClient` (reuse one / use `IHttpClientFactory`).

### Public apps (desktop / native — ActionWait sign-in)

For apps that **can't host a public redirect**. `SignInAsync` invokes your
`OpenBrowser` callback, waits for the callback over ActionWait, and returns tokens.

```csharp
using Altium.Auth;
using System.Diagnostics;

var http = new HttpClient();
var options = new AltiumAuthOptions
{
    ClientId = "your-client-id",
    Scopes = "openid profile",
    OpenBrowser = url => Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }),
};
var client = new AltiumAuthClient(http, options);

// Opens the browser and waits for the sign-in callback.
TokenSet tokens = await client.SignInAsync();

// Persist `tokens` yourself — the client never stores them.

// Exchange the global token for a workspace-scoped token.
TokenSet workspaceToken = await client.SignIntoWorkspaceAsync(tokens.AccessToken, "workspace-id-here");
```

### Confidential apps (web / server — authorization-code redirect)

For backends that **host their own redirect endpoint**. Set `ClientSecret` to
authenticate as a confidential client (HTTP Basic) and drive the flow with two steps.

```csharp
var options = new AltiumAuthOptions
{
    ClientId = "your-client-id",
    ClientSecret = "your-client-secret", // confidential client → HTTP Basic
    Scopes = "openid profile offline_access",
};
var client = new AltiumAuthClient(http, options);
var redirectUri = "https://my-service.example.com/oauth/callback";

// On your login route: build the URL, stash state + verifier, then redirect.
AuthorizationRequest authz = client.CreateAuthorizationUrl(redirectUri);
// Save authz.State + authz.CodeVerifier (e.g. in the session); redirect to authz.Url.

// On your callback route: verify state matches, then exchange the code.
TokenSet tokens = await client.ExchangeCodeAsync(code, authz.CodeVerifier, redirectUri);
```

`CreateAuthorizationUrl` is synchronous (generates PKCE + `state`); `ExchangeCodeAsync`
performs the token exchange. `SignIntoWorkspaceAsync`, `RefreshTokenAsync`, and
`RevokeRefreshTokenAsync` all apply the `ClientSecret` automatically when it's set.

### Gov Cloud

Use the `AltiumEndpoints.GovCloud` preset — that's it. The client detects the Gov token
endpoint and adds the required `secure=1` to token requests automatically (the two-token
model); no flag to set.

```csharp
var options = new AltiumAuthOptions
{
    ClientId = "your-gov-client-id",
    Scopes = "openid profile",
    Endpoints = AltiumEndpoints.GovCloud,
    OpenBrowser = url => Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }),
};
```

Commercial and Gov are kept strictly separate: a global token can only be exchanged for a
workspace of the matching kind. `secure=1` is driven by which token endpoint you use, so
pointing the token endpoint at the Gov host is all it takes to exchange a Commercial token
for a Gov workspace token. See [docs/gov-cloud.md](../../docs/guides/gov-cloud.md).

### Refresh & sign-out

```csharp
// Refresh when the access token has expired (compare TokenSet.ExpiresAt to now).
if (tokens.ExpiresAt is long exp && exp <= DateTimeOffset.UtcNow.ToUnixTimeSeconds()
    && tokens.RefreshToken is not null)
{
    tokens = await client.RefreshTokenAsync(tokens.RefreshToken);
    // Persist again — including a rotated RefreshToken if present.
}

// On sign-out: revoke the refresh token server-side, then discard your local copy.
if (tokens.RefreshToken is not null)
    await client.RevokeRefreshTokenAsync(tokens.RefreshToken);
```

## API reference

Constructor: `new AltiumAuthClient(HttpClient http, AltiumAuthOptions options)` — implements `IAltiumAuthClient`.

| Member | Description |
| --- | --- |
| `SignInAsync(ct)` | Public-client PKCE sign-in via ActionWait (invokes `OpenBrowser`). Returns `TokenSet`. |
| `CreateAuthorizationUrl(redirectUri?, state?, codeVerifier?)` | Build the authorize URL for the redirect flow. Returns `AuthorizationRequest`. Synchronous. |
| `ExchangeCodeAsync(code, codeVerifier?, redirectUri?, ct)` | Exchange an authorization code for tokens. |
| `SignIntoWorkspaceAsync(baseAccessToken, workspaceAuthId, ct)` | Workspace-scoped token via RFC 8693 token-exchange. |
| `RefreshTokenAsync(refreshToken, ct)` | Refresh via the `refresh_token` grant (sends no scope — retains the original grant). |
| `RevokeRefreshTokenAsync(refreshToken, ct)` | Revoke a refresh token (RFC 7009); idempotent. |

### `AltiumAuthOptions`

```csharp
public sealed class AltiumAuthOptions
{
    public required string ClientId { get; init; }
    public required string Scopes { get; init; }          // must include "openid profile"
    public string? ClientSecret { get; init; }            // confidential clients → HTTP Basic
    public AltiumEndpoints Endpoints { get; init; }        // default: AltiumEndpoints.CommercialCloud
    public bool? Secure { get; init; }                     // override Gov auto-detection (normally null)
    public Action<string>? OpenBrowser { get; init; }      // invoked by SignInAsync to open the URL
}
```

### `AltiumEndpoints`

A record of the four endpoints (`AuthorizeEndpoint`, `TokenEndpoint`, `ActionWaitEndpoint`,
`RedirectUri`) with two presets: `AltiumEndpoints.CommercialCloud` (default) and
`AltiumEndpoints.GovCloud`. Construct your own for Dev/UAT or on-prem hosts.

### `TokenSet`

```csharp
public sealed class TokenSet
{
    public string AccessToken { get; set; }
    public string? TokenType { get; set; }
    public int? ExpiresIn { get; set; }
    public long? ExpiresAt { get; set; }   // epoch seconds (computed by the client)
    public string? RefreshToken { get; set; }
    public string? IdToken { get; set; }
    public string? Scope { get; set; }
}
```

> `AccessToken` is a signed JWT — decode it to read `iss`, `workspaceId`, `secure`, and
> scopes. See [Access token claims](../../docs/guides/token-claims.md).

## Error handling

Methods throw on empty required arguments and on non-success responses. The message
includes the HTTP status and the OAuth `error`/`error_description` when present — e.g. a
Gov workspace exchange on a Commercial endpoint surfaces `access_denied`; a refresh with a
revoked/expired token surfaces `invalid_grant`. ActionWait failures surface a descriptive
message (timeout, cancellation, or a CSRF `state` mismatch).

## Compatibility

- **.NET 8.0+** (`net8.0`). Dependency-free.
- You provide the `HttpClient`; the client sets headers/bodies but does not own the transport.

## How it's built

`Altium.Auth` is **dependency-free by design**: it acquires tokens and never validates
JWTs, so it needs no OIDC/JWT library. Its behavior is pinned by
the shared, language-neutral vectors in [`spec/conformance/vectors.json`](https://github.com/AltiumDeveloper/a365-auth/blob/main/spec/conformance/vectors.json) —
the exact contract the TypeScript library passes. This proves the two implementations are
behavior-identical. Spec: [`spec/SPEC.md`](https://github.com/AltiumDeveloper/a365-auth/blob/main/spec/SPEC.md).

## Development

```bash
# Conformance (xUnit) over the shared vectors
dotnet test tests/Altium.Auth.Tests -c Release

# Same vectors without NuGet (locked-down environments)
sh build-offline.sh
```

### Live E2E against a real environment

`tools/SignInTest` runs the *real* flow (ActionWait sign-in, workspace exchange, refresh,
revoke) against a live environment — needs network + a browser:

```bash
# Commercial, public client
dotnet run --project tools/SignInTest -- YOUR_CLIENT_ID

# Dev Gov — verifies the secure=1 two-token model
dotnet run --project tools/SignInTest -- --env dev-gov YOUR_GOV_CLIENT_ID

# Confidential client (HTTP Basic) — secret via env, never on the CLI
A365_CLIENT_SECRET=... dotnet run --project tools/SignInTest -- --workspace <authId> --revoke YOUR_CLIENT_ID
```

Options mirror the TS harness: `--env prod|dev|gov|dev-gov`, `--workspace-env`,
`--secure`/`--no-secure`, `--scopes`, `--workspace`, `--refresh`, `--revoke`, `--userinfo`,
and `--authorize-url`/`--exchange-code`/`--code-verifier`/`--redirect-uri` for
confidential/custom-callback clients.

See [CONTRIBUTING.md](https://github.com/AltiumDeveloper/a365-auth/blob/main/CONTRIBUTING.md) and [AGENTS.md](https://github.com/AltiumDeveloper/a365-auth/blob/main/AGENTS.md) for the
repo-wide, spec-first contribution model.

## Security

Please report vulnerabilities privately — see [SECURITY.md](https://github.com/AltiumDeveloper/a365-auth/blob/main/SECURITY.md).

## License

[MIT](https://github.com/AltiumDeveloper/a365-auth/blob/main/LICENSE) © Altium Limited
