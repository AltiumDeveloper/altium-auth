using System.Runtime.Serialization;

namespace Altium.Auth;

/// <summary>The outcome inside an ActionWait 200: a code and echoed connection token, or a delivered OAuth error.</summary>
[DataContract]
internal sealed class ActionWaitData
{
    [DataMember(Name = "code")]
    public string? Code { get; set; }

    [DataMember(Name = "state")]
    public string? State { get; set; }

    [DataMember(Name = "error")]
    public string? Error { get; set; }

    [DataMember(Name = "error_description")]
    public string? ErrorDescription { get; set; }
}
