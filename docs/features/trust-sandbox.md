# Trust sandbox

Absolute filesystem access is gated by `path_scope`: trusted project roots, app data, temp, and explicit user grants (file picker).

- Loopback media HTTP (`http://127.0.0.1:{port}/v1/media`) is token-gated and rejects paths outside `path_scope`.
- Legacy `media://` (cold-start fallback) still rejects disallowed paths and non-main-window CORS origins.
- Asset protocol denies common secret locations (`.ssh`, `secrets.json`, …).
- CSP is enabled (no `null`); scripts stay `'self'`.
