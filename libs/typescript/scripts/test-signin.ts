/**
 * End-to-end sign-in verification against a live Altium environment.
 *
 * Drives the public (ActionWait) sign-in flow, and optionally the workspace
 * exchange and refresh, against Production, GovCloud, or Dev Gov. Confidential
 * clients are supported by supplying a secret (HTTP Basic).
 *
 * Usage:
 *   npm run test:e2e -- [options] <clientId>
 *
 * Options:
 *   --env <prod|gov|dev-gov|aes>    Sign-in environment           (default: prod)
 *   --workspace-env <prod|gov|dev-gov>  Endpoint for the workspace exchange (default: --env).
 *                                   e.g. --env prod --workspace-env gov exercises the
 *                                   Commercial→Gov bridge (sign in Commercial, exchange on Gov).
 *                                   Not applicable to AES — an installation is a single
 *                                   environment, so it signs in and exchanges on itself.
 *   --aes-origin <origin>           AES server origin, e.g. https://aes.example.com:9785
 *                                   (required when --env is "aes")
 *   --secure / --no-secure          Force secure=1 on/off (default: auto from token endpoint)
 *   --scopes "<scopes>"             Space-delimited scopes        (default: "openid profile")
 *   --workspace <authId>            Workspace to obtain a token for. Exercises both routes: the
 *                                   two-trip exchange after a global sign-in, and the one-trip
 *                                   sign-in that requests a365:workspace:{authId} directly.
 *                                   On AES it can be omitted — the workspace scope is discovered
 *                                   from the installation's ClientScopes endpoint.
 *   --select-workspace <none|strict|optional>  Login-into-workspace mode at /authorize (default: none)
 *                                   (not applicable to AES — no workspace-selection prompt;
 *                                    request the workspace scope at sign-in instead)
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

import * as process from 'node:process';
import {
  signIn,
  signIntoWorkspace,
  refreshToken,
  revokeRefreshToken,
  createAuthorizationUrl,
  exchangeCode,
  COMMERCIAL_CLOUD_ENDPOINTS,
  GOV_CLOUD_ENDPOINTS,
  createAesEndpoints,
  getClientScopes,
  type OAuthConfig,
  type TokenSet,
} from "../src/index";

type Env = "prod" | "dev" | "gov" | "dev-gov" | "aes";

interface CliArgs {
  clientId: string;
  env: Env;
  workspaceEnv?: Env; // endpoint for the workspace exchange (default: env)
  aesOrigin?: string; // required when env is "aes"
  secure?: boolean; // undefined = let the library auto-detect from the endpoint
  scopes: string;
  workspace?: string;
  selectWorkspace?: "none" | "strict" | "optional";
  refresh: boolean;
  userinfo: boolean;
  revoke: boolean;
  authorizeUrl: boolean;
  code?: string;
  codeVerifier?: string;
  redirectUri?: string;
}

function parseEnv(value: string, flag: string): Env {
  if (
    value !== "prod" &&
    value !== "dev" &&
    value !== "gov" &&
    value !== "dev-gov" &&
    value !== "aes"
  ) {
    fail(`${flag} must be one of prod|dev|gov|dev-gov|aes (got "${value}")`);
  }
  return value;
}

function parseSelectWorkspace(value: string): "none" | "strict" | "optional" {
  if (value !== "none" && value !== "strict" && value !== "optional") {
    fail(`--select-workspace must be one of none|strict|optional (got "${value}")`);
  }
  return value;
}

function parseArgs(argv: string[]): CliArgs {
  let clientId: string | undefined;
  let env: Env = "prod";
  let workspaceEnv: Env | undefined;
  let aesOrigin: string | undefined;
  let secure: boolean | undefined;
  let scopes = "openid profile";
  let workspace: string | undefined;
  let selectWorkspace: "none" | "strict" | "optional" | undefined;
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
      case "--aes-origin": aesOrigin = argv[++i]; break;
      case "--secure": secure = true; break;
      case "--no-secure": secure = false; break;
      case "--scopes": scopes = argv[++i]; break;
      case "--workspace": workspace = argv[++i]; break;
      case "--select-workspace": selectWorkspace = parseSelectWorkspace(argv[++i]); break;
      case "--refresh": refresh = true; break;
      case "--userinfo": userinfo = true; break;
      case "--revoke": revoke = true; break;
      case "--authorize-url": authorizeUrl = true; break;
      case "--exchange-code": code = argv[++i]; break;
      case "--code-verifier": codeVerifier = argv[++i]; break;
      case "--redirect-uri": redirectUri = argv[++i]; break;
      default:
        if (a.startsWith("--")) { fail(`Unknown option: ${a}`); }
        else if (clientId) { fail(`Unexpected argument: ${a}`); }
        else { clientId = a; }
    }
  }

  if (!clientId) {
    fail("Missing <clientId>.");
  }
  if ((env === "aes") && !aesOrigin) {
    fail('--aes-origin is required when --env is "aes".');
  }
  // AES hosts a single workspace, so there is nothing to select and no prompt for it
  // (SPEC §6) — request the workspace scope at sign-in instead.
  if (selectWorkspace !== undefined && env === "aes") {
    fail("--select-workspace is not applicable to AES: no workspace-selection prompt (single workspace per installation).");
  }
  // Refresh and revoke both need a refresh token, which requires offline_access.
  if ((refresh || revoke) && !scopes.split(/\s+/).includes("offline_access")) {
    scopes = `${scopes} offline_access`.trim();
  }
  // Leave `secure` undefined unless explicitly forced, so the library
  // auto-detects it from the token endpoint (Gov host → secure=1).
  return { clientId: clientId!, env, workspaceEnv, aesOrigin, secure, scopes, workspace, selectWorkspace, refresh, userinfo, revoke, authorizeUrl, code, codeVerifier, redirectUri };
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

const WORKSPACE_SCOPE_PREFIX = "a365:workspace:";

/** The workspace ID requested by an `a365:workspace:{id}` scope, if the (space separated) scopes carry one. */
function workspaceScopeId(scopes?: string): string | undefined {
  return scopes
    ?.split(/\s+/)
    .find((scope) => scope.startsWith(WORKSPACE_SCOPE_PREFIX))
    ?.slice(WORKSPACE_SCOPE_PREFIX.length);
}

function endpointsFor(env: Env, aesOrigin?: string) {
  if (env === "prod") { return COMMERCIAL_CLOUD_ENDPOINTS; }
  if (env === "dev") {
    return {
      authEndpoint: "https://auth.dev1.altium.com/connect/authorize",
      tokenEndpoint: "https://auth.dev1.altium.com/connect/token",
      actionWaitEndpoint: "https://actionwait.dev1.altium.com/await",
      redirectUri: "https://auth.dev1.altium.com/api/AuthComplete",
    };
  }
  if (env === "gov") { return GOV_CLOUD_ENDPOINTS; }
  if (env === "aes") { return createAesEndpoints(aesOrigin!); }  // validated present in parseArgs
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

/** Environment tier: a token can only be exchanged within its own tier (prod↔gov, dev↔dev-gov). AES is its own tier. */
function tierOf(env: Env): string {
  if (env === "prod" || env === "gov") { return "prod"; }
  if (env === "aes") { return "aes"; }
  return "dev";
}

/** Decode a JWT payload for human-readable output (no signature verification). */
function decodeJwt(jwt: string): unknown {
  const parts = jwt.split(".");
  if (parts.length !== 3) { return null; }
  let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) { b64 += "="; }
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function announceTest(label: string) {
  console.log(`\n⏺️  Testing: ${label}`);
}

function printTokens(label: string, tokens: { access_token: string; expires_at?: number; token_type?: string; refresh_token?: string; scope?: string; id_token?: string }): void {
  console.log(`\n✅ ${label}\n`);
  console.log(`  access_token : ${tokens.access_token}`);
  const at = decodeJwt(tokens.access_token) as Record<string, unknown> | null;
  if (at) {
    // The access token is a JWT — surface the claims that vary Commercial vs Gov.
    console.log(`  ↳ iss        : ${at.iss}`);
    if ("secure" in at) { console.log(`  ↳ secure     : ${at.secure}`); }
  }
  console.log(`  token_type   : ${tokens.token_type}`);
  console.log(`  expires_at   : ${tokens.expires_at}`);
  console.log(`  scope        : ${tokens.scope}`);
  if (tokens.refresh_token) {
    console.log(`  refresh_token: ${tokens.refresh_token}`);
  }
  if (tokens.id_token) {
    const claims = decodeJwt(tokens.id_token);
    if (claims) { console.log(`  id_token     : ${JSON.stringify(claims, null, 2).slice(0, 300)}...`); }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clientSecret = process.env.A365_CLIENT_SECRET;

  const mkConfig = (env: Env): OAuthConfig => ({
    clientId: args.clientId,
    scopes: args.scopes,
    ...endpointsFor(env, args.aesOrigin),
    ...(clientSecret ? { clientSecret } : {}),
    ...(args.secure !== undefined ? { secure: args.secure } : {}),
  });

  const signInConfig = mkConfig(args.env);
  const exchangeEnv = args.workspaceEnv ?? args.env;
  const exchangeConfig = mkConfig(exchangeEnv);

  // Authorize-URL mode: print the URL to sign in with a custom callback, then exit.
  // Use this for confidential/custom-redirect clients that can't use ActionWait.
  if (args.authorizeUrl) {
    const authz = createAuthorizationUrl(signInConfig, { redirectUri: args.redirectUri, selectWorkspace: args.selectWorkspace });
    console.log("=== altium-auth authorize URL ===\n");
    console.log(`redirect_uri : ${args.redirectUri ?? signInConfig.redirectUri}`);
    console.log(`state         : ${authz.state}`);
    console.log(`code_verifier : ${authz.codeVerifier}`);
    console.log(`\nOpen this URL in a browser to sign in:\n${authz.url}`);
    console.log(`\nYour callback receives ?code=…&state=${authz.state}. Then exchange it:`);
    console.log(`  npm run test:e2e -- --exchange-code <code> --code-verifier ${authz.codeVerifier}` +
      `${args.redirectUri ? ` --redirect-uri ${args.redirectUri}` : ""} ${args.clientId}`);
    process.exit(0);
  }

  console.log("=== altium-auth sign-in E2E test ===\n");
  console.log(`Client type   : ${clientSecret ? "confidential (HTTP Basic)" : "public (PKCE)"}`);
  console.log(`secure=1      : ${args.secure === undefined ? "auto (from token endpoint)" : args.secure ? "forced on" : "forced off"}`);
  console.log(`Scopes        : ${signInConfig.scopes}`);

  if (args.selectWorkspace && args.selectWorkspace !== "none") {
    console.log(`selectWorkspace: ${args.selectWorkspace} (login-into-workspace)`);
  }
  console.log(`Token host    : ${signInConfig.tokenEndpoint}`);
  if (args.code) {
    console.log(`Mode          : exchange authorization code (redirect_uri=${args.redirectUri ?? signInConfig.redirectUri})`);
  } else {
    console.log(`Sign-in       : ${signInConfig.authEndpoint}`);
    console.log(`ActionWait    : ${signInConfig.actionWaitEndpoint}`);
  }
  if (args.workspace) {
    console.log(`Exchange (${exchangeEnv}): ${exchangeConfig.tokenEndpoint}`);
  }

  try {
    // 1. Test the two-trip sign-in (global token → workspace token).
    const { tokens, config: tokenConfig } = await testTwoTripSignIn(args, signInConfig, exchangeConfig);
    let currentTokens = tokens;
    // 2. Test the one-trip sign-in (direct workspace token). It requests the workspace scope at
    //    sign-in on args.env's host, so it only applies when the workspace is on the same tier —
    //    in bridge mode (e.g. --workspace-env gov) a cross-tier scope is denied (use the two-trip
    //    exchange above). It also needs its own browser round trip and a code can only be redeemed
    //    once, so it is skipped in --exchange-code mode (the code was spent on test 1).
    if (!args.code && tierOf(args.env) !== tierOf(exchangeEnv)) {
      console.log(`\n⏸️  Skipping one-trip sign-in: workspace is on the '${exchangeEnv}' tier, sign-in on '${args.env}'. A cross-tier workspace scope at /authorize is denied — use the two-trip exchange (above).`);
    } else if (!args.code) {
      const oneTripConfig = { ...signInConfig };
      if (args.workspace) {
        console.log(`Adding scope for workspace ${args.workspace} to test one-trip sign-in.`);
        oneTripConfig.scopes = `${oneTripConfig.scopes} ${WORKSPACE_SCOPE_PREFIX}${args.workspace}`;
      } else {
        // Discover the workspace scope (AES: one workspace per installation) and *add* it to the
        // configured scopes. Substituting the introspected list wholesale would drop offline_access
        // — auto-added by --refresh/--revoke — along with any custom --scopes.
        const workspaceScope = (await testScopeIntrospection(args, signInConfig))?.find((scope) =>
          scope.startsWith(WORKSPACE_SCOPE_PREFIX),
        );
        if (workspaceScope) { oneTripConfig.scopes = `${signInConfig.scopes} ${workspaceScope}`; }
      }
      await testOneTripSignIn(args, oneTripConfig);
    }
    // 3. Test refresh if requested.
    if (args.refresh) { currentTokens = await testRefresh(currentTokens, tokenConfig); }
    // 4. Test revocation if requested.
    if (args.revoke) { await testRevoke(currentTokens, tokenConfig); }

    console.log("\n✅ E2E test passed.\n");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ E2E test failed:", (err as Error).message, "\n");
    process.exit(1);
  }
}

type RefreshTokenSet = Pick<TokenSet, "refresh_token">;

async function testScopeIntrospection(args: CliArgs, signInConfig: OAuthConfig) {
  if (!signInConfig.scopeEndpoint) {
    console.log("\n⏸️  Skipping scope introspection (no endpoint configured).");
    return null;
  }

  announceTest("Client scope introspection");
  const scopes = await getClientScopes(signInConfig.scopeEndpoint, args.clientId);
  console.log(`\n✅ Client scopes for ${args.clientId} @ ${args.aesOrigin}: ${scopes.join(" ") || "(none returned)"}`);
  return scopes;
}

async function testTwoTripSignIn(args: CliArgs, signInConfig: OAuthConfig, exchangeConfig: OAuthConfig) {
  announceTest("Two-trip sign-in (global token → workspace token)");

  // Obtain the global token via a manual authorization code (confidential/custom
  // redirect) or the interactive ActionWait sign-in.
  const globalTokens = args.code
    ? await exchangeCode(signInConfig, {
        code: args.code,
        codeVerifier: args.codeVerifier,
        redirectUri: args.redirectUri,
      })
    : await signIn(signInConfig, { timeoutMs: 300_000, selectWorkspace: args.selectWorkspace });

  let workspaceTokens;
  printTokens("Global token:", globalTokens);

  if (args.userinfo) {
    await printUserinfo(signInConfig.authEndpoint ?? "", globalTokens.access_token);
  }

  if (args.workspace) {
    workspaceTokens = await signIntoWorkspace(exchangeConfig, globalTokens.access_token, args.workspace);
    printTokens(`Workspace token (${args.workspace}) [two-trip]:`, workspaceTokens);
    return { tokens: workspaceTokens, config: exchangeConfig, globalTokens, workspaceTokens };
  } else {
    console.log("\n⏸️  Skipping workspace token exchange (no --workspace provided).");
    return { tokens: globalTokens, config: signInConfig, globalTokens, workspaceTokens };
  }
}

async function testOneTripSignIn(args: CliArgs, signInConfig: OAuthConfig) {
  const requestedWorkspace = workspaceScopeId(signInConfig.scopes);
  if (!requestedWorkspace) {
    // This would exercise the same path as the global token in testTwoTripSignIn, so skip it to avoid duplicate output.
    console.log("\n⏸️  Skipping one-trip workspace sign-in (no workspace scope requested).");
    return null;
  }

  announceTest("One-trip sign-in (direct workspace token)");
  const tokens = args.code
    ? await exchangeCode(signInConfig, {
        code: args.code,
        codeVerifier: args.codeVerifier,
        redirectUri: args.redirectUri,
      })
    : await signIn(signInConfig, { timeoutMs: 300_000, selectWorkspace: args.selectWorkspace });

  printTokens(`Workspace Token (${requestedWorkspace}) [one-trip]:`, tokens);
  if (args.userinfo) {
    await printUserinfo(signInConfig.authEndpoint ?? "", tokens.access_token);
  }
  return { tokens, config: signInConfig };
}

async function testRefresh(currentTokens: TokenSet, tokenConfig: OAuthConfig) {
  // Refresh/revoke operate on the exchanged token (if any), else the global
  // token — always at the endpoint that issued it.
  const currentRefresh = currentTokens.refresh_token;
  if (!currentRefresh) {
    console.warn("\n⚠️  --refresh requested but no refresh_token was returned (is offline_access granted?).");
    return currentTokens;
  }

  announceTest("Refresh token");
  console.log("\nRefreshing token: " + currentRefresh);
  const refreshed = await refreshToken(tokenConfig, currentRefresh);
  printTokens("Refreshed token:", refreshed);
  return refreshed;
}

async function testRevoke({ refresh_token: currentRefresh }: RefreshTokenSet, tokenConfig: OAuthConfig) {
  if (!currentRefresh) {
    console.warn("\n⚠️  --revoke requested but no refresh_token is available (is offline_access granted?).");
    return;
  }

  // Uses the library's revokeRefreshToken (client auth from config).
  announceTest("Revoke token");
  console.log("\nRevoking token: " + currentRefresh);
  await revokeRefreshToken(tokenConfig, currentRefresh);
  console.log("\n🔒 revocation request sent (RFC 7009: 200 for known/unknown tokens).");
  // Prove it: a refresh with the revoked token should now fail. If it still works, the test
  // has failed — fail the run rather than printing a ❌ under a green summary.
  let refreshStillWorks = false;
  try {
    await refreshToken(tokenConfig, currentRefresh);
    refreshStillWorks = true;
  } catch (e) {
    console.log("\n✅ Refresh after revocation was rejected, as expected: " + (e as Error).message);
  }
  if (refreshStillWorks) {
    throw new Error("Refresh still succeeded after revocation — the revocation did not take effect.");
  }
}

main();
