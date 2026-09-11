using System.Runtime.Serialization;

namespace Altium.Auth;

/// <summary>ActionWait long-poll request body (SPEC §4.3).</summary>
[DataContract]
internal sealed class ActionWaitRequest
{
    [DataMember(Name = "token")]
    public string Token { get; set; } = "";
}
