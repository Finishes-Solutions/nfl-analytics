# NFL Analytics Dashboard

A single-user, desktop-first analytics app over the warehouse. An Express API
(read-only, parameterized, sort allowlists) serves a React SPA from one App Service.
Sign-in is App Service Authentication plus an email allowlist.

Setup, local development on synthetic data, and deployment are in
[`docs/13-dashboard-and-operations.md`](../docs/13-dashboard-and-operations.md).

```bash
npm ci
AUTH_DISABLED=true npm run dev   # API :8081 + Vite :5173 (needs SQL_* env, see .env.example)
npm run build && npm start        # production build, serves dist/client + /api
npm test                          # endpoint + auth tests against a dev database
```
