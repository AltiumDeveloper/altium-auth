# Access token claims

Altium 365 access tokens are signed JWTs (header `typ: at+jwt`, `alg: RS256`). You can base64url-decode the payload to see who the token is for, which application obtained it, what it grants, and which cloud it belongs to.

> **Validate before you trust.** Verify the token's signature against the issuer's JWKS (published in the [discovery document](./overview.md#endpoints)) and check `exp`/`iss`/`aud` before relying on any claim. Decoding alone does not prove authenticity.

Example payload (a Gov Cloud workspace token; identifiers shown as placeholders):

```json
{
  "iss": "https://auth.365-gov.altium.com",
  "sub": "00000000-0000-0000-0000-000000000000",
  "client_id": "11111111-1111-1111-1111-111111111111",
  "scope": ["a365:workspace:22222222-2222-2222-2222-222222222222", "openid", "profile", "offline_access"],
  "workspaceId": "22222222-2222-2222-2222-222222222222",
  "secure": "1",
  "iat": 1783517196,
  "exp": 1783531596
}
```

## The claims that matter

| Claim | Present on | Meaning |
| --- | --- | --- |
| `iss` | every token | **Issuer** — the base URL that minted the token, which identifies the cloud: `https://auth.altium.com` (Commercial), `https://auth.365-gov.altium.com` (Gov Cloud), or `{origin}/unifiedlogin` (AES, on-prem). |
| `sub` | every token | **Subject** — for user tokens, the user's ID (a stable identifier; the same value the [`userinfo`](./web-and-server-apps.md#read-the-users-profile-optional) endpoint returns as `sub`). |
| `client_id` | every token | The **application** — the registered OAuth client that obtained the token. |
| `scope` | every token | The granted scopes. A workspace token includes `a365:workspace:{workspaceId}`; `offline_access` means a refresh token was issued alongside it. |
| `workspaceId` | workspace tokens | The workspace's `authId` — the single workspace this token grants access to (it matches the `a365:workspace:` scope). **Absent on global tokens, and on all AES tokens**. |
| `secure` | Gov Cloud tokens | `"1"` — marks a Gov Cloud token bound to Gov Cloud. **Absent on Commercial and AES tokens.** |

## Reading the token kind from the claims

- **Global vs. workspace token** — a workspace token has a `workspaceId` claim and an `a365:workspace:{id}` scope; a global token has neither.
- **Commercial vs. Gov Cloud token** — a Gov Cloud token carries `secure: "1"` and a Gov `iss`; a Commercial token has no `secure` claim. See [Gov Cloud considerations](./gov-cloud.md).
- **AES (on-prem) token** — a workspace token has a `a365:workspace:{id}` scope, but there is **no `workspaceId` claim** and **no `secure` claim** (same as Commercial). `iss` is the AES installation's own `{origin}/unifiedlogin` base. See [AES (on-prem) considerations](./aes.md).

## Standard claims

Tokens also carry the usual OAuth 2.0 / OIDC JWT claims — `iat`, `nbf`, `exp` (validity window, epoch seconds), `aud` (audience), `jti` (token ID), `amr` (authentication methods), `sid` (session ID), and `idp` (identity provider). Treat any claim not listed above as an implementation detail that may change.

## Related

- [Authentication overview](./overview.md) · [Web and server application flow](./web-and-server-apps.md)
- [Gov Cloud considerations](./gov-cloud.md) · [AES (on-prem) considerations](./aes.md)
