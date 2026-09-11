using System.Runtime.Serialization;

namespace Altium.Auth;

/// <summary>The authorization code and echoed connection token inside an ActionWait 200.</summary>
[DataContract]
internal sealed class ActionWaitData
{
    [DataMember(Name = "code")]
    public string? Code { get; set; }

    [DataMember(Name = "state")]
    public string? State { get; set; }
}
