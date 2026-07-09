// Altium.Auth — .NET client for Altium 365 authentication. Validates spec/SPEC.md
// by passing the shared conformance vectors. Dependency-free by design: this is a
// token-acquisition client, so it needs no JWT/JWKS validation stack; the small
// OAuth surface is hand-rolled and pinned by the conformance vectors.
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Altium.Auth;

/// <summary>A prepared authorization request (mirrors the TS AuthorizationRequest).</summary>
public sealed record AuthorizationRequest(string Url, string State, string CodeVerifier);

/// <summary>Token endpoint response (subset; see spec/schemas/token-response.schema.json).</summary>
public sealed class TokenSet
{
    [JsonPropertyName("access_token")] public string AccessToken { get; set; } = "";
    [JsonPropertyName("token_type")] public string? TokenType { get; set; }
    [JsonPropertyName("expires_in")] public int? ExpiresIn { get; set; }
    [JsonPropertyName("expires_at")] public long? ExpiresAt { get; set; }
    [JsonPropertyName("refresh_token")] public string? RefreshToken { get; set; }
    [JsonPropertyName("id_token")] public string? IdToken { get; set; }
    [JsonPropertyName("scope")] public string? Scope { get; set; }
}

/// <summary>
/// Whether the authorize step should let the user pick a workspace, so the code
/// exchange returns a workspace-scoped token directly (SPEC §3.1). Emitted as the
/// <c>selectWorkspace</c> parameter on <c>/connect/authorize</c>.
/// </summary>
public enum WorkspaceSelection
{
    /// <summary>Default — no workspace selection; the parameter is omitted.</summary>
    None,

    /// <summary>Workspace selection is mandatory (<c>selectWorkspace=strict</c>).</summary>
    Strict,

    /// <summary>Workspace selection is offered but may be skipped (<c>selectWorkspace=optional</c>).</summary>
    Optional,
}

public interface IAltiumAuthClient
{
    AuthorizationRequest CreateAuthorizationUrl(string? redirectUri = null, string? state = null, string? codeVerifier = null, WorkspaceSelection selectWorkspace = WorkspaceSelection.None);
    Task<TokenSet> ExchangeCodeAsync(string code, string? codeVerifier = null, string? redirectUri = null, CancellationToken ct = default);
    Task<TokenSet> SignIntoWorkspaceAsync(string baseAccessToken, string workspaceAuthId, CancellationToken ct = default);
    Task<TokenSet> RefreshTokenAsync(string refreshToken, CancellationToken ct = default);
    Task<TokenSet> SignInAsync(CancellationToken ct = default);
    Task<TokenSet> SignInAsync(WorkspaceSelection selectWorkspace, CancellationToken ct = default);
    Task RevokeRefreshTokenAsync(string refreshToken, CancellationToken ct = default);
}

public sealed class AltiumAuthClient(HttpClient http, AltiumAuthOptions options) : IAltiumAuthClient
{
    private static string Truncate(string s) => s.Length > 500 ? s[..500] : s;

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');

    /// <summary>Apply client auth + the Gov secure=1 rule to a token-endpoint form (SPEC §5.4).</summary>
    private HttpRequestMessage BuildTokenRequest(string endpoint, Dictionary<string, string> form)
    {
        if (options.UseSecure) form["secure"] = "1";
        var req = new HttpRequestMessage(HttpMethod.Post, endpoint);
        if (options.IsConfidential)
        {
            var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{options.ClientId}:{options.ClientSecret}"));
            req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
        }
        else
        {
            form["client_id"] = options.ClientId;
        }
        req.Content = new FormUrlEncodedContent(form);
        return req;
    }

    private async Task<TokenSet> TokenRequestAsync(Dictionary<string, string> form, CancellationToken ct)
    {
        var res = await http.SendAsync(BuildTokenRequest(options.Endpoints.TokenEndpoint, form), ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        var status = (int)res.StatusCode;

        if (status is not (200 or 201))
        {
            string err = "", desc = "";
            try
            {
                var e = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(body);
                if (e is not null)
                {
                    if (e.TryGetValue("error", out var ev) && ev.ValueKind == JsonValueKind.String) err = ev.GetString()!;
                    if (e.TryGetValue("error_description", out var dv) && dv.ValueKind == JsonValueKind.String) desc = dv.GetString()!;
                }
            }
            catch { /* non-JSON error body */ }
            var suffix = desc.Length > 0 ? $" — {desc}" : "";
            throw new InvalidOperationException($"Token endpoint {status} {err}{suffix} (body: {Truncate(body)})");
        }

        TokenSet? tok;
        try { tok = JsonSerializer.Deserialize<TokenSet>(body); }
        catch { throw new InvalidOperationException($"Token endpoint returned non-JSON body: {Truncate(body)}"); }
        if (tok is null) throw new InvalidOperationException($"Token endpoint returned non-JSON body: {Truncate(body)}");

        if (tok.ExpiresIn is int ein && tok.ExpiresAt is null)
            tok.ExpiresAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + ein - 30; // 30s clock-skew buffer
        return tok;
    }

    public AuthorizationRequest CreateAuthorizationUrl(string? redirectUri = null, string? state = null, string? codeVerifier = null, WorkspaceSelection selectWorkspace = WorkspaceSelection.None)
    {
        var verifier = codeVerifier ?? Base64Url(RandomNumberGenerator.GetBytes(32));
        var challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var st = state ?? Guid.NewGuid().ToString();
        var redirect = redirectUri ?? options.Endpoints.RedirectUri;

        // NOTE: secure=1 is a token-endpoint parameter; it is NOT sent on /authorize (SPEC §5.4).
        var query = new Dictionary<string, string>
        {
            ["response_type"] = "code",
            ["client_id"] = options.ClientId,
            ["redirect_uri"] = redirect,
            ["scope"] = options.Scopes,
            ["code_challenge"] = challenge,
            ["code_challenge_method"] = "S256",
            ["state"] = st,
        };
        // selectWorkspace: only sent when explicitly requested — None omits it (SPEC §3.1).
        var workspaceParam = selectWorkspace switch
        {
            WorkspaceSelection.Strict => "strict",
            WorkspaceSelection.Optional => "optional",
            _ => null,
        };
        if (workspaceParam is not null)
            query["selectWorkspace"] = workspaceParam;
        var qs = string.Join("&", query.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
        return new AuthorizationRequest($"{options.Endpoints.AuthorizeEndpoint}?{qs}", st, verifier);
    }

    public Task<TokenSet> ExchangeCodeAsync(string code, string? codeVerifier = null, string? redirectUri = null, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(code))
            throw new ArgumentException("code is required — pass the authorization code from the redirect callback.");
        var form = new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = redirectUri ?? options.Endpoints.RedirectUri,
        };
        if (!string.IsNullOrEmpty(codeVerifier)) form["code_verifier"] = codeVerifier;
        return TokenRequestAsync(form, ct);
    }

    public Task<TokenSet> SignIntoWorkspaceAsync(string baseAccessToken, string workspaceAuthId, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(baseAccessToken))
            throw new ArgumentException("baseAccessToken is required — pass the access_token from a prior sign-in.");
        var form = new Dictionary<string, string>
        {
            ["grant_type"] = "urn:ietf:params:oauth:grant-type:token-exchange",
            ["subject_token"] = baseAccessToken,
            ["subject_token_type"] = "urn:ietf:params:oauth:token-type:access_token",
            ["scope"] = $"a365:workspace:{workspaceAuthId} {options.Scopes}".Trim(),
        };
        return TokenRequestAsync(form, ct);
    }

    public Task<TokenSet> RefreshTokenAsync(string refreshToken, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(refreshToken))
            throw new ArgumentException("refreshToken is required — pass the refresh_token from a prior TokenSet.");
        // No scope sent — the grant retains the token's original scope (SPEC §5.3).
        var form = new Dictionary<string, string> { ["grant_type"] = "refresh_token", ["refresh_token"] = refreshToken };
        return TokenRequestAsync(form, ct);
    }

    public Task<TokenSet> SignInAsync(CancellationToken ct = default) => SignInAsync(WorkspaceSelection.None, ct);

    public async Task<TokenSet> SignInAsync(WorkspaceSelection selectWorkspace, CancellationToken ct = default)
    {
        // The connection token doubles as the OAuth `state` and the ActionWait token (SPEC §4.1).
        var connectionToken = Guid.NewGuid().ToString();
        var authz = CreateAuthorizationUrl(state: connectionToken, selectWorkspace: selectWorkspace);

        // Start the long-poll BEFORE opening the browser so a fast callback can't race (SPEC §4.4).
        var pollTask = PollActionWaitAsync(connectionToken, ct);
        options.OpenBrowser?.Invoke(authz.Url);
        var (code, state) = await pollTask;
        if (state != connectionToken)
            throw new InvalidOperationException("State mismatch during sign-in (possible CSRF attack).");

        return await ExchangeCodeAsync(code, authz.CodeVerifier, options.Endpoints.RedirectUri, ct);
    }

    private async Task<(string Code, string State)> PollActionWaitAsync(string token, CancellationToken ct)
    {
        const int maxRetries = 10_000;
        for (var i = 0; i < maxRetries; i++)
        {
            var req = new HttpRequestMessage(HttpMethod.Post, options.Endpoints.ActionWaitEndpoint)
            {
                Content = new StringContent(JsonSerializer.Serialize(new { token }), Encoding.UTF8, "application/json"),
            };
            var res = await http.SendAsync(req, ct);
            var status = (int)res.StatusCode;

            if (status == 408) continue;                                  // normal reconnect
            if (status == 410) throw new InvalidOperationException("Sign-in cancelled.");

            var body = await res.Content.ReadAsStringAsync(ct);
            if (status == 200)
            {
                JsonElement data;
                try { data = JsonDocument.Parse(body).RootElement.GetProperty("data"); }
                catch { throw new InvalidOperationException($"ActionWait returned 200 but body is not JSON: {Truncate(body)}"); }

                var code = data.TryGetProperty("code", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null;
                var state = data.TryGetProperty("state", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString() : null;
                if (string.IsNullOrEmpty(code)) throw new InvalidOperationException($"ActionWait returned 200 but body is missing data.code: {Truncate(body)}");
                if (string.IsNullOrEmpty(state)) throw new InvalidOperationException($"ActionWait returned 200 but body is missing data.state: {Truncate(body)}");
                return (code!, state!);
            }
            throw new InvalidOperationException($"ActionWait returned {status}: {Truncate(body)}");
        }
        throw new InvalidOperationException($"ActionWait retry count exceeded {maxRetries}.");
    }

    public async Task RevokeRefreshTokenAsync(string refreshToken, CancellationToken ct = default)
    {
        var url = options.Endpoints.TokenEndpoint.Replace("/connect/token", "/connect/revocation");
        var form = new Dictionary<string, string> { ["token"] = refreshToken, ["token_type_hint"] = "refresh_token" };
        var req = new HttpRequestMessage(HttpMethod.Post, url);
        if (options.IsConfidential)
        {
            var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{options.ClientId}:{options.ClientSecret}"));
            req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
        }
        else
        {
            form["client_id"] = options.ClientId;
        }
        req.Content = new FormUrlEncodedContent(form);
        await http.SendAsync(req, ct); // 200 with empty body (also 200 for unknown tokens)
    }
}
