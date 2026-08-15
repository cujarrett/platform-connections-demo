package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"slices"
	"strings"
	"sync/atomic"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

// Must match a role name under entra.roles in this Api's workspace file. Declared
// and granted there; only checked here.
const requiredRole = "Data.Read"

// Nil until discovery completes. Fetched in the background so an Entra blip cannot
// stop this pod becoming ready and take the mesh half of the demo down with it.
var entraVerifier atomic.Pointer[oidc.IDTokenVerifier]

// Split rather than summed - the refused series is the one worth watching.
var (
	entraAllowed atomic.Int64
	entraRefused atomic.Int64
)

// This API's own client id, injected by the platform. A v2 access token carries the
// resource's client id in aud, whatever identifier the caller asked by - so a caller
// naming this API by App ID URI still produces a token audienced to this id.
func expectedAudience() string {
	return os.Getenv("AZURE_CLIENT_ID")
}

// Resolves the verifier in the background, retrying forever. Reads no secret,
// because this flow has none.
func startEntraVerifier(ctx context.Context) {
	tenantID := os.Getenv("AZURE_TENANT_ID")
	// No audience means nothing to check against, so refuse everything rather than
	// verify half a token.
	if tenantID == "" || expectedAudience() == "" {
		slog.Info("entra not configured, protected endpoint will refuse everything")
		return
	}

	go func() {
		for {
			// v2.0 issuer. The v1 endpoint mints tokens from sts.windows.net, which
			// fails issuer validation here even though the token is otherwise good.
			provider, err := oidc.NewProvider(ctx, "https://login.microsoftonline.com/"+tenantID+"/v2.0")
			if err == nil {
				// aud is the check that catches a token which is real, signed and
				// unexpired, and minted for a different API.
				entraVerifier.Store(provider.Verifier(&oidc.Config{ClientID: expectedAudience()}))
				slog.Info("entra verifier ready", "tenant", tenantID, "audience", expectedAudience())
				return
			}
			slog.Warn("entra discovery failed, retrying", "err", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(30 * time.Second):
			}
		}
	}()
}

// The Entra half. The mesh already allowed the connection; this asks the separate
// question of whether that identity was granted the role.
func protectedHandler(w http.ResponseWriter, r *http.Request) {
	verifier := entraVerifier.Load()
	if verifier == nil {
		// Not a refusal - nothing was checked. Saying "denied" would teach the wrong lesson.
		entraDeny(w, http.StatusServiceUnavailable, "verifier_unavailable",
			"Entra discovery has not completed yet")
		return
	}

	raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || raw == "" {
		entraDeny(w, http.StatusUnauthorized, "no_token", "no bearer token presented")
		return
	}

	// Signature, issuer, audience and expiry. Entra is not called here - the keys
	// were fetched once at startup.
	tok, err := verifier.Verify(r.Context(), raw)
	if err != nil {
		// 401, not 403: the token itself did not hold up, so the caller has not been
		// refused - it has not been believed.
		entraDeny(w, http.StatusUnauthorized, "invalid_token", err.Error())
		return
	}

	var claims struct {
		Roles []string `json:"roles"`
		AppID string   `json:"appid"`
	}
	if err := tok.Claims(&claims); err != nil {
		entraDeny(w, http.StatusUnauthorized, "unreadable_claims", err.Error())
		return
	}

	// The line the demo turns on. A caller with no grant still arrives with a real,
	// valid token - it just carries no role for this API.
	if !slices.Contains(claims.Roles, requiredRole) {
		entraRefused.Add(1)
		slog.Info("entra refused", "appid", claims.AppID, "roles", claims.Roles, "required", requiredRole)
		entraDeny(w, http.StatusForbidden, "missing_role",
			fmt.Sprintf("identity is valid but holds %v, needs %q", claims.Roles, requiredRole))
		return
	}

	entraAllowed.Add(1)
	slog.Info("entra allowed", "appid", claims.AppID, "roles", claims.Roles)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
		"data":  "ok",
		"appid": claims.AppID,
		"roles": claims.Roles,
	})
}

// Always names which check failed - a mesh 403 and a role 403 look identical from
// outside, and a bare one teaches nothing.
func entraDeny(w http.ResponseWriter, code int, reason, detail string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{ //nolint:errcheck
		"error":  reason,
		"detail": detail,
		"gate":   "entra",
	})
}
