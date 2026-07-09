namespace Altium.Auth;

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
