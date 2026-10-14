package altiumauth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
)

// GetClientScopes fetches the scopes registered for a client from the
// ClientScopes endpoint ({base}/api/ClientScopes). The endpoint itself answers
// an empty list for an unknown client ID. Anything else unexpected — a non-200
// status, or a body that is not a JSON array of strings — is an error: an
// empty list is a meaningful answer, so a failed lookup must not look like one.
//
// On Commercial/GovCloud this returns only the client's static scopes (e.g.
// openid, profile). On an AES installation, which hosts exactly one workspace,
// it also includes that workspace's a365:workspace:{id} scope.
//
// httpClient may be nil to use http.DefaultClient.
func GetClientScopes(ctx context.Context, httpClient *http.Client, scopeEndpoint, clientID string) ([]string, error) {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	u, err := url.Parse(scopeEndpoint)
	if err != nil {
		return nil, fmt.Errorf("altiumauth: invalid scope endpoint %q: %w", scopeEndpoint, err)
	}
	q := u.Query()
	q.Set("clientId", clientID)
	u.RawQuery = q.Encode()

	res, err := do(ctx, httpClient, http.MethodGet, u.String(), "", nil, nil)
	if err != nil {
		return nil, fmt.Errorf("altiumauth: ClientScopes request: %w", err)
	}
	body := string(res.body)
	if res.status != 200 {
		return nil, fmt.Errorf("altiumauth: ClientScopes endpoint %d: %s", res.status, truncate(body))
	}

	// Decode loosely: a JSON null must be an error, not an empty list.
	var raw any
	_ = json.Unmarshal(res.body, &raw)
	items, ok := raw.([]any)
	scopes := make([]string, 0, len(items))
	for _, item := range items {
		s, isString := item.(string)
		if !isString {
			ok = false
			break
		}
		scopes = append(scopes, s)
	}
	if !ok {
		return nil, fmt.Errorf("altiumauth: ClientScopes endpoint returned an unexpected body (expected a JSON array of strings): %s", truncate(body))
	}
	return scopes, nil
}
