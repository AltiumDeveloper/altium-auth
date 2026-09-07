#!/usr/bin/env python3
"""Live sign-in smoke test against a real Altium environment (manual E2E).

Mirrors libs/typescript/scripts/test-signin.ts and libs/dotnet/tools/SignInTest.
The client secret (confidential clients) is read from A365_CLIENT_SECRET so it
never appears in shell history or the process list.

Examples:
    uv run python tools/signin_test.py YOUR_CLIENT_ID
    uv run python tools/signin_test.py --env gov YOUR_GOV_CLIENT_ID
    uv run python tools/signin_test.py --env aes --aes-origin https://aes.server.example:9785 CID
    uv run python tools/signin_test.py --workspace <authId> --refresh --revoke YOUR_CLIENT_ID
"""

from __future__ import annotations

import argparse
import os
import sys

from altium_auth import (
    COMMERCIAL_CLOUD_ENDPOINTS,
    GOV_CLOUD_ENDPOINTS,
    AltiumAuthClient,
    AltiumAuthConfig,
    aes_endpoints,
)


def _endpoints(args: argparse.Namespace):
    if args.env == "gov":
        return GOV_CLOUD_ENDPOINTS
    if args.env == "aes":
        if not args.aes_origin:
            sys.exit("--aes-origin is required for --env aes")
        return aes_endpoints(args.aes_origin)
    return COMMERCIAL_CLOUD_ENDPOINTS


def main() -> int:
    p = argparse.ArgumentParser(description="Live Altium 365 sign-in test")
    p.add_argument("client_id")
    p.add_argument("--env", choices=["prod", "gov", "aes"], default="prod")
    p.add_argument("--aes-origin")
    p.add_argument("--scopes", default="openid profile offline_access")
    p.add_argument("--workspace", help="workspace authId to exchange the global token for")
    p.add_argument("--refresh", action="store_true", help="exercise a refresh after sign-in")
    p.add_argument("--revoke", action="store_true", help="revoke the refresh token at the end")
    args = p.parse_args()

    config = AltiumAuthConfig(
        client_id=args.client_id,
        scopes=args.scopes,
        client_secret=os.environ.get("A365_CLIENT_SECRET"),
        endpoints=_endpoints(args),
    )
    client = AltiumAuthClient(config)

    print(f"Signing in ({args.env}) as {args.client_id} ...")
    tokens = client.sign_in()
    print(f"  access_token: {tokens.access_token[:24]}... (expires_at={tokens.expires_at})")
    print(f"  refresh_token: {'present' if tokens.refresh_token else 'absent'}")

    if args.workspace:
        ws = client.sign_into_workspace(tokens.access_token, args.workspace)
        print(f"  workspace access_token: {ws.access_token[:24]}...")
        tokens = ws

    if args.refresh and tokens.refresh_token:
        refreshed = client.refresh_token(tokens.refresh_token)
        print(f"  refreshed access_token: {refreshed.access_token[:24]}...")
        tokens = refreshed

    if args.revoke and tokens.refresh_token:
        client.revoke_refresh_token(tokens.refresh_token)
        print("  refresh token revoked")

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
