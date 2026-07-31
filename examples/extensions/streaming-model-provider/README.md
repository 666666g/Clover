# Streaming Model Provider/Auth

This headless example registers two provider definitions that share one normalized
streaming adapter:

- `echo-api-key` uses a Kun-managed API-key account;
- `echo-oauth` uses a Kun-managed OAuth 2.0 PKCE account.

The deterministic transport is intentionally local. It verifies the selected
account reference, streams text and usage in sequence, handles cancellation, and
returns a terminal error for an unknown model or unavailable account. It never
selects a fallback provider, model, or account.

For a real service, replace the echo body with the provider transport. Prefer
`authentication.authenticatedFetch` so Kun injects credentials without revealing
them. Request raw secret access only when custom signing truly requires it; never
log or return credentials.
