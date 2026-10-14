package altiumauth

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/url"
	"runtime/debug"
	"strings"
)

// modulePath is this module's import path, used to find its version in the
// build info.
const modulePath = "github.com/AltiumDeveloper/altium-auth/libs/go"

// UserAgent is the User-Agent header sent on every request, e.g.
// "altium-auth-go/v0.2.0", so Altium services can identify the client.
var UserAgent = "altium-auth-go/" + moduleVersion()

func moduleVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "devel"
	}
	if info.Main.Path == modulePath && info.Main.Version != "" && info.Main.Version != "(devel)" {
		return info.Main.Version
	}
	for _, dep := range info.Deps {
		if dep.Path == modulePath {
			return dep.Version
		}
	}
	return "devel"
}

// response is a fully-read HTTP response, so error paths can quote the body.
type response struct {
	status int
	body   []byte
}

func do(ctx context.Context, client *http.Client, method, endpoint, contentType string, body io.Reader, header http.Header) (*response, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", UserAgent)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	for k, v := range header {
		req.Header[k] = v
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	return &response{status: res.StatusCode, body: b}, nil
}

// postForm POSTs a form-encoded body, authenticating the client per its type:
// a confidential client (ClientSecret set) uses HTTP Basic; a public client
// sends client_id in the body.
func (c Config) postForm(ctx context.Context, endpoint string, form url.Values) (*response, error) {
	header := http.Header{}
	if c.ClientSecret != "" {
		// client_secret_basic
		header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(c.ClientID+":"+c.ClientSecret)))
	} else {
		form.Set("client_id", c.ClientID)
	}
	return do(ctx, c.HTTPClient, http.MethodPost, endpoint,
		"application/x-www-form-urlencoded", strings.NewReader(form.Encode()), header)
}
