package altiumauth

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"time"
)

// DefaultSignInTimeout bounds the whole ActionWait reconnect loop when
// SignInOptions.Timeout is zero.
const DefaultSignInTimeout = 3 * time.Minute

// SignInOptions customizes [Config.SignIn].
type SignInOptions struct {
	// Timeout bounds the whole ActionWait wait (the user's time to sign in),
	// across reconnects. Default: DefaultSignInTimeout.
	Timeout time.Duration

	// SelectWorkspace enables login-into-workspace mode (SPEC §3.1). See
	// AuthorizationURLOptions.SelectWorkspace.
	SelectWorkspace WorkspaceSelection

	// OpenBrowser overrides how the authorization URL is opened (e.g. a host
	// application's own API). By default the library launches the OS browser
	// and prints the URL to stderr for manual copy-and-paste. An error aborts
	// sign-in.
	OpenBrowser func(url string) error
}

// SignIn performs an OAuth2 PKCE sign-in over Altium's ActionWait long poll —
// the flow for public clients (desktop/CLI) that cannot host a redirect:
//
//  1. Generate a PKCE verifier and a connection token, used as the OAuth state.
//  2. Start the ActionWait long poll, then open the browser to the authorize URL.
//  3. Wait for the code, verify the state (CSRF), and exchange it for tokens.
//
// Cancel ctx to abandon sign-in early ([ErrSignInCancelled]). Persisting the
// returned TokenSet is the caller's concern. For redirect-based apps, use
// [Config.CreateAuthorizationURL] and [Config.ExchangeCode] instead.
func (c Config) SignIn(ctx context.Context, opts SignInOptions) (*TokenSet, error) {
	cfg, err := c.resolve()
	if err != nil {
		return nil, err
	}

	// The connection token doubles as the OAuth state and the ActionWait token.
	connectionToken := newUUID()
	authz, err := cfg.buildAuthorize(AuthorizationURLOptions{State: connectionToken, SelectWorkspace: opts.SelectWorkspace})
	if err != nil {
		return nil, err
	}

	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = DefaultSignInTimeout
	}
	errTimedOut := fmt.Errorf("altiumauth: ActionWait poll timed out after %s: %w", timeout, context.DeadlineExceeded)
	pollCtx, cancel := context.WithTimeoutCause(ctx, timeout, errTimedOut)
	defer cancel()

	// Start the long poll BEFORE opening the browser so a fast callback can't race.
	type result struct {
		code, state string
		err         error
	}
	done := make(chan result, 1)
	go func() {
		code, state, err := cfg.pollActionWait(pollCtx, connectionToken)
		done <- result{code, state, err}
	}()

	if opts.OpenBrowser != nil {
		if err := opts.OpenBrowser(authz.URL); err != nil {
			cancel()
			<-done
			return nil, fmt.Errorf("altiumauth: open browser: %w", err)
		}
	} else {
		openBrowser(authz.URL)
	}

	r := <-done
	if r.err != nil {
		return nil, r.err
	}
	// CSRF guard: the state must match the connection token we generated.
	if r.state != connectionToken {
		return nil, ErrStateMismatch
	}
	return cfg.tokenRequest(ctx, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {r.code},
		"redirect_uri":  {cfg.RedirectURI},
		"code_verifier": {authz.CodeVerifier},
	})
}

// pollActionWait long-polls the ActionWait endpoint for the authorization
// result: 408 reconnects with the same token, 410 is terminal, and 200
// carries either the code+state or a delivered OAuth error (SPEC §4.3).
func (c Config) pollActionWait(ctx context.Context, token string) (code, state string, err error) {
	const maxRetries = 10_000 // safety net against a server that reconnects instantly
	payload, _ := json.Marshal(map[string]string{"token": token})

	// The error for whichever deadline or cancellation stopped the poll.
	abortErr := func() error {
		cause := context.Cause(ctx)
		if !errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("%w: %w", ErrSignInCancelled, cause)
		}
		if cause == context.DeadlineExceeded { // the caller's deadline, not our timeout
			return fmt.Errorf("altiumauth: ActionWait poll timed out: %w", cause)
		}
		return cause
	}

	for range maxRetries {
		if ctx.Err() != nil {
			return "", "", abortErr()
		}
		res, err := do(ctx, c.HTTPClient, http.MethodPost, c.ActionWaitEndpoint, "application/json", bytes.NewReader(payload), nil)
		if err != nil {
			if ctx.Err() != nil {
				return "", "", abortErr()
			}
			if isTLSError(err) {
				return "", "", fmt.Errorf("altiumauth: ActionWait TLS error: %w", err)
			}
			var netErr net.Error
			if errors.As(err, &netErr) && netErr.Timeout() {
				continue // the HTTP client's own request timeout — reconnect
			}
			return "", "", fmt.Errorf("altiumauth: ActionWait request: %w", err)
		}

		body := string(res.body)
		switch res.status {
		case http.StatusRequestTimeout: // hold interval elapsed: normal, reconnect
			continue
		case http.StatusGone:
			return "", "", ErrSignInCancelled
		case http.StatusOK:
			var parsed struct {
				Data map[string]any `json:"data"`
			}
			if err := json.Unmarshal(res.body, &parsed); err != nil {
				return "", "", fmt.Errorf("altiumauth: ActionWait returned 200 but body is not JSON: %s", truncate(body))
			}
			if oauthErr, _ := parsed.Data["error"].(string); oauthErr != "" {
				desc, _ := parsed.Data["error_description"].(string)
				return "", "", &AuthorizationError{Code: oauthErr, Description: desc}
			}
			code, _ := parsed.Data["code"].(string)
			if code == "" {
				return "", "", fmt.Errorf("altiumauth: ActionWait returned 200 but body is missing data.code: %s", truncate(body))
			}
			state, _ := parsed.Data["state"].(string)
			if state == "" {
				return "", "", fmt.Errorf("altiumauth: ActionWait returned 200 but body is missing data.state: %s", truncate(body))
			}
			return code, state, nil
		default:
			return "", "", fmt.Errorf("altiumauth: ActionWait returned %d: %s", res.status, truncate(body))
		}
	}
	return "", "", fmt.Errorf("altiumauth: ActionWait retry count exceeded %d", maxRetries)
}

// isTLSError reports whether a TLS/certificate failure is in err's chain.
func isTLSError(err error) bool {
	var (
		certVerify  *tls.CertificateVerificationError
		recordHdr   tls.RecordHeaderError
		alert       tls.AlertError
		unknownAuth x509.UnknownAuthorityError
		hostname    x509.HostnameError
		invalid     x509.CertificateInvalidError
	)
	return errors.As(err, &certVerify) || errors.As(err, &recordHdr) || errors.As(err, &alert) ||
		errors.As(err, &unknownAuth) || errors.As(err, &hostname) || errors.As(err, &invalid)
}
