package altiumauth

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// Config is the OAuth2 client configuration. Only ClientID and Scopes are
// required; every endpoint defaults to [CommercialCloudEndpoints]. Set
// Endpoints to [GovCloudEndpoints] or [AESEndpoints] for those deployments, or
// override individual fields for a custom one. Any endpoint that is set must
// be an absolute URL.
type Config struct {
	// ClientID is the OAuth2 client ID registered with the Altium identity
	// provider.
	ClientID string

	// Scopes is the space-delimited list of scopes to request (must include
	// "openid profile").
	Scopes string

	// ClientSecret makes this a confidential client (e.g. a backend): token and
	// revocation requests then authenticate with HTTP Basic. Leave it empty for
	// public clients (desktop/native), which rely on PKCE. Never embed a secret
	// in a public client.
	ClientSecret string

	// Secure overrides GovCloud detection. By default secure=1 is sent on token
	// requests when TokenEndpoint is a Gov host and omitted otherwise, so leave
	// this nil. Set it only to force behavior for a non-standard host.
	Secure *bool

	// Endpoints holds the endpoint URLs; empty fields default to
	// CommercialCloudEndpoints.
	Endpoints

	// HTTPClient is used for every request. Defaults to http.DefaultClient.
	// Bound request lifetimes with the context passed to each call rather than
	// Client.Timeout, which would cut ActionWait long polls short.
	HTTPClient *http.Client
}

// resolve fills omitted endpoints from CommercialCloudEndpoints and validates
// the result.
func (c Config) resolve() (Config, error) {
	d := CommercialCloudEndpoints
	if c.AuthEndpoint == "" {
		c.AuthEndpoint = d.AuthEndpoint
	}
	if c.TokenEndpoint == "" {
		c.TokenEndpoint = d.TokenEndpoint
	}
	if c.ActionWaitEndpoint == "" {
		c.ActionWaitEndpoint = d.ActionWaitEndpoint
	}
	if c.RedirectURI == "" {
		c.RedirectURI = d.RedirectURI
	}
	if c.HTTPClient == nil {
		c.HTTPClient = http.DefaultClient
	}

	for _, f := range []struct{ name, value string }{
		{"ClientID", c.ClientID},
		{"Scopes", c.Scopes},
	} {
		if strings.TrimSpace(f.value) == "" {
			return c, fmt.Errorf("altiumauth: Config.%s is required and must be non-empty", f.name)
		}
	}
	for _, f := range []struct{ name, value string }{
		{"AuthEndpoint", c.AuthEndpoint},
		{"TokenEndpoint", c.TokenEndpoint},
		{"ActionWaitEndpoint", c.ActionWaitEndpoint},
		{"RedirectURI", c.RedirectURI},
	} {
		if !isAbsoluteURL(f.value) {
			return c, fmt.Errorf("altiumauth: Config.%s is not a valid URL: %q", f.name, f.value)
		}
	}
	return c, nil
}

func isAbsoluteURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && u.Scheme != "" && u.Host != ""
}

// isGovTokenEndpoint reports whether a token endpoint belongs to Altium
// GovCloud. Gov hosts carry a "gov" label (e.g. auth.365-gov.altium.com);
// Commercial and AES hosts do not.
func isGovTokenEndpoint(tokenEndpoint string) bool {
	u, err := url.Parse(tokenEndpoint)
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(u.Hostname()), "gov")
}

// sendSecure reports whether token requests carry secure=1.
func (c Config) sendSecure() bool {
	if c.Secure != nil {
		return *c.Secure
	}
	return isGovTokenEndpoint(c.TokenEndpoint)
}
