using System.Net;
using System.Text;
using Altium.Auth;
using Xunit;

namespace Altium.Auth.Tests;

public class AltiumEndpointsTests
{
    [Fact]
    public void Aes_DerivesAllEndpointsFromOrigin()
    {
        var aes = AltiumEndpoints.Aes("https://aes.example.com:9785");

        Assert.Equal("https://aes.example.com:9785/unifiedlogin/connect/authorize", aes.AuthorizeEndpoint);
        Assert.Equal("https://aes.example.com:9785/unifiedlogin/connect/token", aes.TokenEndpoint);
        Assert.Equal("https://aes.example.com:9785/actionwait/await", aes.ActionWaitEndpoint);
        Assert.Equal("https://aes.example.com:9785/unifiedlogin/api/AuthComplete", aes.RedirectUri);
        Assert.Equal("https://aes.example.com:9785/unifiedlogin/api/ClientScopes", aes.ScopeEndpoint);
    }

    [Fact]
    public void Aes_StripsTrailingSlashFromOrigin()
    {
        var aes = AltiumEndpoints.Aes("https://aes.example.com:9785/");

        Assert.Equal("https://aes.example.com:9785/unifiedlogin/connect/authorize", aes.AuthorizeEndpoint);
    }

    [Fact]
    public void Aes_DoesNotUseSecure()
    {
        var options = new AltiumAuthOptions
        {
            ClientId = "aes-client",
            Scopes = "openid profile",
            Endpoints = AltiumEndpoints.Aes("https://aes.example.com:9785"),
        };

        Assert.False(options.UseSecure);
    }

    [Fact]
    public async Task GetClientScopesAsync_GetsScopeEndpointAndReturnsScopes()
    {
        string? requestedUrl = null;
        var handler = new StubHandler((req, ct) =>
        {
            requestedUrl = req.RequestUri!.ToString();
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("""["a365:workspace:abc-123","openid"]""", Encoding.UTF8, "application/json"),
            };
        });
        using var http = new HttpClient(handler);

        var scopes = await AltiumAuthClient.GetClientScopesAsync(http, "https://aes.example.com:9785/unifiedlogin/api/ClientScopes", "aes-client");

        Assert.Equal("https://aes.example.com:9785/unifiedlogin/api/ClientScopes?clientId=aes-client", requestedUrl);
        Assert.Equal(new[] { "a365:workspace:abc-123", "openid" }, scopes);
    }

    private sealed class StubHandler(Func<HttpRequestMessage, CancellationToken, HttpResponseMessage> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct) =>
            Task.FromResult(reply(req, ct));
    }
}
