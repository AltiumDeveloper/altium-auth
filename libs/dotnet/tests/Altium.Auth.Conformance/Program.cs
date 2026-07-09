// Conformance runner for the .NET SDK. Loads the shared, language-neutral vectors
// (spec/conformance/vectors.json) and asserts the .NET client produces the same
// outgoing requests / outcomes the spec describes — mirroring the TS runner
// (spec/conformance/vectors.conformance.test.ts). Zero external packages so it
// builds/runs offline.
//
//   dotnet run --project ... -- <path-to-vectors.json>
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using Altium.Auth;

var vectorsPath = args.Length > 0 ? args[0] : "vectors.json";
var root = JsonDocument.Parse(File.ReadAllText(vectorsPath)).RootElement;

int passed = 0, failed = 0, skipped = 0;
void Pass(string id) { passed++; Console.WriteLine($"  ✓ {id}"); }
void Fail(string id, string why) { failed++; Console.WriteLine($"  ✗ {id}: {why}"); }
void Skip(string id) { skipped++; Console.WriteLine($"  - {id} (skipped)"); }

Console.WriteLine("authorizeUrl:");
foreach (var v in root.GetProperty("authorizeUrl").EnumerateArray()) RunAuthorizeUrl(v);
Console.WriteLine("tokenRequest:");
foreach (var v in root.GetProperty("tokenRequest").EnumerateArray()) await RunTokenRequest(v);
Console.WriteLine("actionWait:");
foreach (var v in root.GetProperty("actionWait").EnumerateArray()) await RunActionWait(v);
Console.WriteLine("revocation:");
foreach (var v in root.GetProperty("revocation").EnumerateArray()) await RunRevocation(v);

Console.WriteLine($"\n{passed} passed, {failed} failed, {skipped} skipped");
return failed == 0 ? 0 : 1;

// ── runners ─────────────────────────────────────────────────────

void RunAuthorizeUrl(JsonElement v)
{
    var id = v.GetProperty("id").GetString()!;
    try
    {
        var options = BuildOptions(v.GetProperty("config"));
        var opt = v.GetProperty("options");
        var client = new AltiumAuthClient(new HttpClient(), options);
        var authz = client.CreateAuthorizationUrl(Opt(opt, "redirectUri"), Opt(opt, "state"), Opt(opt, "codeVerifier"), ParseWorkspaceSelection(Opt(opt, "selectWorkspace")));

        var u = new Uri(authz.Url);
        var q = ParseForm(u.Query.TrimStart('?'));
        var expect = v.GetProperty("expect");
        var origin = $"{u.Scheme}://{u.Authority}";
        if (origin != expect.GetProperty("origin").GetString()) { Fail(id, $"origin {origin}"); return; }
        if (u.AbsolutePath != expect.GetProperty("pathname").GetString()) { Fail(id, $"pathname {u.AbsolutePath}"); return; }
        if (expect.TryGetProperty("query", out var query))
            foreach (var p in query.EnumerateObject())
            {
                q.TryGetValue(p.Name, out var actual);
                if (!MatchString(actual, p.Value)) { Fail(id, $"query {p.Name}='{actual}' !~ {p.Value.GetString()}"); return; }
            }
        if (expect.TryGetProperty("queryAbsent", out var qa))
            foreach (var k in qa.EnumerateArray())
                if (q.ContainsKey(k.GetString()!)) { Fail(id, $"query '{k.GetString()}' should be absent"); return; }
        Pass(id);
    }
    catch (Exception ex) { Fail(id, "runner exception: " + ex.Message); }
}

async Task RunTokenRequest(JsonElement v)
{
    var id = v.GetProperty("id").GetString()!;
    try
    {
        var options = BuildOptions(v.GetProperty("config"));
        var mock = v.GetProperty("mockResponse");
        var (status, respBody) = MockBody(mock);
        var handler = new SeqHandler((_, _, _) => (status, respBody));
        var client = new AltiumAuthClient(new HttpClient(handler), options);
        var input = v.GetProperty("input");

        Exception? thrown = null;
        TokenSet? result = null;
        try
        {
            result = v.GetProperty("operation").GetString() switch
            {
                "exchangeCode" => await client.ExchangeCodeAsync(input.GetProperty("code").GetString()!, Opt(input, "codeVerifier"), Opt(input, "redirectUri")),
                "signIntoWorkspace" => await client.SignIntoWorkspaceAsync(input.GetProperty("baseAccessToken").GetString()!, input.GetProperty("workspaceAuthId").GetString()!),
                "refreshToken" => await client.RefreshTokenAsync(input.GetProperty("refreshToken").GetString()!),
                var op => throw new InvalidOperationException($"unknown operation {op}"),
            };
        }
        catch (Exception ex) { thrown = ex; }

        if (v.TryGetProperty("expectErrorContains", out var eErr))
        {
            if (thrown is null) { Fail(id, "expected an error, none thrown"); return; }
            if (!thrown.Message.Contains(eErr.GetString()!)) { Fail(id, $"error '{thrown.Message}' missing '{eErr.GetString()}'"); return; }
        }
        else
        {
            if (thrown is not null) { Fail(id, "unexpected error: " + thrown.Message); return; }
            if (v.TryGetProperty("expectResult", out var er))
                foreach (var p in er.EnumerateObject())
                    if (!CheckResult(result!, p.Name, p.Value, out var why)) { Fail(id, why); return; }
        }

        if (handler.Calls.Count == 0) { Fail(id, "no request captured"); return; }
        var (ok, reason) = CheckRequest(handler.Calls[0], v.GetProperty("expectRequest"), options);
        if (!ok) { Fail(id, reason); return; }
        Pass(id);
    }
    catch (Exception ex) { Fail(id, "runner exception: " + ex.Message); }
}

async Task RunActionWait(JsonElement v)
{
    var id = v.GetProperty("id").GetString()!;
    try
    {
        var polls = v.GetProperty("pollResponses").EnumerateArray().ToArray();
        var awaitIdx = 0;
        var handler = new SeqHandler((req, body, _) =>
        {
            if (req.RequestUri!.ToString().Contains("actionwait"))
            {
                var r = polls[Math.Min(awaitIdx, polls.Length - 1)];
                awaitIdx++;
                var (st, pbody) = MockBody(r);
                if (pbody.Contains("<stateEchoesToken>")) pbody = pbody.Replace("<stateEchoesToken>", ExtractToken(body));
                return (st, pbody);
            }
            return (200, JsonSerializer.Serialize(new { access_token = "AT", token_type = "Bearer" }));
        });
        var client = new AltiumAuthClient(new HttpClient(handler), new AltiumAuthOptions { ClientId = "c", Scopes = "openid profile" });

        Exception? thrown = null;
        TokenSet? tokens = null;
        try { tokens = await client.SignInAsync(); }
        catch (Exception ex) { thrown = ex; }

        var expect = v.GetProperty("expect");
        if (expect.GetProperty("outcome").GetString() == "code")
        {
            if (thrown is not null) { Fail(id, "unexpected error: " + thrown.Message); return; }
            if (tokens?.AccessToken != "AT") { Fail(id, "sign-in did not complete"); return; }
        }
        else
        {
            var ec = expect.GetProperty("errorContains").GetString()!;
            if (thrown is null) { Fail(id, "expected an error, none thrown"); return; }
            if (!thrown.Message.Contains(ec)) { Fail(id, $"error '{thrown.Message}' missing '{ec}'"); return; }
        }
        Pass(id);
    }
    catch (Exception ex) { Fail(id, "runner exception: " + ex.Message); }
}

async Task RunRevocation(JsonElement v)
{
    var id = v.GetProperty("id").GetString()!;
    if (!v.TryGetProperty("expectRequest", out _)) { Skip(id); return; } // behavioral-only reference
    try
    {
        var options = BuildOptions(v.GetProperty("config"));
        var (status, respBody) = MockBody(v.GetProperty("mockResponse"));
        var handler = new SeqHandler((_, _, _) => (status, respBody));
        var client = new AltiumAuthClient(new HttpClient(handler), options);
        await client.RevokeRefreshTokenAsync(v.GetProperty("input").GetProperty("refreshToken").GetString()!);

        if (handler.Calls.Count == 0) { Fail(id, "no request captured"); return; }
        var (ok, reason) = CheckRequest(handler.Calls[0], v.GetProperty("expectRequest"), options);
        if (!ok) { Fail(id, reason); return; }
        Pass(id);
    }
    catch (Exception ex) { Fail(id, "runner exception: " + ex.Message); }
}

// ── helpers ─────────────────────────────────────────────────────

(bool ok, string why) CheckRequest(Call call, JsonElement erq, AltiumAuthOptions options)
{
    if (erq.TryGetProperty("endpoint", out var ep) && call.Url != ep.GetString()) return (false, $"endpoint {call.Url} != {ep.GetString()}");
    if (erq.TryGetProperty("method", out var me) && call.Method != me.GetString()) return (false, $"method {call.Method} != {me.GetString()}");
    if (erq.TryGetProperty("authorization", out var au))
    {
        var a = au.GetString()!;
        if (a == "none" && call.Authorization is not null) return (false, "expected no Authorization header");
        if (a.StartsWith("basic("))
        {
            var expected = "Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes($"{options.ClientId}:{options.ClientSecret}"));
            if (call.Authorization != expected) return (false, $"auth '{call.Authorization}' != '{expected}'");
        }
    }
    var form = ParseForm(call.Body);
    if (erq.TryGetProperty("bodyParams", out var bp))
        foreach (var p in bp.EnumerateObject())
        {
            form.TryGetValue(p.Name, out var actual);
            if (!MatchString(actual, p.Value)) return (false, $"bodyParam {p.Name}='{actual}' !~ {p.Value.GetString()}");
        }
    if (erq.TryGetProperty("bodyParamsAbsent", out var ba))
        foreach (var k in ba.EnumerateArray())
            if (form.ContainsKey(k.GetString()!)) return (false, $"bodyParam '{k.GetString()}' should be absent");
    return (true, "");
}

bool CheckResult(TokenSet tok, string key, JsonElement matcher, out string why)
{
    why = "";
    var m = matcher.GetString() ?? "";
    if (key == "access_token")
    {
        if (!MatchString(tok.AccessToken, matcher)) { why = $"access_token '{tok.AccessToken}' !~ {m}"; return false; }
        return true;
    }
    if (key == "expires_at")
    {
        if (tok.ExpiresAt is null) { why = "expires_at missing"; return false; }
        if (m == "<any>") return true;
        if (m.StartsWith("epochWithin:"))
        {
            var parts = m.Split(':');
            long off = long.Parse(parts[1]), tol = long.Parse(parts[2]);
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            if (Math.Abs(tok.ExpiresAt.Value - (now + off)) > tol) { why = $"expires_at {tok.ExpiresAt} not within {tol}s of {now + off}"; return false; }
        }
    }
    return true;
}

bool MatchString(string? actual, JsonElement matcher)
{
    var m = matcher.GetString() ?? "";
    if (m == "<any>") return actual is not null;
    if (m.StartsWith("contains:")) return (actual ?? "").Contains(m["contains:".Length..]);
    return actual == m;
}

string? Opt(JsonElement e, string name) =>
    e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

// Map the language-neutral vector value to the idiomatic .NET enum.
WorkspaceSelection ParseWorkspaceSelection(string? v) => v switch
{
    "strict" => WorkspaceSelection.Strict,
    "optional" => WorkspaceSelection.Optional,
    _ => WorkspaceSelection.None,
};

(int status, string body) MockBody(JsonElement mock)
{
    var status = mock.GetProperty("status").GetInt32();
    var body = mock.TryGetProperty("json", out var j) ? j.GetRawText()
             : mock.TryGetProperty("text", out var t) ? (t.GetString() ?? "") : "";
    return (status, body);
}

string ExtractToken(string jsonBody)
{
    try { return JsonDocument.Parse(jsonBody).RootElement.GetProperty("token").GetString() ?? ""; }
    catch { return ""; }
}

Dictionary<string, string> ParseForm(string body)
{
    var d = new Dictionary<string, string>();
    if (string.IsNullOrEmpty(body)) return d;
    foreach (var pair in body.Split('&', StringSplitOptions.RemoveEmptyEntries))
    {
        var idx = pair.IndexOf('=');
        if (idx < 0) { d[Uri.UnescapeDataString(pair.Replace('+', ' '))] = ""; continue; }
        var k = Uri.UnescapeDataString(pair[..idx].Replace('+', ' '));
        var val = Uri.UnescapeDataString(pair[(idx + 1)..].Replace('+', ' '));
        d[k] = val;
    }
    return d;
}

AltiumAuthOptions BuildOptions(JsonElement c)
{
    var def = AltiumEndpoints.CommercialCloud;
    string Get(string k, string fallback) => c.TryGetProperty(k, out var e) && e.ValueKind == JsonValueKind.String ? e.GetString()! : fallback;
    var endpoints = new AltiumEndpoints(
        Get("authEndpoint", def.AuthorizeEndpoint),
        Get("tokenEndpoint", def.TokenEndpoint),
        Get("actionWaitEndpoint", def.ActionWaitEndpoint),
        Get("redirectUri", def.RedirectUri));
    return new AltiumAuthOptions
    {
        ClientId = c.GetProperty("clientId").GetString()!,
        Scopes = c.GetProperty("scopes").GetString()!,
        ClientSecret = c.TryGetProperty("clientSecret", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString() : null,
        Endpoints = endpoints,
    };
}

// ── stub transport ──────────────────────────────────────────────

sealed class Call
{
    public string Url = "";
    public string Method = "";
    public string? Authorization;
    public string Body = "";
}

sealed class SeqHandler(Func<HttpRequestMessage, string, int, (int status, string body)> reply) : HttpMessageHandler
{
    public readonly List<Call> Calls = new();
    private int _i;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
    {
        var body = req.Content is null ? "" : await req.Content.ReadAsStringAsync(ct);
        Calls.Add(new Call
        {
            Url = req.RequestUri!.ToString(),
            Method = req.Method.Method,
            Authorization = req.Headers.Authorization?.ToString(),
            Body = body,
        });
        var (status, respBody) = reply(req, body, _i++);
        return new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent(respBody, Encoding.UTF8) };
    }
}
