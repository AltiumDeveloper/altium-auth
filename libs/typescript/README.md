# @altium-developer/a365-auth

[![npm](https://img.shields.io/npm/v/@altium-developer/a365-auth.svg)](https://www.npmjs.com/package/@altium-developer/a365-auth)
[![CI](https://github.com/AltiumDeveloper/a365-auth/actions/workflows/typescript-ci.yml/badge.svg)](https://github.com/AltiumDeveloper/a365-auth/actions/workflows/typescript-ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/AltiumDeveloper/a365-auth/blob/main/libs/typescript/LICENSE)

Altium 365 OAuth2 / OpenID Connect authentication library. Supports both client types and both clouds:

- **Public clients** (desktop, on-prem, native) — browser sign-in with PKCE over Altium's **ActionWait** long-poll: [`signIn`](#signinconfig-options).
- **Confidential clients** (web/server backends with a secret) — the standard **authorization-code redirect** flow via composable steps: [`createAuthorizationUrl`](#createauthorizationurlconfig-options) + [`exchangeCode`](#exchangecodeconfig-params).
- **Workspace tokens**, **token refresh**, and first-class **Gov Cloud** support.

**Zero runtime dependencies.** Runs on Node ≥20, Bun, and Deno (and bundled apps that polyfill Node's `crypto`).

## Installation

```bash
npm i @altium-developer/a365-auth
```

## Documentation

The library implements the flow described in these guides (protocol-level, independent of this package) — start here if you're new to Altium Identity:

- [Authentication overview](../../docs/guides/overview.md) — endpoints, key terms, and the recommended flow
- [Register your application](../../docs/guides/register-your-application.md) — client types, redirect URLs, credentials
- [Web / server apps](../../docs/guides/web-and-server-apps.md) — authorization-code redirect flow (confidential clients)
- [Desktop / on-prem apps](../../docs/guides/desktop-and-onprem-apps.md) — the ActionWait pattern (public clients)
- [Gov Cloud](../../docs/guides/gov-cloud.md) — Commercial vs Gov and the `secure=1` two-token model
- [Access token claims](../../docs/guides/token-claims.md) — what's inside a token (`iss`, `workspaceId`, `secure`, scopes)

## Quick Start

Only `clientId` and `scopes` are required — the endpoints default to the Altium 365 Commercial Cloud. Pick the flow that matches your app.

### Public apps (desktop / on-prem — ActionWait sign-in)

For desktop, on-prem, and native clients that **can't host a public redirect**. `signIn` opens the browser, waits for the callback over Altium's ActionWait long-poll, and returns tokens. See [Desktop / on-prem apps](../../docs/guides/desktop-and-onprem-apps.md).

```typescript
import { signIn, signIntoWorkspace } from "@altium-developer/a365-auth";

const config = {
  clientId: "your-client-id",
  scopes: "openid profile",
};

// Opens a browser login page and waits for the callback
const tokens = await signIn(config);

// Persist `tokens` yourself — e.g. VS Code SecretStorage, a keychain, or a file.

// Exchange the global token for a workspace-scoped token
const workspaceToken = await signIntoWorkspace(config, tokens.access_token, "workspace-id-here");
```

The library returns tokens and never stores them — persistence, refresh, and
sign-out are entirely yours to manage.

### Confidential apps (web / server — authorization-code redirect)

For web/server backends that **host their own redirect endpoint**. Set `clientSecret` on the config to authenticate as a confidential client (HTTP Basic), and drive the flow with two composable steps. See [Web / server apps](../../docs/guides/web-and-server-apps.md).

```typescript
import { createAuthorizationUrl, exchangeCode } from "@altium-developer/a365-auth";

const config = {
  clientId: "your-client-id",
  clientSecret: "your-client-secret",   // confidential client → HTTP Basic auth
  scopes: "openid profile offline_access",
};
const redirectUri = "https://my-service.example.com/oauth/callback";

// On your login route: build the URL, stash state + verifier, then redirect.
app.get("/login", (req, res) => {
  const { url, state, codeVerifier } = createAuthorizationUrl(config, { redirectUri });
  req.session.oauth = { state, codeVerifier };
  res.redirect(url);
});

// On your callback route: verify state, then exchange the code for tokens.
app.get("/oauth/callback", async (req, res) => {
  const { state, codeVerifier } = req.session.oauth;
  if (req.query.state !== state) throw new Error("state mismatch");

  const tokens = await exchangeCode(config, {
    code: String(req.query.code),
    codeVerifier,
    redirectUri,
  });
  // Persist `tokens`; then discover/exchange workspaces and refresh as usual.
});
```

`createAuthorizationUrl` is synchronous (it generates PKCE + `state` and returns the URL to redirect to); `exchangeCode` performs the token exchange. Both `signIntoWorkspace` and `refreshToken` also send the `clientSecret` automatically when it's set.

### Gov Cloud

Altium Gov Cloud is an isolated environment for ITAR/regulated workspaces. Use the exported `GOV_CLOUD_ENDPOINTS` — that's it. The library detects the Gov token endpoint and adds the required `secure=1` to token requests automatically (the two-token model); no `secure` flag to set.

```typescript
import { signIn, GOV_CLOUD_ENDPOINTS } from "@altium-developer/a365-auth";

const tokens = await signIn({
  clientId: "your-gov-client-id",
  scopes: "openid profile",
  ...GOV_CLOUD_ENDPOINTS,
});
```

Commercial and Gov are kept strictly separate: a global token can only be exchanged for a workspace of the matching kind. `secure=1` is driven by which token endpoint you use — Gov endpoint → sent, Commercial endpoint → omitted — so pointing `tokenEndpoint` at the Gov host is all it takes to exchange a Commercial token for a Gov workspace token.

> Gov tokens must never be used against Commercial (non-Gov) services, and vice versa. For Dev Gov testing, swap the host for `https://auth.dev-365-gov.altium.com`. See [docs/gov-cloud.md](../../docs/guides/gov-cloud.md).

### Non-production environments

For Dev/UAT, on-prem, or other installations, override any of the four
endpoints. Anything you omit still falls back to the Commercial Cloud:

```typescript
import { COMMERCIAL_CLOUD_ENDPOINTS } from "@altium-developer/a365-auth";

const config = {
  clientId: "your-client-id",
  scopes: "openid profile",
  // Point auth + token at an on-prem host; keep the rest on the Commercial Cloud:
  authEndpoint: "https://auth.my-onprem.example/connect/authorize",
  tokenEndpoint: "https://auth.my-onprem.example/connect/token",
};

// Endpoint presets are exported to inspect or spread:
// COMMERCIAL_CLOUD_ENDPOINTS and GOV_CLOUD_ENDPOINTS.
console.log(COMMERCIAL_CLOUD_ENDPOINTS.tokenEndpoint);
```

## API Reference

### `signIn(config, options?)`

Performs OAuth2 PKCE sign-in. Opens the browser to the authorization URL, long-polls for the code callback via ActionWait, exchanges it for tokens, and returns the result.

**Does NOT** persist tokens or manage auth state — those are your responsibility. You receive a `TokenSet` back and store it yourself.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| config | `OAuthConfig` | OAuth2 configuration (`clientId` + `scopes` required; endpoints default to the Commercial Cloud) |
| options | `SignInOptions` | Optional: `timeoutMs` (default 180s), `AbortSignal` for cancellation, `selectWorkspace` for login-into-workspace mode |

**Returns:** `Promise<TokenSet>` — the full token response from the IdP.

### `createAuthorizationUrl(config, options?)`

Builds an OAuth2 authorization URL with PKCE for the redirect-based (authorization-code) flow. Synchronous — no network I/O.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| config | `OAuthConfig` | Same as signIn |
| options | `AuthorizationUrlOptions` | Optional: `redirectUri`, `state`, `codeVerifier`, `scopes`, `selectWorkspace` overrides |

**Returns:** `AuthorizationRequest` — `{ url, state, codeVerifier }`. Redirect the user to `url`; persist `state` and `codeVerifier` (e.g. in the session) for the callback.

### `exchangeCode(config, params)`

Exchanges an authorization `code` (from your redirect callback) for tokens via the `authorization_code` grant. Sends the `clientSecret` (HTTP Basic) for confidential clients, or `client_id` + PKCE `codeVerifier` for public clients.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| config | `OAuthConfig` | Same as signIn |
| params | `ExchangeCodeParams` | `{ code, codeVerifier?, redirectUri? }` |

**Returns:** `Promise<TokenSet>`.

**Throws:** `Error` if `code` is empty.

### `signIntoWorkspace(config, baseAccessToken, workspaceAuthId)`

Exchanges a base access token (the `access_token` from `signIn`) for a workspace-scoped token using OAuth2's `urn:ietf:params:oauth:grant-type:token-exchange` grant.

**Does NOT** cache tokens internally — call it each time you need a fresh token.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| config | `OAuthConfig` | Same as signIn |
| baseAccessToken | `string` | The `access_token` returned by `signIn` |
| workspaceAuthId | `string` | The workspace's auth ID from Altium 365 |

**Returns:** `Promise<TokenSet>` — the workspace-scoped token.

**Throws:** `Error` if `baseAccessToken` is empty.

### `refreshToken(config, refreshToken)`

Exchanges a refresh token for a fresh `TokenSet` using the OAuth2 `refresh_token` grant. Use it when an access token has expired (compare `TokenSet.expires_at` against the current epoch seconds) to avoid a full interactive sign-in.

Works the same for **global and workspace** refresh tokens — no scope is sent, so the refreshed token keeps whatever grant the refresh token was issued for (a global token stays global; a workspace token stays workspace-scoped).

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| config | `OAuthConfig` | Same as signIn |
| refreshToken | `string` | A `refresh_token` from a prior `signIn` or `signIntoWorkspace` TokenSet |

**Returns:** `Promise<TokenSet>` — the refreshed tokens. If the IdP rotates refresh tokens, the response includes a new `refresh_token`; persist it and discard the old one.

**Throws:** `Error` if `refreshToken` is empty, or if the grant is rejected (e.g. the refresh token expired or was revoked).

> **Tip:** request the `offline_access` scope at sign-in to receive a `refresh_token`.

```typescript
import { refreshToken } from "@altium-developer/a365-auth";

const nowSeconds = Math.floor(Date.now() / 1000);
if (tokens.expires_at && tokens.expires_at <= nowSeconds && tokens.refresh_token) {
  tokens = await refreshToken(config, tokens.refresh_token);
  // Persist `tokens` again — including a rotated refresh_token if present.
}
```

### `revokeRefreshToken(config, refreshToken)`

Revokes a refresh token via the OAuth2 Token Revocation endpoint (RFC 7009) — call it on sign-out to invalidate the grant server-side. The revocation endpoint is derived from the token endpoint (`/connect/token` → `/connect/revocation`); only **refresh** tokens are revoked. Client authentication follows the client type (confidential → HTTP Basic; public → `client_id` in body).

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| config | `OAuthConfig` | Same as signIn |
| refreshToken | `string` | The `refresh_token` to revoke |

**Returns:** `Promise<void>`. Per RFC 7009 the call is idempotent (the endpoint returns `200` for both known and unknown tokens).

**Throws:** `Error` if `refreshToken` is empty, or the endpoint returns a non-2xx status. After a successful revoke, a subsequent `refreshToken` with the same token fails with `invalid_grant`.

```typescript
import { revokeRefreshToken } from "@altium-developer/a365-auth";

// On sign-out:
if (tokens.refresh_token) {
  await revokeRefreshToken(config, tokens.refresh_token);
}
// ...then discard your local copy of the tokens.
```

## Types

### `OAuthConfig`

```typescript
interface OAuthConfig {
  clientId: string;           // OAuth2 client ID registered with Altium
  scopes: string;             // Space-delimited, must include "openid profile"

  clientSecret?: string;      // Confidential clients only → HTTP Basic auth
  secure?: boolean;           // Override Gov auto-detection (normally unset)

  // Optional — default to COMMERCIAL_CLOUD_ENDPOINTS. Override for Dev/UAT/on-prem,
  // or spread GOV_CLOUD_ENDPOINTS for Gov Cloud.
  authEndpoint?: string;      // default: https://auth.altium.com/connect/authorize
  tokenEndpoint?: string;     // default: https://auth.altium.com/connect/token
  actionWaitEndpoint?: string; // default: https://actionwait.altium.com/await
  redirectUri?: string;       // default: https://auth.altium.com/api/AuthComplete
}
```

### `TokenSet`

```typescript
interface TokenSet {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  expires_at?: number;       // Epoch seconds (computed by library)
  scope?: string;
}
```

> `access_token` is a signed JWT — decode it to read `iss`, `workspaceId`, `secure`, and scopes. See [Access token claims](../../docs/guides/token-claims.md).

### `AuthorizationUrlOptions` / `SignInOptions`

Both `createAuthorizationUrl` and `signIn` accept a `selectWorkspace` option for [login-into-workspace mode](../../docs/overview.md#login-into-workspace-mode):

```typescript
// In AuthorizationUrlOptions (createAuthorizationUrl) and SignInOptions (signIn):
selectWorkspace?: "none" | "strict" | "optional";
// "strict"   — workspace selection mandatory; returned token is workspace-scoped.
// "optional" — workspace selection offered; user may skip.
// "none" or omitted (default) — no workspace prompt; issues a global access token.
```

## Error Handling

The library throws descriptive `Error` objects in these scenarios:

| Scenario | Error message pattern |
|----------|----------------------|
| Missing `clientId`/`scopes` | `OAuthConfig.{field} is required and must be non-empty.` |
| Invalid endpoint URL | `OAuthConfig.{field} is not a valid URL:` |
| ActionWait timeout | `ActionWait poll timed out after {n}ms.` |
| Sign-in cancelled | `Sign-in cancelled.` |
| CSRF detected | `State mismatch during sign-in (possible CSRF attack).` |
| Empty base token for workspace exchange | `baseAccessToken is required — pass the access_token from signIn().` |
| Empty refresh token | `refreshToken is required — pass the refresh_token from a prior TokenSet.` |
| Empty authorization code | `code is required — pass the authorization code from the redirect callback.` |
| Token endpoint returns OAuth error | `Token endpoint {status} {error_code} — {description}` |

## Compatibility

- **Node.js ≥20** — uses the global `fetch`, the global Web `crypto` (`randomUUID`), and the `crypto` module (`randomBytes`, `createHash`). Node 18 is EOL and not supported.
- **Bun / Deno** — supported (Node-compatible `fetch` + `crypto`).
- **Browsers / bundlers** — works where your bundler polyfills Node's `crypto` and `Buffer`.

## Development

```bash
npm install     # install dev dependencies
npm test        # run unit tests
npm run lint    # lint src/
npm run build   # compile to dist/
```

### E2E sign-in test

Run the sign-in flow against a live Altium environment. It opens your browser, waits for the ActionWait callback, and prints the resulting tokens (and optionally exercises workspace exchange and refresh).

```bash
# Commercial Cloud, public client
npm run test:e2e -- YOUR_CLIENT_ID

# Gov Cloud (Dev) — verifies the secure=1 two-token model
npm run test:e2e -- --env dev-gov YOUR_GOV_CLIENT_ID

# Also exchange a workspace token and exercise refresh
npm run test:e2e -- --workspace <authId> --refresh YOUR_CLIENT_ID

# Confidential client (HTTP Basic) — pass the secret via env, never on the CLI
A365_CLIENT_SECRET=... npm run test:e2e -- YOUR_CLIENT_ID
```

Options include `--env prod|dev|gov|dev-gov`, `--workspace-env`, `--secure`/`--no-secure`, `--scopes`, `--workspace`, `--refresh`, `--userinfo`, `--revoke`, plus `--authorize-url`/`--exchange-code`/`--redirect-uri` for confidential (custom-callback) clients — see the header of [`scripts/test-signin.ts`](https://github.com/AltiumDeveloper/a365-auth/blob/main/libs/typescript/scripts/test-signin.ts). The client secret is read from `A365_CLIENT_SECRET` so it never appears in shell history or the process list.

See [CONTRIBUTING.md](https://github.com/AltiumDeveloper/a365-auth/blob/main/CONTRIBUTING.md) and [AGENTS.md](https://github.com/AltiumDeveloper/a365-auth/blob/main/AGENTS.md) for the full contributor guide.

## Security

Please report vulnerabilities privately — see [SECURITY.md](https://github.com/AltiumDeveloper/a365-auth/blob/main/SECURITY.md).

## License

[MIT](https://github.com/AltiumDeveloper/a365-auth/blob/main/libs/typescript/LICENSE) © Altium Limited
