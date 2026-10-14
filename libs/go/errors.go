package altiumauth

import (
	"errors"
	"fmt"
)

// ErrSignInCancelled is returned by SignIn when the ActionWait wait token is no
// longer valid (410: consumed or superseded) or the caller's context is
// cancelled. Restart sign-in with a new token.
var ErrSignInCancelled = errors.New("altiumauth: Sign-in cancelled")

// ErrStateMismatch is returned by SignIn when the state delivered with the
// authorization code does not match the one it generated (CSRF guard). The
// code is not exchanged.
var ErrStateMismatch = errors.New("altiumauth: State mismatch during sign-in (possible CSRF attack)")

// TokenError is a non-success response from the token endpoint. Code carries
// the OAuth error (e.g. "access_denied" for a cross-partition workspace
// exchange, "invalid_grant" for an expired or revoked refresh token).
type TokenError struct {
	StatusCode  int
	Code        string // OAuth "error"; empty if the body was not an OAuth error
	Description string // OAuth "error_description"; may be empty
	Body        string // raw response body (truncated)
}

func (e *TokenError) Error() string {
	msg := fmt.Sprintf("altiumauth: Token endpoint %d %s", e.StatusCode, e.Code)
	if e.Description != "" {
		msg += " — " + e.Description
	}
	return msg + " (body: " + e.Body + ")"
}

// AuthorizationError is an OAuth error delivered through the ActionWait
// callback instead of an authorization code (e.g. "access_denied" when a
// workspace scope is requested at sign-in on the wrong partition).
type AuthorizationError struct {
	Code        string
	Description string
}

func (e *AuthorizationError) Error() string {
	msg := "altiumauth: ActionWait sign-in failed: " + e.Code
	if e.Description != "" {
		msg += " — " + e.Description
	}
	return msg
}

// truncate shortens response bodies quoted in error messages.
func truncate(s string) string {
	const limit = 500
	r := []rune(s)
	if len(r) <= limit {
		return s
	}
	return string(r[:limit])
}
