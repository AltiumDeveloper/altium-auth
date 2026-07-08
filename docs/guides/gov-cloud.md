# Gov Cloud considerations

Altium Gov Cloud is an isolated environment for ITAR/regulated workspaces. The authentication flows are the same as the [web](./web-and-server-apps.md) and [desktop/on-prem](./desktop-and-onprem-apps.md) guides, with the differences outlined below. Contact Altium for Gov Cloud onboarding.

## Separate issuer

Gov Cloud uses its own issuer and endpoints under `auth.365-gov.altium.com` (distinct from Commercial `auth.altium.com`). A token's issuer (`iss`) determines whether it is a Commercial or a Gov token. **Commercial and Gov are kept strictly separate:** a Gov token must never be used against Commercial (non-Gov) services, and a Commercial token must never be used against Gov Cloud.

> **Gov hosts for authorize/token only.** Only `/connect/authorize` and `/connect/token` move to the gov host. The ActionWait poll service (`/await`) has no gov-specific DNS — it uses the commercial host for the same environment tier.
>
> | Environment | Authorize / token | ActionWait poll |
> | --- | --- | --- |
> | Prod Gov | `auth.365-gov.altium.com` | `actionwait.altium.com/await` |
> | Dev Gov | `auth.dev-365-gov.altium.com` | `actionwait.dev1.altium.com/await` |

## The two-token model

Because a single self-contained JWT can be replayed wherever it travels, Gov Cloud restores a hard boundary using **two tokens**:

- A **global token** — used for requests to global services (for example, user profile or workspace info).
- A **secure token** — carries a `secure=1` attribute and is bound to Gov Cloud. Only Gov Cloud authorizes with it; Commercial workspaces reject it.

This guarantees a Gov Cloud (`secure=1`) token cannot be accepted by Commercial services.

## Identifying Gov Cloud workspaces

When you discover workspaces (`desWorkspaceInfos`), a Gov Cloud workspace reports `location.name = "US GovCloud"`. Use that to decide which `/token` endpoint to exchange on. Checking `location.name` is the current recommended way to tell Gov workspaces apart.

## Exchanging tokens for Gov Cloud workspaces

Following the [recommended flow](./overview.md#the-authentication-journey), you sign in once on Commercial `auth.altium.com` and then exchange the global token per workspace.

- **Non-Gov workspace**: exchange your Commercial global token at `auth.altium.com/connect/token` **without** `secure=1` to get a Commercial workspace token (`iss = auth.altium.com`). Requesting a Gov workspace here returns `access_denied`.
- **Gov Cloud workspace**: exchange your Commercial global token at `auth.365-gov.altium.com/connect/token` **with** `secure=1` to get a Gov Cloud workspace token (`iss = auth.365-gov.altium.com`). Requesting a non-Gov workspace here returns `access_denied`.

Refresh each workspace token at the endpoint that issued it (a Gov workspace token refreshes on `auth.365-gov.altium.com` with `secure=1`).

**Rule of thumb:** send `secure=1` on token requests to the **Gov** `/token` endpoint and omit it on the **Commercial** `/token` endpoint — regardless of which side issued the token you present. `secure=1` is a token-endpoint parameter; it is not sent on `/authorize`.

## What this means for your application

Рold the **Commercial global token** from sign-in for global services, and use each **Gov workspace token** only for that workspace's Gov Cloud API calls. Never send a Gov token to global (Commercial) services, and never send a Commercial token to Gov Cloud.

## Related

- [Authentication overview](./overview.md) · [Access token claims](./token-claims.md) (the `secure` claim)
- [Web and server application flow](./web-and-server-apps.md) · [Desktop and on-prem flow](./desktop-and-onprem-apps.md)
