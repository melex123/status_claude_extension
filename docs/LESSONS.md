# Lessons Learned

## Claude Usage API

- **Endpoint**: `claude.ai/api/organizations/{orgId}/usage` — requires session cookie auth
- **Utilization values are already percentages (0–100)**, not decimals (0–1). Multiplying by 100 gives wildly wrong numbers like 1100%. Confirmed by testing with real data.
- **Session cookie name** is `sessionKey` (format: `sk-ant-...`)
- **Headers required**: `anthropic-client-platform: web_claude_ai` and `anthropic-client-version: 1.0.0` — mimics the web client

## Manifest V3 Service Workers

- **Cannot set `Cookie` header manually** in `fetch()` from a service worker — browsers strip it. Must use `credentials: 'include'` + `host_permissions` for automatic cookie inclusion.
- **`chrome.cookies.get()`** still works for checking if a cookie exists (presence check), even though you can't set it as a header.

## Status Page API

- `status.claude.com` uses Statuspage.io infrastructure
- **Public JSON API** at `/api/v2/summary.json` — no auth needed, returns components, incidents, and overall status
- Component statuses: `operational`, `degraded_performance`, `partial_outage`, `major_outage`, `under_maintenance`

## Security for Public Extensions

- Always `escapeHtml()` any API-sourced string before `innerHTML` — even trusted APIs can be compromised
- Validate `sender.id === chrome.runtime.id` on all `chrome.runtime.onMessage` handlers
- Validate format of user-controllable IDs (UUID regex) before using in URL construction
- Add explicit `content_security_policy` with `object-src 'none'` even though MV3 has defaults
