package altiumauth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

// generateCodeVerifier returns a high-entropy PKCE code verifier: base64url of
// 32 random bytes (RFC 7636).
func generateCodeVerifier() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b) // never fails (crypto/rand, Go ≥1.24)
	return base64.RawURLEncoding.EncodeToString(b)
}

// codeChallenge derives the S256 code challenge for a verifier (RFC 7636).
func codeChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// newUUID returns a random (version 4) UUID, used for state and the ActionWait
// connection token.
func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
