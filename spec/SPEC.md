# Altium Identity Integration Specification

**Version:** 0.1.0 (DRAFT)
**Status:** extracted from the validated `@altium-developer/a365-auth` reference implementation and `docs/`, and cross-validated by the .NET (`Altium.Auth`) implementation against the shared conformance vectors. Preview — subject to change as the libraries evolve.

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are used per [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119).

This document specifies **only the Altium-specific parts** of the flow. Everything else follows the referenced standards and SHOULD be implemented with a certified OIDC/OAuth client rather than re-implemented:

- OAuth 2.0 — RFC 6749 · PKCE — RFC 7636 · Token Exchange — RFC 8693
- Token Revocation — RFC 7009 · OIDC Core · OIDC Discovery · RFC 8414

---

## 1. Environments and endpoints

Altium Identity runs as an OpenID Connect provider, one **base URL per environment**. A client targets exactly one environment.

| Name | Base URL | Discovery document |
| --- | --- | --- |
| Commercial Cloud | `https://auth.altium.com` | `https://auth.altium.com/.well-known/openid-configuration` |
| Gov Cloud | `https://auth.365-gov.altium.com` | `https://auth.365-gov.altium.com/.well-known/openid-configuration` |

- Clients **SHOULD** resolve endpoints from the discovery document; hardcoded base URLs **MAY** be used as a fallback.
- Standard endpoints (all under the base URL): `/connect/authorize`, `/connect/token`, `/connect/userinfo`, `/connect/revocation`.
- The base URLs above are the production hosts; a deployment **MAY** expose the same endpoints under different hosts, so treat base URLs as configuration rather than constants.

### 1.1 ActionWait host (proprietary)

The **ActionWait** service is a single Commercial-Cloud deployment — it has **no** Gov-specific host. In production it is:

| Service | Endpoint |
| --- | --- |
| ActionWait poll | `https://actionwait.altium.com/await` |

---

## 2. Client types

| Type | Credential | Redirect | Auth at token endpoint |
| --- | --- | --- | --- |
| **Confidential** (web/server) | `client_secret` | App-hosted callback | HTTP Basic (`client_secret_basic`) |
| **Public** (desktop) | none (PKCE) | ActionWait (`§4`) | `client_id` in the request body |

- Public clients **MUST NOT** hold a secret and **MUST** use PKCE (§3).
- Confidential clients **MUST** authenticate at the token endpoint with HTTP Basic and **SHOULD** also use PKCE.

---

## 3. PKCE (RFC 7636)

- Clients **MUST** use PKCE with `code_challenge_method=S256`.
- The `code_verifier` **MUST** be a high-entropy random string (reference: base64url of 32 random bytes).
- `code_challenge = base64url(SHA256(code_verifier))`.

---

## 3.1 `selectWorkspace` — login-into-workspace mode (proprietary)

The `/connect/authorize` endpoint accepts an optional `selectWorkspace` query parameter that controls whether the user is prompted to select a workspace during the authorization flow.

| Value | Behavior |
| --- | --- |
| `none` (default) or omitted | Workspace selection is skipped; the flow issues a global access token. |
| `strict` | Workspace selection is **mandatory** — the user must choose a workspace before authentication can complete. |
| `optional` | Workspace selection is presented to the user but may be skipped. |

When a workspace is selected during the authorization flow, the issued access token is already scoped to that workspace (`a365:workspace:<workspaceId>`), eliminating the need for a separate token-exchange step (§5.2).

Rules:
- `selectWorkspace` **MUST NOT** be sent on the token endpoint — it is an authorize-only parameter.
- When `selectWorkspace` is `none` or omitted, the parameter **SHOULD** be omitted from the URL.
- The `secure=1` rule (§5.4) still applies at the token endpoint regardless of which `selectWorkspace` value was used.

---

## 4. ActionWait (proprietary — public clients)

Public clients cannot host a redirect. ActionWait delivers the authorization result to a waiting client over an HTTP long poll.

### 4.1 The linchpin
The client generates one high-entropy value used **simultaneously** as:
- the OAuth `state` parameter in the authorize request, **and**
- the ActionWait **wait token**.

The Altium-hosted callback correlates the browser's `code`+`state` to the waiting poll by matching `state` to the wait token. Verifying the returned `state` equals the generated value is also the CSRF check.

### 4.2 Redirect URI
- The authorize request's `redirect_uri` **MUST** be the Altium-hosted `AuthComplete` callback on the **Commercial Cloud** host for the tier — e.g. `https://auth.altium.com/api/AuthComplete` (Production), including for Gov sign-in. A gov-host callback is not registered and **will** fail authorization.

### 4.3 Poll protocol — `POST {actionWaitHost}/await`
Request body (`Content-Type: application/json`):
```json
{ "token": "<wait_token>" }
```
Responses:
- `200` — result ready. Body: `{ "data": { "code": "<code>", "state": "<wait_token>" } }`. The client **MUST** verify `data.state` equals its wait token before using `data.code`.
- `408` — the poll's server-side hold interval elapsed. This is **normal**; the client **MUST** immediately reconnect with the **same** token. The hold interval is an unspecified implementation detail and clients **MUST NOT** depend on any particular duration; it is distinct from the client's own overall sign-in timeout, which spans the whole reconnect loop.
- `410` — the wait token is no longer valid (consumed/superseded). Terminal; the client **MUST** restart sign-in with a new token.
- Other status — treat as an error.

### 4.4 Ordering
The client **MUST** start the `/await` poll **before** opening the browser, so a fast sign-in cannot deliver the result before the client is listening.

---

## 5. Token requests

All tokens are obtained from `{base}/connect/token`. Client authentication per §2.

### 5.1 Authorization code (RFC 6749 + PKCE)
`grant_type=authorization_code`, `code`, `redirect_uri`, `code_verifier`.

### 5.2 Workspace token exchange (RFC 8693)
`grant_type=urn:ietf:params:oauth:grant-type:token-exchange`,
`subject_token=<global access token>`,
`subject_token_type=urn:ietf:params:oauth:token-type:access_token`,
`scope` includes `a365:workspace:{workspaceId}`.

### 5.3 Refresh (RFC 6749 §6)
`grant_type=refresh_token`, `refresh_token`.
- Clients **MUST NOT** send `scope` on refresh (the grant retains the token's original scope — a global token stays global, a workspace token stays workspace-scoped).
- The provider **MAY** rotate the refresh token; if a new one is returned the client **MUST** persist it and discard the old.

### 5.4 `secure=1` (Commercial vs Gov)
- A token request to a **Gov** token endpoint (`§6`) **MUST** include `secure=1`.
- A token request to a **Commercial** token endpoint **MUST NOT** include `secure=1`.
- This applies to **all** grants in §5. `secure=1` is a token-endpoint parameter and **MUST NOT** be sent on `/authorize`.

---

## 6. Commercial vs Gov (proprietary)

Commercial and Gov are kept strictly separate. A token's environment is its issuer (`iss`), set by the host it signed in on.

**Recommended flow (works for public and confidential):**
1. Sign in on **Commercial Cloud** → global access token (`iss = https://auth.altium.com`).
2. Discover the user's workspaces with the global token (§7).
3. Exchange the global token for a **workspace** token at the endpoint matching the workspace:
   - Commercial workspace → Commercial token endpoint, **no** `secure=1`.
   - Gov workspace → Gov token endpoint, **with** `secure=1`. The result has `iss = https://auth.365-gov.altium.com` and a `secure` claim.
4. Call the API with the workspace token; refresh at the endpoint that issued it.

Rules (validated):
- A global token **MUST** be exchanged for a workspace on the matching side; a mismatched exchange returns **`access_denied`**:
  - Gov workspace on the Commercial endpoint → `access_denied`.
  - Commercial workspace on the Gov endpoint → `access_denied`.
  - Gov endpoint **without** `secure=1` → `access_denied`.
- A Gov (`secure`) token **MUST NOT** be presented to Commercial/global services, and vice versa.
- **Same environment only.** The Commercial→Gov exchange happens between the Commercial and Gov hosts of the **same deployment/environment**. A token's issuer must be trusted by the exchange endpoint, so presenting a token to a *different* environment's endpoint is rejected with **`invalid_request` / `invalid_token`**.

Host detection (reference heuristic): a token endpoint is Gov iff its host contains a `gov` label (e.g. `auth.365-gov.altium.com`). Implementations **MAY** allow an explicit override for non-standard hosts.

---

## 7. Workspace discovery

Discover the user's workspaces with the global access token (GraphQL):

```graphql
query {
  desWorkspaceInfos { authId name url location { name } }
}
```

- `authId` is the `{workspaceId}` used in §5.2.
- A workspace is in **Gov Cloud** iff `location.name = "US GovCloud"` — the current recommended signal for choosing the exchange endpoint.

> OPEN: confirm the `des` prefix and the global discovery GraphQL endpoint with the API team.

---

## 8. Access token claims

Access tokens are signed JWTs (`typ: at+jwt`, `alg: RS256`). Verify the signature against the issuer's JWKS before trusting claims. Altium-relevant claims:

| Claim | Present on | Meaning |
| --- | --- | --- |
| `iss` | all | Issuer → the environment/cloud |
| `sub` | all | User ID (for user tokens) |
| `client_id` | all | The application (OAuth client) |
| `scope` | all | Granted scopes (`a365:workspace:{id}`, `offline_access`, …) |
| `workspaceId` | workspace tokens | The workspace `authId`; absent on global tokens |
| `secure` | Gov tokens | `"1"`; absent on Commercial tokens |

See `schemas/access-token-claims.schema.json`.

---

## 9. Revocation (RFC 7009)

- Only **refresh tokens** can be revoked. `POST {base}/connect/revocation` with `token=<refresh_token>`, `token_type_hint=refresh_token`, client auth per §2. Success is `200` with an empty body (also `200` for unknown/already-invalid tokens).
- Access tokens are self-contained JWTs and **cannot** be revoked; they remain valid until `exp`. To cut off access, revoke the refresh token and keep access-token lifetimes short.

---

## 10. Error contract (observed)

| Situation | Response |
| --- | --- |
| Cross-partition / missing-`secure` workspace exchange | `400 { "error": "access_denied" }` |
| Subject token from a different environment (cross-tier exchange) | `400 { "error": "invalid_request", "error_description": "invalid_token" }` |
| Expired/revoked refresh token, bad code, PKCE mismatch | `400 { "error": "invalid_grant" }` |
| Bad client credentials | `400 { "error": "invalid_client" }` |

Errors follow the OAuth 2.0 error response shape (`error`, optional `error_description`).

---

## References
- Conceptual guides: [docs/](https://github.com/AltiumDeveloper/a365-auth/tree/main/docs) (overview, web/server, desktop, gov-cloud, register, token-claims)
- Reference implementations: `libs/typescript/` (TypeScript) and `libs/dotnet/` (.NET)
- Conformance vectors: [spec/conformance/](https://github.com/AltiumDeveloper/a365-auth/tree/main/spec/conformance)
