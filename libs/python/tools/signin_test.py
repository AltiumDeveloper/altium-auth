#!/usr/bin/env python3
"""End-to-end sign-in verification against a live Altium environment.

The Python analog of libs/typescript/scripts/test-signin.ts and
libs/dotnet/tools/SignInTest/Program.cs — the SAME CLI surface and flow, so the
identical command works across all three implementations.

Usage:
    uv run python tools/signin_test.py [options] <clientId>

Options (mirror the TS/.NET harnesses):
    --env prod|dev|gov|dev-gov|aes        Sign-in environment (default: prod)
    --workspace-env prod|dev|gov|dev-gov  Endpoint for the workspace exchange (default: --env).
                                          e.g. --env prod --workspace-env gov exercises the
                                          Commercial->Gov bridge. Not applicable to AES.
    --aes-origin <origin>                 AES server origin (required when --env is "aes")
    --secure | --no-secure                Force secure=1 on/off (default: auto from token host)
    --scopes "<scopes>"                   Space-delimited scopes (default: "openid profile")
    --workspace <authId>                  Workspace to obtain a token for (two-trip + one-trip)
    --select-workspace none|strict|optional  Login-into-workspace mode at /authorize
                                          (default: none; not applicable to AES)
    --refresh                             After sign-in, exercise refresh (implies offline_access)
    --userinfo                            After sign-in, GET /connect/userinfo and print it
    --revoke                              Revoke the (latest) refresh token, then prove it fails

Confidential / custom-callback clients (host their own redirect, not ActionWait):
    --authorize-url                       Print the authorize URL (+ state, verifier) and exit
    --redirect-uri <url>                  Callback for authorize-url / exchange-code
    --exchange-code <code>                Exchange an authorization code for tokens
    --code-verifier <v>                   PKCE verifier from the --authorize-url step

Env:
    A365_CLIENT_SECRET  Confidential client secret -> HTTP Basic (optional)

Examples:
    uv run python tools/signin_test.py my-client-id
    uv run python tools/signin_test.py --env dev-gov my-gov-client-id
    uv run python tools/signin_test.py --workspace-env gov --workspace <authId> my-client-id
    uv run python tools/signin_test.py --authorize-url --redirect-uri https://app/cb my-client
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
import sys

from altium_auth import (
    COMMERCIAL_CLOUD_ENDPOINTS,
    GOV_CLOUD_ENDPOINTS,
    AltiumAuthClient,
    AltiumAuthConfig,
    AltiumEndpoints,
    TokenSet,
    WorkspaceSelection,
    _http,  # our transport (carries the product User-Agent past the edge WAF)
    aes_endpoints,
)

_SIGN_IN_TIMEOUT = 300.0
_WORKSPACE_SCOPE_PREFIX = "a365:workspace:"
_ENVS = ["prod", "dev", "gov", "dev-gov", "aes"]


# ── args ─────────────────────────────────────────────────────────
def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="signin_test.py",
        description="Live Altium 365 sign-in E2E test (mirrors the TS/.NET harnesses).",
    )
    p.add_argument("client_id")
    p.add_argument("--env", choices=_ENVS, default="prod")
    p.add_argument("--workspace-env", choices=_ENVS)
    p.add_argument("--aes-origin")
    p.add_argument("--secure", dest="secure", action="store_const", const=True, default=None)
    p.add_argument("--no-secure", dest="secure", action="store_const", const=False)
    p.add_argument("--scopes", default="openid profile")
    p.add_argument("--workspace")
    p.add_argument("--select-workspace", choices=["none", "strict", "optional"])
    p.add_argument("--refresh", action="store_true")
    p.add_argument("--userinfo", action="store_true")
    p.add_argument("--revoke", action="store_true")
    p.add_argument("--authorize-url", action="store_true")
    p.add_argument("--exchange-code", dest="code")
    p.add_argument("--code-verifier", dest="code_verifier")
    p.add_argument("--redirect-uri", dest="redirect_uri")
    args = p.parse_args(argv)

    if args.env == "aes" and not args.aes_origin:
        p.error('--aes-origin is required when --env is "aes".')
    # AES hosts a single workspace, so there is nothing to select (SPEC §6).
    if args.select_workspace is not None and args.env == "aes":
        p.error("--select-workspace is not applicable to AES (single workspace per installation).")
    # Refresh and revoke both need a refresh token, which requires offline_access.
    if (args.refresh or args.revoke) and "offline_access" not in args.scopes.split():
        args.scopes = f"{args.scopes} offline_access".strip()
    return args


def _select_workspace(args: argparse.Namespace) -> WorkspaceSelection:
    if args.select_workspace:
        return WorkspaceSelection(args.select_workspace)
    return WorkspaceSelection.NONE


# ── endpoints / config ───────────────────────────────────────────
def _endpoints_for(env: str, aes_origin: str | None) -> AltiumEndpoints:
    if env == "prod":
        return COMMERCIAL_CLOUD_ENDPOINTS
    if env == "gov":
        return GOV_CLOUD_ENDPOINTS
    if env == "aes":
        return aes_endpoints(aes_origin or "")
    if env == "dev":
        return AltiumEndpoints(
            authorize_endpoint="https://auth.dev1.altium.com/connect/authorize",
            token_endpoint="https://auth.dev1.altium.com/connect/token",
            action_wait_endpoint="https://actionwait.dev1.altium.com/await",
            redirect_uri="https://auth.dev1.altium.com/api/AuthComplete",
        )
    # dev-gov: authorize/token on the dev-gov host; ActionWait + AuthComplete on dev Commercial.
    return AltiumEndpoints(
        authorize_endpoint="https://auth.dev-365-gov.altium.com/connect/authorize",
        token_endpoint="https://auth.dev-365-gov.altium.com/connect/token",
        action_wait_endpoint="https://actionwait.dev1.altium.com/await",
        redirect_uri="https://auth.dev1.altium.com/api/AuthComplete",
    )


def _tier(env: str) -> str:
    # A token can only be exchanged within its own tier (prod<->gov, dev<->dev-gov).
    if env in ("prod", "gov"):
        return "prod"
    if env == "aes":
        return "aes"
    return "dev"


def _mk_config(
    args: argparse.Namespace,
    env: str,
    client_secret: str | None,
    scope_override: str | None = None,
) -> AltiumAuthConfig:
    return AltiumAuthConfig(
        client_id=args.client_id,
        scopes=scope_override or args.scopes,
        client_secret=client_secret,
        endpoints=_endpoints_for(env, args.aes_origin),
        secure=args.secure,
    )


# ── output helpers ───────────────────────────────────────────────
def _decode_jwt(token: str) -> dict | None:
    """Decode a JWT payload for human-readable output (no signature verification)."""
    parts = token.split(".")
    if len(parts) != 3:
        return None
    payload = parts[1].replace("-", "+").replace("_", "/")
    payload += "=" * (-len(payload) % 4)
    try:
        claims = json.loads(base64.b64decode(payload))
    except (ValueError, binascii.Error):
        return None
    return claims if isinstance(claims, dict) else None


def _announce(label: str) -> None:
    print(f"\n⏺️  Testing: {label}")


def _print_tokens(label: str, t: TokenSet) -> None:
    print(f"\n✅ {label}\n")
    print(f"  access_token : {t.access_token}")
    claims = _decode_jwt(t.access_token)
    if claims:
        # The access token is a JWT — surface the claims that vary Commercial vs Gov.
        print(f"  ↳ iss        : {claims.get('iss')}")
        if "secure" in claims:
            print(f"  ↳ secure     : {claims['secure']}")
    print(f"  token_type   : {t.token_type}")
    print(f"  expires_at   : {t.expires_at}")
    print(f"  scope        : {t.scope}")
    if t.refresh_token:
        print(f"  refresh_token: {t.refresh_token}")
    if t.id_token:
        idc = _decode_jwt(t.id_token)
        if idc:
            print(f"  id_token     : {json.dumps(idc, indent=2)[:300]}...")


def _print_userinfo(authorize_endpoint: str, access_token: str) -> None:
    url = authorize_endpoint.replace("/connect/authorize", "/connect/userinfo")
    resp = _http.request("GET", url, headers={"Authorization": f"Bearer {access_token}"})
    print(f"\nℹ️  userinfo ({resp.status}) @ {url}:\n{resp.text}")


def _workspace_scope_id(scope: str) -> str:
    return scope[len(_WORKSPACE_SCOPE_PREFIX) :]


# ── test flow ────────────────────────────────────────────────────
def _sign_in_once(client: AltiumAuthClient, args: argparse.Namespace) -> TokenSet:
    """Obtain a token via a manual authorization code, or the interactive ActionWait sign-in."""
    if args.code:
        return client.exchange_code(
            args.code, code_verifier=args.code_verifier, redirect_uri=args.redirect_uri
        )
    return client.sign_in(select_workspace=_select_workspace(args), timeout=_SIGN_IN_TIMEOUT)


def _test_scope_introspection(
    args: argparse.Namespace, sign_in_config: AltiumAuthConfig
) -> list[str] | None:
    scope_endpoint = sign_in_config.endpoints.scope_endpoint
    if not scope_endpoint:
        print("\n⏸️  Skipping scope introspection (no endpoint configured).")
        return None
    _announce("Client scope introspection")
    scopes = AltiumAuthClient.get_client_scopes(scope_endpoint, args.client_id)
    joined = " ".join(scopes) or "(none returned)"
    print(f"\n✅ Client scopes for {args.client_id} @ {scope_endpoint}: {joined}")
    return scopes


def _test_two_trip(
    args: argparse.Namespace,
    sign_in_config: AltiumAuthConfig,
    exchange_config: AltiumAuthConfig,
) -> tuple[TokenSet, AltiumAuthConfig]:
    _announce("Two-trip sign-in (global token → workspace token)")
    global_tokens = _sign_in_once(AltiumAuthClient(sign_in_config), args)
    _print_tokens("Global token:", global_tokens)
    if args.userinfo:
        _print_userinfo(sign_in_config.endpoints.authorize_endpoint, global_tokens.access_token)
    if not args.workspace:
        print("\n⏸️  Skipping workspace token exchange (no --workspace provided).")
        return global_tokens, sign_in_config
    ws = AltiumAuthClient(exchange_config).sign_into_workspace(
        global_tokens.access_token, args.workspace
    )
    _print_tokens(f"Workspace token ({args.workspace}) [two-trip]:", ws)
    return ws, exchange_config


def _test_one_trip(
    args: argparse.Namespace, client_secret: str | None, sign_in_config: AltiumAuthConfig
) -> None:
    # The one-trip test requests the workspace scope at sign-in on args.env's host, so it only
    # applies when the workspace is on the same tier. In bridge mode (e.g. --workspace-env gov) a
    # cross-tier scope would be denied — skip it (the two-trip exchange above is the right path).
    exchange_env = args.workspace_env or args.env
    if _tier(args.env) != _tier(exchange_env):
        print(
            f"\n⏸️  Skipping one-trip sign-in: workspace is on the '{exchange_env}' tier, "
            f"sign-in on '{args.env}'. A cross-tier workspace scope at /authorize is "
            "denied — use the two-trip exchange (above) instead."
        )
        return
    # The workspace scope comes from --workspace, or — on AES — from ClientScopes. It is *added*
    # to the configured scopes, never substituted (offline_access must survive --refresh/--revoke).
    if args.workspace:
        workspace_scope: str | None = f"{_WORKSPACE_SCOPE_PREFIX}{args.workspace}"
    else:
        discovered = _test_scope_introspection(args, sign_in_config) or []
        workspace_scope = next(
            (s for s in discovered if s.startswith(_WORKSPACE_SCOPE_PREFIX)), None
        )
    if not workspace_scope:
        # Without a workspace scope this repeats the two-trip global sign-in — skip it.
        print("\n⏸️  Skipping one-trip workspace sign-in (no workspace scope requested).")
        return
    _announce("One-trip sign-in (direct workspace token)")
    one_trip_config = _mk_config(
        args, args.env, client_secret, scope_override=f"{args.scopes} {workspace_scope}"
    )
    tokens = _sign_in_once(AltiumAuthClient(one_trip_config), args)
    _print_tokens(f"Workspace token ({_workspace_scope_id(workspace_scope)}) [one-trip]:", tokens)
    if args.userinfo:
        _print_userinfo(one_trip_config.endpoints.authorize_endpoint, tokens.access_token)


def _test_refresh(tokens: TokenSet, config: AltiumAuthConfig) -> TokenSet:
    if not tokens.refresh_token:
        print("\n⚠️  --refresh requested but no refresh_token was returned (offline_access?).")
        return tokens
    _announce("Refresh token")
    print(f"\nRefreshing token: {tokens.refresh_token}")
    refreshed = AltiumAuthClient(config).refresh_token(tokens.refresh_token)
    _print_tokens("Refreshed token:", refreshed)
    return refreshed


def _test_revoke(tokens: TokenSet, config: AltiumAuthConfig) -> None:
    if not tokens.refresh_token:
        print("\n⚠️  --revoke requested but no refresh_token is available (offline_access?).")
        return
    client = AltiumAuthClient(config)
    _announce("Revoke token")
    print(f"\nRevoking token: {tokens.refresh_token}")
    client.revoke_refresh_token(tokens.refresh_token)
    print("\n🔒 revocation request sent (RFC 7009: 200 for known/unknown tokens).")
    # Prove it: a refresh with the revoked token should now fail. If it still works, fail the run.
    refresh_still_works = False
    try:
        client.refresh_token(tokens.refresh_token)
        refresh_still_works = True
    except Exception as e:
        print(f"\n✅ Refresh after revocation was rejected, as expected: {e}")
    if refresh_still_works:
        raise RuntimeError("Refresh still worked after revocation — it did not take effect.")


def _run_authorize_url(args: argparse.Namespace, client_secret: str | None) -> None:
    # A known workspace ID can be requested straight from /authorize (one-trip, no exchange).
    scope_override = (
        f"{args.scopes} {_WORKSPACE_SCOPE_PREFIX}{args.workspace}" if args.workspace else None
    )
    config = _mk_config(args, args.env, client_secret, scope_override=scope_override)
    authz = AltiumAuthClient(config).create_authorization_url(
        redirect_uri=args.redirect_uri, select_workspace=_select_workspace(args)
    )
    print("=== altium-auth authorize URL ===\n")
    print(f"redirect_uri : {args.redirect_uri or config.endpoints.redirect_uri}")
    print(f"scope         : {config.scopes}")
    print(f"state         : {authz.state}")
    print(f"code_verifier : {authz.code_verifier}")
    print(f"\nOpen this URL in a browser to sign in:\n{authz.url}")
    print(f"\nYour callback receives ?code=…&state={authz.state}. Then exchange it:")
    redirect = f" --redirect-uri {args.redirect_uri}" if args.redirect_uri else ""
    print(
        "  uv run python tools/signin_test.py --exchange-code <code> "
        f"--code-verifier {authz.code_verifier}{redirect} {args.client_id}"
    )


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    client_secret = os.environ.get("A365_CLIENT_SECRET")

    if args.authorize_url:
        _run_authorize_url(args, client_secret)
        return 0

    sign_in_config = _mk_config(args, args.env, client_secret)
    exchange_env = args.workspace_env or args.env
    exchange_config = _mk_config(args, exchange_env, client_secret)

    print("=== altium-auth Python sign-in E2E test ===\n")
    print(f"Client type   : {'confidential (HTTP Basic)' if client_secret else 'public (PKCE)'}")
    secure_desc = (
        "auto (from token host)"
        if args.secure is None
        else ("forced on" if args.secure else "forced off")
    )
    print(f"secure=1      : {secure_desc}")
    print(f"Scopes        : {sign_in_config.scopes}")
    if args.select_workspace and args.select_workspace != "none":
        print(f"selectWorkspace: {args.select_workspace} (login-into-workspace)")
    if args.code:
        redirect = args.redirect_uri or sign_in_config.endpoints.redirect_uri
        print(f"Mode          : exchange authorization code (redirect_uri={redirect})")
    else:
        print(f"Sign-in ({args.env}) : {sign_in_config.endpoints.authorize_endpoint}")
        print(f"ActionWait    : {sign_in_config.endpoints.action_wait_endpoint}")
    print(f"Token host    : {sign_in_config.endpoints.token_endpoint}")
    if args.workspace:
        print(f"Exchange ({exchange_env}): {exchange_config.endpoints.token_endpoint}")
        if _tier(args.env) != _tier(exchange_env):
            print(
                f"\n⚠️  sign-in env '{args.env}' and workspace-env '{exchange_env}' are "
                "different tiers.\n    The exchange will likely fail (invalid_token): the "
                "Commercial→Gov bridge only works within a tier (prod↔gov, dev↔dev-gov)."
            )

    try:
        # 1. Two-trip sign-in (global token → workspace token).
        tokens, token_config = _test_two_trip(args, sign_in_config, exchange_config)
        # 2. One-trip sign-in (direct workspace token). Skipped in --exchange-code mode:
        #    an authorization code can only be redeemed once (spent on test 1).
        if not args.code:
            _test_one_trip(args, client_secret, sign_in_config)
        # 3. Refresh if requested.
        if args.refresh:
            tokens = _test_refresh(tokens, token_config)
        # 4. Revocation if requested.
        if args.revoke:
            _test_revoke(tokens, token_config)
        print("\n✅ E2E test passed.\n")
        return 0
    except Exception as e:
        print(f"\n❌ E2E test failed: {e}\n", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
