package altiumauth

import (
	"fmt"
	"net/url"
)

// WorkspaceSelection controls whether the user is prompted to select a
// workspace during authorization (login-into-workspace mode, SPEC §3.1).
type WorkspaceSelection string

const (
	// SelectWorkspaceNone skips workspace selection; the flow issues a global
	// access token. Equivalent to leaving the option empty.
	SelectWorkspaceNone WorkspaceSelection = "none"
	// SelectWorkspaceStrict makes workspace selection mandatory; the issued
	// token is workspace-scoped, so no separate exchange is needed.
	SelectWorkspaceStrict WorkspaceSelection = "strict"
	// SelectWorkspaceOptional offers workspace selection; the user may skip it.
	SelectWorkspaceOptional WorkspaceSelection = "optional"
)

// AuthorizationURLOptions customizes [Config.CreateAuthorizationURL]. The zero
// value uses the configured redirect URI and scopes, and a fresh state and
// PKCE verifier.
type AuthorizationURLOptions struct {
	// RedirectURI overrides Config.RedirectURI (e.g. your own callback route).
	RedirectURI string
	// State overrides the generated state (default: a random UUID).
	State string
	// CodeVerifier overrides the generated PKCE code verifier.
	CodeVerifier string
	// Scopes overrides Config.Scopes for this request.
	Scopes string
	// SelectWorkspace enables login-into-workspace mode. Empty or
	// SelectWorkspaceNone omits the parameter.
	SelectWorkspace WorkspaceSelection
}

// AuthorizationRequest is a prepared authorization request: where to send the
// user, and what to keep for the callback.
type AuthorizationRequest struct {
	// URL is the authorization URL to send the user's browser to.
	URL string
	// State must be persisted and compared with the callback's state (CSRF).
	State string
	// CodeVerifier must be persisted and passed to ExchangeCode.
	CodeVerifier string
}

// CreateAuthorizationURL builds an OAuth2 authorization URL with PKCE for the
// redirect-based (authorization code) flow used by web/server apps that host
// their own redirect endpoint. It does no network I/O.
//
// Redirect the user to the returned URL and persist State and CodeVerifier
// (e.g. in the session). On the callback, verify the returned state matches,
// then call [Config.ExchangeCode] with the code and the stored verifier.
func (c Config) CreateAuthorizationURL(opts AuthorizationURLOptions) (AuthorizationRequest, error) {
	cfg, err := c.resolve()
	if err != nil {
		return AuthorizationRequest{}, err
	}
	return cfg.buildAuthorize(opts)
}

func (c Config) buildAuthorize(opts AuthorizationURLOptions) (AuthorizationRequest, error) {
	verifier := opts.CodeVerifier
	if verifier == "" {
		verifier = generateCodeVerifier()
	}
	state := opts.State
	if state == "" {
		state = newUUID()
	}
	redirectURI := opts.RedirectURI
	if redirectURI == "" {
		redirectURI = c.RedirectURI
	}
	scopes := opts.Scopes
	if scopes == "" {
		scopes = c.Scopes
	}

	q := url.Values{
		"response_type":         {"code"},
		"client_id":             {c.ClientID},
		"redirect_uri":          {redirectURI},
		"scope":                 {scopes},
		"code_challenge":        {codeChallenge(verifier)},
		"code_challenge_method": {"S256"},
		"state":                 {state},
	}
	// secure=1 is a token-endpoint concern only — never sent on /authorize.
	// selectWorkspace is sent only when explicitly requested.
	switch opts.SelectWorkspace {
	case SelectWorkspaceStrict, SelectWorkspaceOptional:
		q.Set("selectWorkspace", string(opts.SelectWorkspace))
	case "", SelectWorkspaceNone:
	default:
		return AuthorizationRequest{}, fmt.Errorf(
			"altiumauth: SelectWorkspace must be %q, %q, %q, or empty (got: %q)",
			SelectWorkspaceStrict, SelectWorkspaceOptional, SelectWorkspaceNone, opts.SelectWorkspace)
	}

	return AuthorizationRequest{URL: c.AuthEndpoint + "?" + q.Encode(), State: state, CodeVerifier: verifier}, nil
}
