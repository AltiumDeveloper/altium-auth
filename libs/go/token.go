package altiumauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// TokenSet is the token endpoint response (RFC 6749 / OIDC).
type TokenSet struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	IDToken      string `json:"id_token,omitempty"`
	TokenType    string `json:"token_type,omitempty"`
	ExpiresIn    int64  `json:"expires_in,omitempty"`
	// ExpiresAt is the epoch second at which the access token expires,
	// computed by the library as now + expires_in - 30 (clock-skew buffer).
	ExpiresAt int64  `json:"expires_at,omitempty"`
	Scope     string `json:"scope,omitempty"`
}

// Expired reports whether the access token has expired (per ExpiresAt). A
// TokenSet without an expiry is never reported as expired.
func (t *TokenSet) Expired() bool {
	return t.ExpiresAt != 0 && time.Now().Unix() >= t.ExpiresAt
}

// tokenRequest POSTs a grant to the token endpoint and parses the TokenSet.
// Client authentication and secure=1 (Gov token endpoint, or Config.Secure)
// are applied centrally.
func (c Config) tokenRequest(ctx context.Context, form url.Values) (*TokenSet, error) {
	// GovCloud token requests require secure=1; Commercial and AES must omit it.
	if c.sendSecure() {
		form.Set("secure", "1")
	}

	res, err := c.postForm(ctx, c.TokenEndpoint, form)
	if err != nil {
		return nil, fmt.Errorf("altiumauth: token request: %w", err)
	}
	body := string(res.body)

	if res.status != 200 && res.status != 201 {
		var oauth struct {
			Error       any `json:"error"`
			Description any `json:"error_description"`
		}
		_ = json.Unmarshal(res.body, &oauth) // non-JSON error bodies are quoted raw
		code, _ := oauth.Error.(string)
		desc, _ := oauth.Description.(string)
		return nil, &TokenError{StatusCode: res.status, Code: code, Description: desc, Body: truncate(body)}
	}

	var tok TokenSet
	if err := json.Unmarshal(res.body, &tok); err != nil {
		return nil, fmt.Errorf("altiumauth: Token endpoint returned non-JSON body: %s", truncate(body))
	}
	if tok.ExpiresIn != 0 && tok.ExpiresAt == 0 {
		tok.ExpiresAt = time.Now().Unix() + tok.ExpiresIn - 30
	}
	return &tok, nil
}

// ExchangeCodeParams are the inputs to [Config.ExchangeCode].
type ExchangeCodeParams struct {
	// Code is the authorization code delivered to your redirect callback.
	Code string
	// CodeVerifier is the PKCE verifier from CreateAuthorizationURL
	// (recommended).
	CodeVerifier string
	// RedirectURI must match the one used in the authorize request. Defaults to
	// Config.RedirectURI.
	RedirectURI string
}

// ExchangeCode exchanges an authorization code (from your redirect callback)
// for tokens via the authorization_code grant. Pair it with
// [Config.CreateAuthorizationURL] for the redirect-based flow.
func (c Config) ExchangeCode(ctx context.Context, p ExchangeCodeParams) (*TokenSet, error) {
	cfg, err := c.resolve()
	if err != nil {
		return nil, err
	}
	if p.Code == "" {
		return nil, errors.New("altiumauth: code is required — pass the authorization code from the redirect callback")
	}
	redirectURI := p.RedirectURI
	if redirectURI == "" {
		redirectURI = cfg.RedirectURI
	}
	form := url.Values{
		"grant_type":   {"authorization_code"},
		"code":         {p.Code},
		"redirect_uri": {redirectURI},
	}
	if p.CodeVerifier != "" {
		form.Set("code_verifier", p.CodeVerifier)
	}
	return cfg.tokenRequest(ctx, form)
}

// SignIntoWorkspace exchanges a global access token (from SignIn or
// ExchangeCode) for a workspace-scoped token via the token-exchange grant
// (RFC 8693). Point TokenEndpoint at the Gov host to exchange a Commercial
// token for a Gov workspace token (secure=1 is added automatically).
func (c Config) SignIntoWorkspace(ctx context.Context, baseAccessToken, workspaceAuthID string) (*TokenSet, error) {
	cfg, err := c.resolve()
	if err != nil {
		return nil, err
	}
	if baseAccessToken == "" {
		return nil, errors.New("altiumauth: baseAccessToken is required — pass the access_token from a prior sign-in")
	}
	return cfg.tokenRequest(ctx, url.Values{
		"grant_type":         {"urn:ietf:params:oauth:grant-type:token-exchange"},
		"subject_token":      {baseAccessToken},
		"subject_token_type": {"urn:ietf:params:oauth:token-type:access_token"},
		"scope":              {strings.TrimSpace("a365:workspace:" + workspaceAuthID + " " + cfg.Scopes)},
	})
}

// RefreshToken exchanges a refresh token for a fresh TokenSet. No scope is
// sent, so the grant keeps its original scope (a global token stays global, a
// workspace token stays workspace-scoped). If the response carries a new
// refresh token (rotation), persist it and discard the old one.
func (c Config) RefreshToken(ctx context.Context, refreshToken string) (*TokenSet, error) {
	cfg, err := c.resolve()
	if err != nil {
		return nil, err
	}
	if refreshToken == "" {
		return nil, errors.New("altiumauth: refreshToken is required — pass the refresh_token from a prior TokenSet")
	}
	return cfg.tokenRequest(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
	})
}

// RevokeRefreshToken revokes a refresh token at the revocation endpoint
// (RFC 7009), derived from the token endpoint (/connect/token →
// /connect/revocation). Only refresh tokens can be revoked. The call is
// idempotent: the endpoint answers 200 for known and unknown tokens alike.
// After revoking, RefreshToken with the same token fails with invalid_grant.
func (c Config) RevokeRefreshToken(ctx context.Context, refreshToken string) error {
	cfg, err := c.resolve()
	if err != nil {
		return err
	}
	if refreshToken == "" {
		return errors.New("altiumauth: refreshToken is required — pass the refresh_token to revoke")
	}
	endpoint := strings.Replace(cfg.TokenEndpoint, "/connect/token", "/connect/revocation", 1)
	res, err := cfg.postForm(ctx, endpoint, url.Values{
		"token":           {refreshToken},
		"token_type_hint": {"refresh_token"},
	})
	if err != nil {
		return fmt.Errorf("altiumauth: revocation request: %w", err)
	}
	if res.status < 200 || res.status >= 300 {
		return fmt.Errorf("altiumauth: Revocation endpoint %d: %s", res.status, truncate(string(res.body)))
	}
	return nil
}
