using System.Runtime.Serialization;

namespace Altium.Auth;

/// <summary>OAuth2 error response from the token endpoint (RFC 6749 §5.2).</summary>
[DataContract]
internal sealed class TokenErrorResponse
{
    [DataMember(Name = "error")]
    public string? Error { get; set; }

    [DataMember(Name = "error_description")]
    public string? ErrorDescription { get; set; }
}
