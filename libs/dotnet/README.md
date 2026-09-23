# Altium.Auth

[![CI](https://github.com/AltiumDeveloper/altium-auth/actions/workflows/dotnet-ci.yml/badge.svg)](https://github.com/AltiumDeveloper/altium-auth/actions/workflows/dotnet-ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/AltiumDeveloper/altium-auth/blob/main/LICENSE)

Altium 365 OAuth2 / OpenID Connect authentication client for .NET. Supports both
client types as well as the different deployment types: Commercial Cloud, GovCloud, and AES (on-prem).

- **Public clients** (desktop) — browser sign-in with PKCE over Altium's
  **ActionWait** long-poll: `SignInAsync`.
- **Confidential clients** (web/server backends with a secret) — the standard
  **authorization-code redirect** flow via composable steps: `CreateAuthorizationUrl` and `ExchangeCodeAsync`.
- **Workspace tokens**, **token refresh / revocation**, and first-class **GovCloud** and
  **AES** (on-prem) support.

**Zero dependencies** on `net10.0`, `net8.0`, and `netstandard2.0` (.NET Framework
4.6.1+, including 4.8). Validated against the same language-neutral
[conformance vectors](https://github.com/AltiumDeveloper/altium-auth/blob/main/spec/conformance/vectors.json) as the TypeScript library —
see <a href="#how-its-built">How it's built</a>.

## Documentation

The client implements the flow described in these protocol-level guides (independent of
this package):

- [Authentication overview](https://altiumdeveloper.github.io/altium-auth/guides/overview/) — endpoints, key terms, recommended flow
- [Register your application](https://altiumdeveloper.github.io/altium-auth/guides/register-your-application/) — client types, redirect URLs, credentials
- [Web / server apps](https://altiumdeveloper.github.io/altium-auth/guides/web-and-server-apps/) — authorization-code redirect flow (confidential)
- [Desktop apps](https://altiumdeveloper.github.io/altium-auth/guides/desktop-apps/) — the ActionWait pattern (public)
- [GovCloud](https://altiumdeveloper.github.io/altium-auth/guides/govcloud/) — Commercial vs Gov and the `secure=1` two-token model
- [AES (on-prem)](https://altiumdeveloper.github.io/altium-auth/guides/aes/) — customer-hosted installations
- [Access token claims](https://altiumdeveloper.github.io/altium-auth/guides/token-claims/) — what's inside a token (`iss`, `workspaceId`, `secure`, scopes)

## Quick start

Only `ClientId` and `Scopes` are required — endpoints default to the Altium 365
Commercial Cloud. You supply the `HttpClient` (reuse one / use `IHttpClientFactory`).

### Public apps (desktop — ActionWait sign-in)

For apps that **can't host a public redirect**. `SignInAsync` invokes your
`OpenBrowser` callback, waits for the callback over ActionWait, and returns tokens.

```csharp
using Altium.Auth;
using System.Diagnostics;

// ActionWait long-polls: the CancellationToken below is the real deadline.
var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
var options = new AltiumAuthOptions
{
    ClientId = "your-client-id",
    Scopes = "openid profile",
    OpenBrowser = url => Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }),
};
var client = new AltiumAuthClient(http, options);

// Opens the browser and waits for the sign-in callback.
using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(5));
TokenSet tokens = await client.SignInAsync(cts.Token);

// Persist `tokens` yourself — the client never stores them.

// Exchange the global token for a workspace-scoped token.
TokenSet workspaceToken = await client.SignIntoWorkspaceAsync(tokens.AccessToken, "workspace-id-here");
```

To prompt the user to select a workspace **during sign-in** (login-into-workspace mode), pass `selectWorkspace`:

```csharp
// WorkspaceSelection.Strict   → user must choose a workspace (token is workspace-scoped after exchange)
// WorkspaceSelection.Optional → selection offered; the user may skip it
TokenSet tokens = await client.SignInAsync(WorkspaceSelection.Optional);
```

See [Login-into-workspace mode](https://altiumdeveloper.github.io/altium-auth/guides/overview/#login-into-workspace-mode).

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

### GovCloud

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
for a Gov workspace token. See the [GovCloud](https://altiumdeveloper.github.io/altium-auth/guides/govcloud/) guide.

### AES (on-prem)

Altium Enterprise Server (AES) is a customer-hosted, on-prem installation — unlike
Commercial/GovCloud (fixed Altium-hosted domains), there's no fixed host, so use
`AltiumEndpoints.Aes(origin)` to derive the endpoint set from your AES server's origin. AES
does not use `secure=1` (same rule as Commercial), and there's no cross-cloud bridging
to/from Commercial or Gov.

```csharp
var clientId = "your-aes-client-id";
var endpoints = AltiumEndpoints.Aes("https://aes.server.example:9785");

// AES hosts a single workspace — introspect the exact scope to request for it.
var scopesArray = await AltiumAuthClient.GetClientScopesAsync(http, endpoints.ScopeEndpoint!, clientId);
var scopes = string.Join(" ", scopesArray);

var options = new AltiumAuthOptions
{
    ClientId = clientId,
    Scopes = scopes,
    Endpoints = endpoints,
    OpenBrowser = url => Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }),
};
```

See the [AES (on-prem)](https://altiumdeveloper.github.io/altium-auth/guides/aes/) guide.

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

## Use from PowerShell

`Altium.Auth` has no dependencies on any target, so PowerShell can drive it directly —
no SDK, no compiler, no wrapper module. Both editions work: **PowerShell 7+** loads the
`net8.0` asset, and **Windows PowerShell 5.1** loads the `netstandard2.0` one, which
matters because 5.1 is still the default on Windows Server.

Grab the assembly straight from nuget.org and load the asset for your edition:

```powershell
$lib = if ($PSVersionTable.PSEdition -eq 'Desktop') { 'netstandard2.0' } else { 'net8.0' }
$ver = (Invoke-RestMethod 'https://api.nuget.org/v3-flatcontainer/altium.auth/index.json').versions[-1]
Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/altium.auth/$ver/altium.auth.$ver.nupkg" -OutFile pkg.zip
Expand-Archive pkg.zip -DestinationPath pkg -Force
Add-Type -Path "./pkg/lib/$lib/Altium.Auth.dll"
```

Then the flow is the C# one, one PowerShell idiom at a time:

```powershell
$http = [System.Net.Http.HttpClient]::new()
$http.Timeout = [System.Threading.Timeout]::InfiniteTimeSpan   # the CTS below is the real deadline
$options = [Altium.Auth.AltiumAuthOptions]@{     # hashtable cast sets the init-only properties
    ClientId    = 'your-client-id'
    Scopes      = 'openid profile offline_access'
    OpenBrowser = { param($url) Start-Process $url }   # ScriptBlock → Action[string]
}
$client = [Altium.Auth.AltiumAuthClient]::new($http, $options)
$cts = [System.Threading.CancellationTokenSource]::new([timespan]::FromMinutes(5))

$tokens = $client.SignInAsync([Altium.Auth.WorkspaceSelection]::None, $cts.Token).GetAwaiter().GetResult()
$tokens = $client.SignIntoWorkspaceAsync($tokens.AccessToken, 'workspace-id-here', $cts.Token).GetAwaiter().GetResult()

Invoke-RestMethod https://api.altium.com/... `
    -Headers @{ Authorization = "Bearer $($tokens.AccessToken)" }
```

Things that bite in PowerShell specifically:

| | |
| --- | --- |
| Awaiting | No `await` — call `.GetAwaiter().GetResult()`. Safe here: PowerShell installs no `SynchronizationContext`, so there is no deadlock. |
| Timeouts | Two of them: clear `$http.Timeout` (the ActionWait hold outlasts the 100s default, so it would otherwise reconnect every 100s), and pass a `CancellationTokenSource` token so the script can't wait forever. |
| Errors | Exceptions arrive wrapped — read `$_.Exception.InnerException` for the real `Token endpoint 400 …` message. |
| Optional args | PowerShell can omit trailing optional parameters, but `$null` for a `string?` becomes `""` — pass `[NullString]::Value` if you need a real null. |
| Env presets | `[Altium.Auth.AltiumEndpoints]::GovCloud`, `::Aes('https://aes.example:9785')`, or `::new($authorize, $token, $actionWait, $redirect)`. |
| Windows PowerShell 5.1 | Load the `netstandard2.0` asset. Call `Add-Type -AssemblyName System.Security` before using DPAPI, and force TLS 1.2 (`[Net.ServicePointManager]::SecurityProtocol`) on older Windows, where the .NET Framework default still negotiates TLS 1.0 and nuget.org refuses it. |
| Unattended runs | There is no client-credentials grant, so a script signs in interactively once and reuses the result. Check `ExpiresAt` before reaching for `offline_access`: access-token lifetimes are per-client and can be long (30 days on the client we tested), which may be all an unattended script needs. |

[`tools/powershell/Get-AltiumToken.ps1`](https://github.com/AltiumDeveloper/altium-auth/blob/main/libs/dotnet/tools/powershell/Get-AltiumToken.ps1) is a
ready-to-run script that does all of the above: downloads and caches the assembly,
signs in, optionally exchanges for a workspace token, and with `-TokenFile` persists the
token set DPAPI-encrypted for the current Windows user so later runs refresh silently —
falling back to an interactive sign-in if the saved refresh token is rejected.

```powershell
# First run opens the browser; later runs refresh from the saved token set.
./Get-AltiumToken.ps1 -ClientId $id -WorkspaceId $authId -TokenFile ~/.altium-tokens
```

If you downloaded the script (or run it from a UNC/`\\wsl$` path), Windows blocks it as
untrusted — `Unblock-File ./Get-AltiumToken.ps1`, or run `pwsh -ExecutionPolicy Bypass`.

## API reference

Constructor: `new AltiumAuthClient(HttpClient http, AltiumAuthOptions options)` — implements `IAltiumAuthClient`.

| Member | Description |
| --- | --- |
| `SignInAsync(selectWorkspace, ct)` | Public-client PKCE sign-in via ActionWait. Uses `OpenBrowser` to launch the authorization URL. `selectWorkspace` is a `WorkspaceSelection` (`None` default, `Strict`, `Optional`). Returns `TokenSet`. |
| `CreateAuthorizationUrl(redirectUri?, state?, codeVerifier?, selectWorkspace)` | Build the authorize URL for the redirect flow. Returns `AuthorizationRequest`. Synchronous. `selectWorkspace` is a `WorkspaceSelection` (`None` default, `Strict`, `Optional`). |
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

A record of the endpoints (`AuthorizeEndpoint`, `TokenEndpoint`, `ActionWaitEndpoint`,
`RedirectUri`, `ScopeEndpoint`) with two fixed presets —
`AltiumEndpoints.CommercialCloud` (default) and `AltiumEndpoints.GovCloud` — plus
`AltiumEndpoints.Aes(origin)`, a factory that derives the endpoint set for an AES (on-prem)
installation from its server origin, including `ScopeEndpoint`
for [scope introspection](https://altiumdeveloper.github.io/altium-auth/guides/aes/#single-workspace) — use
`AltiumAuthClient.GetClientScopesAsync` (GET with a `clientId` query parameter) to discover
the exact `a365:workspace:{id}` scope for the installation's single workspace.
`ScopeEndpoint` is `null` in the Cloud presets: the endpoint exists there too
(`{base}/api/ClientScopes`), but a Cloud response carries no `a365:workspace:{id}` scope — a
Cloud client may reach many workspaces, none implied by its client ID — so set it yourself if
you want the client's static scopes. Construct your own record for other custom hosts.

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
> scopes. See [Access token claims](https://altiumdeveloper.github.io/altium-auth/guides/token-claims/).

## Error handling

Methods throw on empty required arguments and on non-success responses. The message
includes the HTTP status and the OAuth `error`/`error_description` when present — e.g. a
Gov workspace exchange on a Commercial endpoint surfaces `access_denied`; a refresh with a
revoked/expired token surfaces `invalid_grant`. ActionWait failures surface a descriptive
message (cancellation, a TLS/certificate failure, or a CSRF `state` mismatch). A transport
timeout or dropped connection mid-poll is *not* a failure — like a `408`, the client reconnects.

## Compatibility

- **`net10.0`**, **`net8.0`**, and **`netstandard2.0`** — the last covering .NET
  Framework 4.6.1+ (4.8 included) and any other netstandard2.0 runtime.
- **Dependency-free on every target.** JSON is read with the BCL's
  `DataContractJsonSerializer`, so a .NET Framework project installs the package
  without `System.Text.Json` or its transitive assemblies and the binding redirects
  they bring.
- **PowerShell 7+ and Windows PowerShell 5.1** can load and drive the assembly
  directly — see [Use from PowerShell](#use-from-powershell).
- You provide the `HttpClient`; the client sets headers/bodies but does not own the transport — so
  its `Timeout` is yours to set (`SignInAsync` long-polls; see the note in
  [Public apps](#public-apps-desktop--actionwait-sign-in)).

## How it's built

`Altium.Auth` is **dependency-free by design**: it acquires tokens and never validates
JWTs, so it needs no OIDC/JWT library. Its behavior is pinned by
the shared, language-neutral vectors in [`spec/conformance/vectors.json`](https://github.com/AltiumDeveloper/altium-auth/blob/main/spec/conformance/vectors.json) —
the exact contract the TypeScript library passes. This proves the two implementations are
behavior-identical. Spec: [`spec/SPEC.md`](https://github.com/AltiumDeveloper/altium-auth/blob/main/spec/SPEC.md).

## Development

Open `Altium.Auth.sln` in your IDE (library, tests, and tools grouped into `src`/`tests`/`tools` folders), or from the CLI:

```bash
# Build / test the whole solution
dotnet build Altium.Auth.sln -c Release
dotnet test Altium.Auth.sln -c Release      # runs the xUnit conformance suite

# Or target a single project:
dotnet test tests/Altium.Auth.Tests -c Release
```

The vectors run on every target the package ships. `net48` is included only on
Windows (there is no runtime to host it elsewhere), so it runs in CI and in a local
`dotnet test` on Windows — that leg is what proves the `netstandard2.0` asset works
on .NET Framework, not just that it compiles.

The shipped library (`src/Altium.Auth`) builds with analyzers + `TreatWarningsAsErrors`
(see `.editorconfig`), so `dotnet build` is the style/quality gate.

### Live E2E against a real environment

`tools/SignInTest` runs the *real* flow (ActionWait sign-in, workspace exchange, refresh,
revoke) against a live environment — needs network + a browser:

```bash
# Commercial, public client
dotnet run --project tools/SignInTest -- YOUR_CLIENT_ID

# Dev Gov — verifies the secure=1 two-token model
dotnet run --project tools/SignInTest -- --env dev-gov YOUR_GOV_CLIENT_ID

# AES (on-prem) — verifies the origin-derived endpoints, no secure=1
dotnet run --project tools/SignInTest -- --env aes --aes-origin https://aes.server.example:9785 YOUR_AES_CLIENT_ID

# Confidential client (HTTP Basic) — secret via env, never on the CLI
A365_CLIENT_SECRET=... dotnet run --project tools/SignInTest -- --workspace <authId> --revoke YOUR_CLIENT_ID
```

Options mirror the TS harness: `--env prod|dev|gov|dev-gov|aes`, `--aes-origin` (required for
`--env aes`), `--workspace-env`, `--secure`/`--no-secure`, `--scopes`, `--workspace`,
`--refresh`, `--revoke`, `--userinfo`, and
`--authorize-url`/`--exchange-code`/`--code-verifier`/`--redirect-uri` for
confidential/custom-callback clients.

See [CONTRIBUTING.md](https://github.com/AltiumDeveloper/altium-auth/blob/main/CONTRIBUTING.md) and [AGENTS.md](https://github.com/AltiumDeveloper/altium-auth/blob/main/AGENTS.md) for the
repo-wide, spec-first contribution model.

## Security

Please report vulnerabilities privately — see [SECURITY.md](https://github.com/AltiumDeveloper/altium-auth/blob/main/SECURITY.md).

## License

[MIT](https://github.com/AltiumDeveloper/altium-auth/blob/main/LICENSE) © Altium Limited
