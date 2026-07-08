// xUnit conformance harness — runs the shared, language-neutral vectors
// (spec/conformance/vectors.json) against the Altium.Auth client and asserts the
// same outgoing requests / outcomes as the TS runner. This is the CI-grade version
// of the offline console runner in ../Altium.Auth.Conformance.
//
//   dotnet test ports/dotnet/tests/Altium.Auth.Tests
using System.Net;
using System.Text;
using System.Text.Json;
using Altium.Auth;
using Xunit;

namespace Altium.Auth.Tests;

public class ConformanceTests
{
    private static JsonElement Vectors =>
        JsonDocument.Parse(File.ReadAllText("vectors.json")).RootElement;

    private static IEnumerable<object[]> Category(string name, Func<JsonElement, bool>? filter = null)
    {
        foreach (var v in Vectors.GetProperty(name).EnumerateArray())
            if (filter is null || filter(v))
                yield return [v.GetProperty("id").GetString()!, v.GetRawText()];
    }

    public static IEnumerable<object[]> AuthorizeUrlVectors() => Category("authorizeUrl");
    public static IEnumerable<object[]> TokenRequestVectors() => Category("tokenRequest");
    public static IEnumerable<object[]> ActionWaitVectors() => Category("actionWait");
    public static IEnumerable<object[]> RevocationVectors() => Category("revocation", v => v.TryGetProperty("expectRequest", out _));

    [Theory]
    [MemberData(nameof(AuthorizeUrlVectors))]
    public void AuthorizeUrl(string id, string json)
    {
        _ = id;
        var v = JsonDocument.Parse(json).RootElement;
        var sut = new AltiumAuthClient(new HttpClient(), BuildOptions(v.GetProperty("config")));
        var opt = v.GetProperty("options");
        var authz = sut.CreateAuthorizationUrl(Opt(opt, "redirectUri"), Opt(opt, "state"), Opt(opt, "codeVerifier"), Opt(opt, "selectWorkspace"));

        var u = new Uri(authz.Url);
        var q = ParseForm(u.Query.TrimStart('?'));
        var expect = v.GetProperty("expect");
        Assert.Equal(expect.GetProperty("origin").GetString(), $"{u.Scheme}://{u.Authority}");
        Assert.Equal(expect.GetProperty("pathname").GetString(), u.AbsolutePath);
        if (expect.TryGetProperty("query", out var query))
            foreach (var p in query.EnumerateObject())
                Assert.True(MatchString(q.GetValueOrDefault(p.Name), p.Value), $"query {p.Name}");
        if (expect.TryGetProperty("queryAbsent", out var qa))
            foreach (var k in qa.EnumerateArray())
                Assert.False(q.ContainsKey(k.GetString()!), $"query {k.GetString()} should be absent");
    }

    [Theory]
    [MemberData(nameof(TokenRequestVectors))]
    public async Task TokenRequest(string id, string json)
    {
        _ = id;
        var v = JsonDocument.Parse(json).RootElement;
        var options = BuildOptions(v.GetProperty("config"));
        var (status, body) = MockBody(v.GetProperty("mockResponse"));
        var handler = new SeqHandler((_, _, _) => (status, body));
        var sut = new AltiumAuthClient(new HttpClient(handler), options);
        var input = v.GetProperty("input");

        async Task<TokenSet> Run() => v.GetProperty("operation").GetString() switch
        {
            "exchangeCode" => await sut.ExchangeCodeAsync(input.GetProperty("code").GetString()!, Opt(input, "codeVerifier"), Opt(input, "redirectUri")),
            "signIntoWorkspace" => await sut.SignIntoWorkspaceAsync(input.GetProperty("baseAccessToken").GetString()!, input.GetProperty("workspaceAuthId").GetString()!),
            "refreshToken" => await sut.RefreshTokenAsync(input.GetProperty("refreshToken").GetString()!),
            var op => throw new InvalidOperationException($"unknown operation {op}"),
        };

        if (v.TryGetProperty("expectErrorContains", out var eErr))
        {
            var ex = await Assert.ThrowsAnyAsync<Exception>(Run);
            Assert.Contains(eErr.GetString()!, ex.Message);
        }
        else
        {
            var result = await Run();
            if (v.TryGetProperty("expectResult", out var er))
                foreach (var p in er.EnumerateObject())
                    AssertResult(result, p.Name, p.Value);
        }

        Assert.NotEmpty(handler.Calls);
        CheckRequest(handler.Calls[0], v.GetProperty("expectRequest"), options);
    }

    [Theory]
    [MemberData(nameof(ActionWaitVectors))]
    public async Task ActionWait(string id, string json)
    {
        _ = id;
        var v = JsonDocument.Parse(json).RootElement;
        var polls = v.GetProperty("pollResponses").EnumerateArray().ToArray();
        var awaitIdx = 0;
        var handler = new SeqHandler((req, reqBody, _) =>
        {
            if (req.RequestUri!.ToString().Contains("actionwait"))
            {
                var (st, pbody) = MockBody(polls[Math.Min(awaitIdx, polls.Length - 1)]);
                awaitIdx++;
                if (pbody.Contains("<stateEchoesToken>"))
                    pbody = pbody.Replace("<stateEchoesToken>", JsonDocument.Parse(reqBody).RootElement.GetProperty("token").GetString());
                return (st, pbody);
            }
            return (200, JsonSerializer.Serialize(new { access_token = "AT", token_type = "Bearer" }));
        });
        var sut = new AltiumAuthClient(new HttpClient(handler), new AltiumAuthOptions { ClientId = "c", Scopes = "openid profile" });

        var expect = v.GetProperty("expect");
        if (expect.GetProperty("outcome").GetString() == "code")
        {
            var tokens = await sut.SignInAsync();
            Assert.Equal("AT", tokens.AccessToken);
        }
        else
        {
            var ex = await Assert.ThrowsAnyAsync<Exception>(() => sut.SignInAsync());
            Assert.Contains(expect.GetProperty("errorContains").GetString()!, ex.Message);
        }
    }

    [Theory]
    [MemberData(nameof(RevocationVectors))]
    public async Task Revocation(string id, string json)
    {
        _ = id;
        var v = JsonDocument.Parse(json).RootElement;
        var options = BuildOptions(v.GetProperty("config"));
        var (status, body) = MockBody(v.GetProperty("mockResponse"));
        var handler = new SeqHandler((_, _, _) => (status, body));
        var sut = new AltiumAuthClient(new HttpClient(handler), options);

        await sut.RevokeRefreshTokenAsync(v.GetProperty("input").GetProperty("refreshToken").GetString()!);
        Assert.NotEmpty(handler.Calls);
        CheckRequest(handler.Calls[0], v.GetProperty("expectRequest"), options);
    }

    // ── assertions & helpers ────────────────────────────────────

    private static void CheckRequest(Call call, JsonElement erq, AltiumAuthOptions options)
    {
        if (erq.TryGetProperty("endpoint", out var ep)) Assert.Equal(ep.GetString(), call.Url);
        if (erq.TryGetProperty("method", out var me)) Assert.Equal(me.GetString(), call.Method);
        if (erq.TryGetProperty("authorization", out var au))
        {
            var a = au.GetString()!;
            if (a == "none") Assert.Null(call.Authorization);
            else if (a.StartsWith("basic("))
                Assert.Equal("Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes($"{options.ClientId}:{options.ClientSecret}")), call.Authorization);
        }
        var form = ParseForm(call.Body);
        if (erq.TryGetProperty("bodyParams", out var bp))
            foreach (var p in bp.EnumerateObject())
                Assert.True(MatchString(form.GetValueOrDefault(p.Name), p.Value), $"bodyParam {p.Name}='{form.GetValueOrDefault(p.Name)}'");
        if (erq.TryGetProperty("bodyParamsAbsent", out var ba))
            foreach (var k in ba.EnumerateArray())
                Assert.False(form.ContainsKey(k.GetString()!), $"bodyParam {k.GetString()} should be absent");
    }

    private static void AssertResult(TokenSet tok, string key, JsonElement matcher)
    {
        var m = matcher.GetString() ?? "";
        if (key == "access_token") { Assert.True(MatchString(tok.AccessToken, matcher)); return; }
        if (key == "expires_at")
        {
            Assert.NotNull(tok.ExpiresAt);
            if (m.StartsWith("epochWithin:"))
            {
                var parts = m.Split(':');
                long off = long.Parse(parts[1]), tol = long.Parse(parts[2]);
                Assert.True(Math.Abs(tok.ExpiresAt!.Value - (DateTimeOffset.UtcNow.ToUnixTimeSeconds() + off)) <= tol);
            }
        }
    }

    private static bool MatchString(string? actual, JsonElement matcher)
    {
        var m = matcher.GetString() ?? "";
        if (m == "<any>") return actual is not null;
        if (m.StartsWith("contains:")) return (actual ?? "").Contains(m["contains:".Length..]);
        return actual == m;
    }

    private static string? Opt(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static (int, string) MockBody(JsonElement mock)
    {
        var status = mock.GetProperty("status").GetInt32();
        var body = mock.TryGetProperty("json", out var j) ? j.GetRawText()
                 : mock.TryGetProperty("text", out var t) ? (t.GetString() ?? "") : "";
        return (status, body);
    }

    private static Dictionary<string, string> ParseForm(string body)
    {
        var d = new Dictionary<string, string>();
        foreach (var pair in body.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var idx = pair.IndexOf('=');
            if (idx < 0) { d[Uri.UnescapeDataString(pair.Replace('+', ' '))] = ""; continue; }
            d[Uri.UnescapeDataString(pair[..idx].Replace('+', ' '))] = Uri.UnescapeDataString(pair[(idx + 1)..].Replace('+', ' '));
        }
        return d;
    }

    private static AltiumAuthOptions BuildOptions(JsonElement c)
    {
        var def = AltiumEndpoints.CommercialCloud;
        string Get(string k, string fb) => c.TryGetProperty(k, out var e) && e.ValueKind == JsonValueKind.String ? e.GetString()! : fb;
        return new AltiumAuthOptions
        {
            ClientId = c.GetProperty("clientId").GetString()!,
            Scopes = c.GetProperty("scopes").GetString()!,
            ClientSecret = c.TryGetProperty("clientSecret", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString() : null,
            Endpoints = new AltiumEndpoints(Get("authEndpoint", def.AuthorizeEndpoint), Get("tokenEndpoint", def.TokenEndpoint), Get("actionWaitEndpoint", def.ActionWaitEndpoint), Get("redirectUri", def.RedirectUri)),
        };
    }

    private sealed class Call { public string Url = ""; public string Method = ""; public string? Authorization; public string Body = ""; }

    private sealed class SeqHandler(Func<HttpRequestMessage, string, int, (int, string)> reply) : HttpMessageHandler
    {
        public readonly List<Call> Calls = new();
        private int _i;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
        {
            var body = req.Content is null ? "" : await req.Content.ReadAsStringAsync(ct);
            Calls.Add(new Call { Url = req.RequestUri!.ToString(), Method = req.Method.Method, Authorization = req.Headers.Authorization?.ToString(), Body = body });
            var (status, respBody) = reply(req, body, _i++);
            return new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent(respBody, Encoding.UTF8) };
        }
    }
}
