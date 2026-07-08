# Altium 365 Auth

Client libraries for **Altium 365 authentication** — OAuth2/OpenID Connect with PKCE,
the Altium **ActionWait** desktop sign-in flow, workspace token-exchange,
refresh/revocation, and **Gov Cloud** — built to a single language-neutral
specification and held to one shared conformance suite.

The spec is the source of truth; each library is a hand-written, idiomatic
implementation that is *validated by the same vectors*. Change the contract once, and
every library's CI proves it still conforms.

## Get started

Pick the flow that matches your application:

- **Desktop / on-prem / native** (can't host a redirect) → [Desktop & on-prem apps](desktop-and-onprem-apps.md)
  — browser sign-in with PKCE over ActionWait.
- **Web / server backends** (host a redirect) → [Web & server apps](web-and-server-apps.md)
  — the standard authorization-code redirect flow.

New to Altium Identity? Start with the [Overview](overview.md), then
[Register your application](register-your-application.md).

## Libraries

| Package | Registry | Install |
| --- | --- | --- |
| [`@altium-developer/a365-auth`](https://www.npmjs.com/package/@altium-developer/a365-auth) | npm | `npm i @altium-developer/a365-auth` |
| [`Altium.Auth`](https://www.nuget.org/packages/Altium.Auth) | NuGet | `dotnet add package Altium.Auth` |

Both are `0.1.0` **preview** — the API may change as the spec and libraries evolve.

## How it stays in sync

The [conformance vectors](conformance.md) are the enforcement layer: every library
runs the **same** `spec/conformance/vectors.json` and asserts the same requests and
outcomes, so the implementations can't drift. The normative behavior lives in the
[integration spec](spec.md).

## Topics

- [Gov Cloud](gov-cloud.md) — Commercial vs Gov and the `secure=1` two-token model
- [Access token claims](token-claims.md) — what's inside a token (`iss`, `workspaceId`, `secure`, scopes)
