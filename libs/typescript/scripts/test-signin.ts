/**
 * End-to-end sign-in verification against a live Altium environment.
 *
 * Drives the public (ActionWait) sign-in flow, and optionally the workspace
 * exchange and refresh, against Production, Gov Cloud, or Dev Gov. Confidential
 * clients are supported by supplying a secret (HTTP Basic).
 *
 * Usage:
 *   npm run test:e2e -- [options] <clientId>
 *
 * Options:
 *   --env <prod|gov|dev-gov>        Sign-in environment           (default: prod)
 *   --workspace-env <prod|gov|dev-gov>  Endpoint for the workspace exchange (default: --env).
 *                                   e.g. --env prod --workspace-env gov exercises the
 *                                   Commercial→Gov bridge (sign in Commercial, exchange on Gov).
 *   --secure / --no-secure          Force secure=1 on/off (default: auto from token endpoint)
 *   --scopes "<scopes>"             Space-delimited scopes        (default: "openid profile")
 *   --workspace <authId>            After sign-in, exchange for a workspace token
 *   --refresh                       After sign-in, exercise refreshToken (implies offline_access)
 *   --userinfo                      After sign-in, GET /connect/userinfo and print the response
 *   --revoke                        Revoke the (latest) refresh token, then prove it no longer works
 *
 * Confidential / custom-callback clients (that host their own redirect, not ActionWait):
 *   --authorize-url                 Print the authorize URL (+ state, code_verifier) and exit
 *   --redirect-uri <url>            Callback to embed in the authorize URL / code exchange
 *   --exchange-code <code>          Exchange an authorization code for tokens (from your callback)
 *   --code-verifier <verifier>      PKCE verifier from the --authorize-url step (for --exchange-code)
 *
 * Env vars:
 *   A365_CLIENT_SECRET              Confidential client secret → HTTP Basic auth (optional)
 *
 * Examples:
 *   npm run test:e2e -- my-client-id
 *   npm run test:e2e -- --env dev-gov my-gov-client-id            # verifies secure=1
 *   npm run test:e2e -- --workspace-env gov --workspace <govAuthId> my-client-id  # Commercial→Gov
 *   # Confidential redirect flow (browser sign-in happens between the two steps):
 *   npm run test:e2e -- --authorize-url --redirect-uri https://app.example.com/cb my-client
 *   A365_CLIENT_SECRET=… npm run test:e2e -- --exchange-code <code> --code-verifier <v> --redirect-uri https://app.example.com/cb my-client
 */

import {
  signIn,
  signIntoWorkspace,
  refreshToken,
  revokeRefreshToken,
  createAuthorizationUrl,
  exchangeCode,
  COMMERCIAL_CLOUD_ENDPOINTS,
  GOV_CLOUD_ENDPOINTS,
  type OAuthConfig,
} from "../src/index";

type Env = "prod" | "dev" | "gov" | "dev-gov";

interface CliArgs {
  clientId: string;
  env: Env;
  workspaceEnv?: Env; // endpoint for the workspace exchange (default: env)
  secure?: boolean; // undefined = let the library auto-detect from the endpoint
  scopes: string;
  workspace?: string;
  refresh: boolean;
  userinfo: boolean;
  revoke: boolean;
  authorizeUrl: boolean;
  code?: string;
  codeVerifier?: string;
  redirectUri?: string;
}

function parseEnv(value: string, flag: string): Env {
  if (value !== "prod" && value !== "dev" && value !== "gov" && value !== "dev-gov") {
    fail(`${flag} must be one of prod|dev|gov|dev-gov (got "${value}")`);
  }
  return value;
}

function parseArgs(argv: string[]): CliArgs {
  let clientId: string | undefined;
  let env: Env = "prod";
  let workspaceEnv: Env | undefined;
  let secure: boolean | undefined;
  let scopes = "openid profile";
  let workspace: string | undefined;
  let refresh = false;
  let userinfo = false;
  let revoke = false;
  let authorizeUrl = false;
  let code: string | undefined;
  let codeVerifier: string | undefined;
  let redirectUri: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--env": env = parseEnv(argv[++i], "--env"); break;
      case "--workspace-env": workspaceEnv = parseEnv(argv[++i], "--workspace-env"); break;
      case "--secure": secure = true; break;
      case "--no-secure": secure = false; break;
      case "--scopes": scopes = argv[++i]; break;
      case "--workspace": workspace = argv[++i]; break;
      case "--refresh": refresh = true; break;
      case "--userinfo": userinfo = true; break;
      case "--revoke": revoke = true; break;
      case "--authorize-url": authorizeUrl = true; break;
      case "--exchange-code": code = argv[++i]; break;
      case "--code-verifier": codeVerifier = argv[++i]; break;
      case "--redirect-uri": redirectUri = argv[++i]; break;
      default:
        if (a.startsWith("--")) fail(`Unknown option: ${a}`);
        else if (clientId) fail(`Unexpected argument: ${a}`);
        else clientId = a;
    }
  }

  if (!clientId) fail("Missing <clientId>.");
  // Refresh and revoke both need a refresh token, which requires offline_access.
  if ((refresh || revoke) && !scopes.split(/\s+/).includes("offline_access")) {
    scopes = `${scopes} offline_access`.trim();
  }
  // Leave `secure` undefined unless explicitly forced, so the library
  // auto-detects it from the token endpoint (Gov host → secure=1).
  return { clientId: clientId!, env, workspaceEnv, secure, scopes, workspace, refresh, userinfo, revoke, authorizeUrl, code, codeVerifier, redirectUri };
}

/** GET the userinfo endpoint (derived from the authorize endpoint) and print the response. */
async function printUserinfo(authEndpoint: string, accessToken: string): Promise<void> {
  const url = authEndpoint.replace(/\/connect\/authorize$/, "/connect/userinfo");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await res.text();
  console.log(`\nℹ️  userinfo (${res.status}) @ ${url}:\n${text}`);
}

function fail(message: string): never {
  console.error(`\n❌ ${message}\n`);
  console.error("Usage: npm run test:e2e -- [--env prod|gov|dev-gov] [--secure|--no-secure]");
  console.error("                          [--scopes \"...\"] [--workspace <authId>] [--refresh] <clientId>\n");
  process.exit(1);
}

function endpointsFor(env: Env) {
  if (env === "prod") return COMMERCIAL_CLOUD_ENDPOINTS;
  if (env === "dev") {
    return {
      authEndpoint: "https://auth.dev1.altium.com/connect/authorize",
      tokenEndpoint: "https://auth.dev1.altium.com/connect/token",
      actionWaitEndpoint: "https://actionwait.dev1.altium.com/await",
      redirectUri: "https://auth.dev1.altium.com/api/AuthComplete",
    };
  }
  if (env === "gov") return GOV_CLOUD_ENDPOINTS;
  // dev-gov: only authorize/token move to the dev-gov host. ActionWait and the
  // AuthComplete callback have no gov DNS — they use the DEV *commercial* hosts.
  const base = "https://auth.dev-365-gov.altium.com";
  return {
    authEndpoint: `${base}/connect/authorize`,
    tokenEndpoint: `${base}/connect/token`,
    actionWaitEndpoint: "https://actionwait.dev1.altium.com/await",
    redirectUri: "https://auth.dev1.altium.com/api/AuthComplete",
  };
}

/** Decode a JWT payload for human-readable output (no signature verification). */
function decodeJwt(jwt: string): unknown {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function printTokens(label: string, tokens: { access_token: string; expires_at?: number; token_type?: string; refresh_token?: string; scope?: string; id_token?: string }): void {
  console.log(`\n✅ ${label}\n`);
  console.log(`  access_token : ${tokens.access_token}`);
  const at = decodeJwt(tokens.access_token) as Record<string, unknown> | null;
  if (at) {
    // The access token is a JWT — surface the claims that vary Commercial vs Gov.
    console.log(`  ↳ iss        : ${at.iss}`);
    if ("secure" in at) console.log(`  ↳ secure     : ${at.secure}`);
  }
  console.log(`  token_type   : ${tokens.token_type}`);
  console.log(`  expires_at   : ${tokens.expires_at}`);
  console.log(`  scope        : ${tokens.scope}`);
  if (tokens.refresh_token) {
    console.log(`  refresh_token: ${tokens.refresh_token}`);
  }
  if (tokens.id_token) {
    const claims = decodeJwt(tokens.id_token);
    if (claims) console.log(`  id_token     : ${JSON.stringify(claims, null, 2).slice(0, 300)}...`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clientSecret = process.env.A365_CLIENT_SECRET;

  const mkConfig = (env: Env): OAuthConfig => ({
    clientId: args.clientId,
    scopes: args.scopes,
    ...endpointsFor(env),
    ...(clientSecret ? { clientSecret } : {}),
    ...(args.secure !== undefined ? { secure: args.secure } : {}),
  });

  const signInConfig = mkConfig(args.env);
  const exchangeEnv = args.workspaceEnv ?? args.env;
  const exchangeConfig = mkConfig(exchangeEnv);

  // Authorize-URL mode: print the URL to sign in with a custom callback, then exit.
  // Use this for confidential/custom-redirect clients that can't use ActionWait.
  if (args.authorizeUrl) {
    const authz = createAuthorizationUrl(signInConfig, { redirectUri: args.redirectUri });
    console.log("=== a365-auth authorize URL ===\n");
    console.log(`redirect_uri : ${args.redirectUri ?? signInConfig.redirectUri}`);
    console.log(`state         : ${authz.state}`);
    console.log(`code_verifier : ${authz.codeVerifier}`);
    console.log(`\nOpen this URL in a browser to sign in:\n${authz.url}`);
    console.log(`\nYour callback receives ?code=…&state=${authz.state}. Then exchange it:`);
    console.log(`  npm run test:e2e -- --exchange-code <code> --code-verifier ${authz.codeVerifier}` +
      `${args.redirectUri ? ` --redirect-uri ${args.redirectUri}` : ""} ${args.clientId}`);
    process.exit(0);
  }

  console.log("=== a365-auth sign-in E2E test ===\n");
  console.log(`Client type  : ${clientSecret ? "confidential (HTTP Basic)" : "public (PKCE)"}`);
  console.log(`secure=1      : ${args.secure === undefined ? "auto (from token endpoint)" : args.secure ? "forced on" : "forced off"}`);
  console.log(`Scopes        : ${args.scopes}`);
  console.log(`Token host (${args.env}) : ${signInConfig.tokenEndpoint}`);
  if (args.code) {
    console.log(`Mode          : exchange authorization code (redirect_uri=${args.redirectUri ?? signInConfig.redirectUri})`);
  } else {
    console.log(`Sign-in (${args.env}) : ${signInConfig.authEndpoint}`);
    console.log(`ActionWait    : ${signInConfig.actionWaitEndpoint}`);
  }
  if (args.workspace) {
    console.log(`Exchange (${exchangeEnv}): ${exchangeConfig.tokenEndpoint}`);
  }
  console.log("");

  try {
    // Obtain the global token via a manual authorization code (confidential/custom
    // redirect) or the interactive ActionWait sign-in.
    const tokens = args.code
      ? await exchangeCode(signInConfig, { code: args.code, codeVerifier: args.codeVerifier, redirectUri: args.redirectUri })
      : await signIn(signInConfig, { timeoutMs: 300_000 });
    printTokens("Global token:", tokens);

    if (args.userinfo) {
      await printUserinfo(signInConfig.authEndpoint ?? "", tokens.access_token);
    }

    let workspaceTokens = tokens;
    if (args.workspace) {
      workspaceTokens = await signIntoWorkspace(exchangeConfig, tokens.access_token, args.workspace);
      printTokens(`Workspace token (${args.workspace}):`, workspaceTokens);
    }

    // Refresh/revoke operate on the exchanged token (if any), else the global
    // token — always at the endpoint that issued it.
    const tokenConfig = args.workspace ? exchangeConfig : signInConfig;
    let currentRefresh = workspaceTokens.refresh_token ?? tokens.refresh_token;

    if (args.refresh) {
      if (!currentRefresh) {
        console.warn("\n⚠️  --refresh requested but no refresh_token was returned (is offline_access granted?).");
      } else {
        console.log("\nRefreshing token: " + currentRefresh);
        const refreshed = await refreshToken(tokenConfig, currentRefresh);
        printTokens("Refreshed token:", refreshed);
        currentRefresh = refreshed.refresh_token ?? currentRefresh;
      }
    }

    if (args.revoke) {
      if (!currentRefresh) {
        console.warn("\n⚠️  --revoke requested but no refresh_token is available (is offline_access granted?).");
      } else {
        // Uses the library's revokeRefreshToken (client auth from config).
        console.log("\nRevoking refresh token: " + currentRefresh);
        await revokeRefreshToken(tokenConfig, currentRefresh);
        console.log("🔒 revocation request sent (RFC 7009: 200 for known/unknown tokens).");
        // Prove it: a refresh with the revoked token should now fail.
        try {
          await refreshToken(tokenConfig, currentRefresh);
          console.error("⚠️  Refresh still succeeded after revocation — it may not have taken effect.");
        } catch (e) {
          console.log("✅ Refresh after revocation was rejected, as expected: " + (e as Error).message);
        }
      }
    }

    console.log("\n✅ E2E test passed.\n");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ E2E test failed:", (err as Error).message, "\n");
    process.exit(1);
  }
}

main();
