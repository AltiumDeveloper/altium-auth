// Live E2E sign-in tool for the .NET port — the .NET analog of scripts/test-signin.ts.
// Runs the real flow (ActionWait sign-in, workspace exchange, refresh, revoke) against
// a live Altium environment. Requires network + a browser; not run in the sandbox.
//
//   dotnet run --project tools/SignInTest -- [options] <clientId>
//
// Options mirror the TS harness:
//   --env prod|dev|gov|dev-gov          Sign-in environment (default: prod)
//   --workspace-env prod|dev|gov|dev-gov  Endpoint for the workspace exchange (default: --env)
//   --secure | --no-secure              Force secure=1 on/off (default: auto from token host)
//   --scopes "<scopes>"                 Space-delimited scopes (default: "openid profile")
//   --workspace <authId>                Exchange for a workspace token after sign-in
//   --refresh                           Exercise refresh (implies offline_access)
//   --revoke                            Revoke the (latest) refresh token, then prove it fails
//   --userinfo                          GET /connect/userinfo and print the response
//   --authorize-url                     Print the authorize URL (+ state, verifier) and exit
//   --exchange-code <code>              Exchange an authorization code (confidential/custom redirect)
//   --code-verifier <v>                 PKCE verifier for --exchange-code
//   --redirect-uri <url>                Custom callback for authorize-url / exchange-code
//
// Env: A365_CLIENT_SECRET  → confidential client (HTTP Basic).
using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text.Json;
using Altium.Auth;

string? clientId = null, env = "prod", workspaceEnv = null, scopes = "openid profile";
string? workspace = null, code = null, codeVerifier = null, redirectUri = null;
bool refresh = false, revoke = false, userinfo = false, authorizeUrl = false;
bool? secure = null;

for (var i = 0; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--env": env = Env(args[++i]); break;
        case "--workspace-env": workspaceEnv = Env(args[++i]); break;
        case "--secure": secure = true; break;
        case "--no-secure": secure = false; break;
        case "--scopes": scopes = args[++i]; break;
        case "--workspace": workspace = args[++i]; break;
        case "--refresh": refresh = true; break;
        case "--revoke": revoke = true; break;
        case "--userinfo": userinfo = true; break;
        case "--authorize-url": authorizeUrl = true; break;
        case "--exchange-code": code = args[++i]; break;
        case "--code-verifier": codeVerifier = args[++i]; break;
        case "--redirect-uri": redirectUri = args[++i]; break;
        default:
            if (args[i].StartsWith("--")) Fail($"unknown option {args[i]}");
            else if (clientId is not null) Fail($"unexpected argument {args[i]}");
            else clientId = args[i];
            break;
    }
}
if (clientId is null) Fail("missing <clientId>");
if ((refresh || revoke) && !scopes!.Split(' ').Contains("offline_access")) scopes += " offline_access";

var clientSecret = Environment.GetEnvironmentVariable("A365_CLIENT_SECRET");
var http = new HttpClient();

AltiumAuthOptions MkOptions(string e) => new()
{
    ClientId = clientId!,
    Scopes = scopes!,
    Endpoints = EndpointsFor(e),
    ClientSecret = clientSecret,
    Secure = secure,
    OpenBrowser = OpenBrowser,
};

var signInOptions = MkOptions(env!);
var exchangeOptions = MkOptions(workspaceEnv ?? env!);

// Authorize-URL mode: print and exit (for confidential/custom-callback clients).
if (authorizeUrl)
{
    var authz = new AltiumAuthClient(http, signInOptions).CreateAuthorizationUrl(redirectUri);
    Console.WriteLine("=== authorize URL ===\n");
    Console.WriteLine($"redirect_uri : {redirectUri ?? signInOptions.Endpoints.RedirectUri}");
    Console.WriteLine($"state         : {authz.State}");
    Console.WriteLine($"code_verifier : {authz.CodeVerifier}");
    Console.WriteLine($"\nOpen in a browser to sign in:\n{authz.Url}");
    return 0;
}

Console.WriteLine("=== a365-auth .NET sign-in E2E ===\n");
Console.WriteLine($"Client type  : {(clientSecret is null ? "public (PKCE)" : "confidential (HTTP Basic)")}");
Console.WriteLine($"secure=1      : {(secure is null ? "auto (from token host)" : secure.Value ? "forced on" : "forced off")}");
Console.WriteLine($"Scopes        : {scopes}");
Console.WriteLine($"Sign-in ({env}) : {(code is null ? signInOptions.Endpoints.AuthorizeEndpoint : "exchange authorization code")}");
Console.WriteLine($"Token host    : {signInOptions.Endpoints.TokenEndpoint}");
if (workspace is not null) Console.WriteLine($"Exchange ({workspaceEnv ?? env}): {exchangeOptions.Endpoints.TokenEndpoint}");
if (workspace is not null && Tier(env!) != Tier(workspaceEnv ?? env!))
    Console.WriteLine($"\n⚠️  sign-in env '{env}' and workspace-env '{workspaceEnv}' are different environment tiers.\n" +
        "    The token exchange will likely fail (invalid_token): the Commercial→Gov bridge works\n" +
        "    within a tier (prod↔gov, dev↔dev-gov), because the token's issuer must be trusted by the endpoint.");
Console.WriteLine();

try
{
    using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(5));
    var signInClient = new AltiumAuthClient(http, signInOptions);
    var tokens = code is not null
        ? await signInClient.ExchangeCodeAsync(code, codeVerifier, redirectUri, cts.Token)
        : await signInClient.SignInAsync(cts.Token);
    PrintTokens("Global token:", tokens);

    if (userinfo) await PrintUserinfo(signInOptions, tokens.AccessToken);

    var exchangeClient = new AltiumAuthClient(http, exchangeOptions);
    var workspaceTokens = tokens;
    if (workspace is not null)
    {
        workspaceTokens = await exchangeClient.SignIntoWorkspaceAsync(tokens.AccessToken, workspace, cts.Token);
        PrintTokens($"Workspace token ({workspace}):", workspaceTokens);
    }

    var tokenClient = workspace is not null ? exchangeClient : signInClient;
    var currentRefresh = workspaceTokens.RefreshToken ?? tokens.RefreshToken;

    if (refresh)
    {
        if (currentRefresh is null) Console.WriteLine("\n⚠️  --refresh: no refresh_token returned (is offline_access granted?).");
        else
        {
            Console.WriteLine($"\nRefreshing token: {currentRefresh}");
            var refreshed = await tokenClient.RefreshTokenAsync(currentRefresh, cts.Token);
            PrintTokens("Refreshed token:", refreshed);
            currentRefresh = refreshed.RefreshToken ?? currentRefresh;
        }
    }

    if (revoke)
    {
        if (currentRefresh is null) Console.WriteLine("\n⚠️  --revoke: no refresh_token available.");
        else
        {
            await tokenClient.RevokeRefreshTokenAsync(currentRefresh, cts.Token);
            Console.WriteLine("\n🔒 revoked refresh token; verifying a refresh now fails...");
            try
            {
                await tokenClient.RefreshTokenAsync(currentRefresh, cts.Token);
                Console.WriteLine("⚠️  refresh still succeeded — revocation may not have taken effect.");
            }
            catch (Exception ex) { Console.WriteLine($"✅ refresh after revocation rejected, as expected: {ex.Message}"); }
        }
    }

    Console.WriteLine("\n✅ E2E completed.\n");
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine($"\n❌ E2E failed: {ex.Message}\n");
    return 1;
}

// ── helpers ─────────────────────────────────────────────────────

static string Env(string v) =>
    v is "prod" or "dev" or "gov" or "dev-gov" ? v : FailReturn($"--env must be prod|dev|gov|dev-gov (got \"{v}\")");

// Environment tier: a token can only be exchanged within its own tier (prod↔gov, dev↔dev-gov).
static string Tier(string env) => env is "prod" or "gov" ? "prod" : "dev";

static AltiumEndpoints EndpointsFor(string env) => env switch
{
    "prod" => AltiumEndpoints.CommercialCloud,
    "gov" => AltiumEndpoints.GovCloud,
    // dev / dev-gov: authorize+token on the dev host; ActionWait + AuthComplete on dev Commercial.
    "dev" => new AltiumEndpoints(
        "https://auth.dev1.altium.com/connect/authorize",
        "https://auth.dev1.altium.com/connect/token",
        "https://actionwait.dev1.altium.com/await",
        "https://auth.dev1.altium.com/api/AuthComplete"),
    "dev-gov" => new AltiumEndpoints(
        "https://auth.dev-365-gov.altium.com/connect/authorize",
        "https://auth.dev-365-gov.altium.com/connect/token",
        "https://actionwait.dev1.altium.com/await",
        "https://auth.dev1.altium.com/api/AuthComplete"),
    _ => throw new InvalidOperationException($"unknown env {env}"),
};

static void OpenBrowser(string url)
{
    try
    {
        if (OperatingSystem.IsWindows()) Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        else if (OperatingSystem.IsMacOS()) Process.Start("open", url);
        else Process.Start("xdg-open", url);
    }
    catch { /* fall through to the printed URL */ }
    Console.WriteLine($"Open the following URL in your browser to sign in:\n{url}\n");
}

static void PrintTokens(string label, TokenSet t)
{
    Console.WriteLine($"\n✅ {label}\n");
    Console.WriteLine($"  access_token : {t.AccessToken}");
    var claims = DecodeJwt(t.AccessToken);
    if (claims is { } c)
    {
        Console.WriteLine($"  ↳ iss        : {(c.TryGetProperty("iss", out var iss) ? iss.ToString() : "?")}");
        if (c.TryGetProperty("secure", out var sec)) Console.WriteLine($"  ↳ secure     : {sec}");
    }
    Console.WriteLine($"  token_type   : {t.TokenType}");
    Console.WriteLine($"  expires_at   : {t.ExpiresAt}");
    Console.WriteLine($"  scope        : {t.Scope}");
    if (!string.IsNullOrEmpty(t.RefreshToken)) Console.WriteLine($"  refresh_token: {t.RefreshToken}");
    if (!string.IsNullOrEmpty(t.IdToken) && DecodeJwt(t.IdToken) is { } idc)
    {
        var s = JsonSerializer.Serialize(idc, new JsonSerializerOptions { WriteIndented = true });
        Console.WriteLine($"  id_token     : {(s.Length > 300 ? s[..300] + "..." : s)}");
    }
}

async Task PrintUserinfo(AltiumAuthOptions options, string accessToken)
{
    var url = options.Endpoints.AuthorizeEndpoint.Replace("/connect/authorize", "/connect/userinfo");
    using var req = new HttpRequestMessage(HttpMethod.Get, url);
    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
    var res = await http.SendAsync(req);
    Console.WriteLine($"\nℹ️  userinfo ({(int)res.StatusCode}) @ {url}:\n{await res.Content.ReadAsStringAsync()}");
}

static JsonElement? DecodeJwt(string jwt)
{
    var parts = jwt.Split('.');
    if (parts.Length != 3) return null;
    var payload = parts[1].Replace('-', '+').Replace('_', '/');
    payload += (payload.Length % 4) switch { 2 => "==", 3 => "=", _ => "" };
    try
    {
        using var doc = JsonDocument.Parse(Convert.FromBase64String(payload));
        return doc.RootElement.Clone();
    }
    catch { return null; }
}

static void Fail(string message)
{
    Console.Error.WriteLine($"\n❌ {message}\n");
    Console.Error.WriteLine("Usage: dotnet run --project tools/SignInTest -- [options] <clientId>");
    Environment.Exit(1);
}

static string FailReturn(string message) { Fail(message); return ""; }
