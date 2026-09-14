# Lessons Learned

## Claude Usage API

- **Endpoint**: `claude.ai/api/organizations/{orgId}/usage` — requires session cookie auth
- **Utilization values are already percentages (0–100)**, not decimals (0–1). Multiplying by 100 gives wildly wrong numbers like 1100%. Confirmed by testing with real data.
- **Session cookie name** is `sessionKey` (format: `sk-ant-...`)
- **Headers required**: `anthropic-client-platform: web_claude_ai` and `anthropic-client-version: 1.0.0` — mimics the web client
- **Model-scoped weekly limits (Fable) are NOT top-level keys.** `seven_day_opus` / `seven_day_sonnet` come back `null` on a Max plan in 2026-09; the newer top-level keys are opaque codenames (`nimbus_quill`, `cinder_cove`, `copper_kite`, ...) that do not map to model names. The reliable source is the `limits[]` array: `{ kind: "session" | "weekly_all" | "weekly_scoped", percent, resets_at, scope: null | { model: { id, display_name: "Fable" }, surface } }`. `percent` is 0–100 like `utilization`. Verified against the live API on 2026-09-15. `background.js` builds bars from `limits[]` and only falls back to the legacy keys when the array is missing.
- **Normalize in the service worker, not in the consumers.** Badge, notifications and popup each used to carry their own copy of the limit key list; adding one limit meant editing four files. Since `monitorData` already travels through `chrome.storage.local`, shipping a render-ready `bars[]` array from `background.js` removes the duplication without needing a shared module or `type: "module"` in the manifest.

## Manifest V3 Service Workers

- **Cannot set `Cookie` header manually** in `fetch()` from a service worker — browsers strip it. Must use `credentials: 'include'` + `host_permissions` for automatic cookie inclusion.
- **`chrome.cookies.get()`** still works for checking if a cookie exists (presence check), even though you can't set it as a header.

## Status Page API

- `status.claude.com` uses Statuspage.io infrastructure
- **Public JSON API** at `/api/v2/summary.json` — no auth needed, returns components, incidents, and overall status
- Component statuses: `operational`, `degraded_performance`, `partial_outage`, `major_outage`, `under_maintenance`

## Testing Without Loading the Extension

- **Node `vm` harness beats manual clicking for the service worker.** `vm.runInContext(background.js, { chrome: mock, fetch: mock })` with a fixture captured from the live usage API covers bars, badge, notifications and error paths in milliseconds; the popup runs the same way with a 20-line DOM stub (`querySelector`, `createElement`, `classList.toggle`, `innerHTML` setter that clears `children`). Harness lives in the session scratchpad, not in the repo.
- **Two mock pitfalls that produced false failures:** (1) `innerHTML = ''` must clear the mock's `children`, otherwise every render appends; (2) anything the worker fires without `await` (notifications used to be) needs a `setTimeout` tick before asserting.
- `chrome.cookies.get` is promise-based in MV3; the callback wrapper was never needed.

### Traps & Dead Ends

- Tried opening `chrome-extension://<id>/popup/popup.html` and `chrome://extensions` through the Claude-in-Chrome MCP to verify live — refused ("browser-internal URLs"). Working path: Node harness for logic, manual reload + click for the visual check. The extension ID is in `Secure Preferences` of the Chrome/Brave profile under `extensions.settings[*].path`.
- Do NOT read the Fable limit from a top-level key or from the `nimbus_quill`-style codenames — those were `null` / `0` while `limits[]` said 37 %. The first version of this change did exactly that with a `/fable/i` regex on `limits[]` and a synthetic `seven_day_fable` key; it worked but needed four files per new model, so it was replaced by the `bars[]` producer.
- Do NOT keep the per-limit CSS classes (`.bar-seven-day-opus` etc.): limits discovered at runtime cannot be styled that way. Inline `--bar-c1/--bar-c2` per bar, no `!important`.
- `escapeHtml()` on `element.title` is a bug, not defense: `title` is a property sink, the entity text shows literally.

## Security for Public Extensions

- Always `escapeHtml()` any API-sourced string before `innerHTML` — even trusted APIs can be compromised
- Validate `sender.id === chrome.runtime.id` on all `chrome.runtime.onMessage` handlers
- Validate format of user-controllable IDs (UUID regex) before using in URL construction
- Add explicit `content_security_policy` with `object-src 'none'` even though MV3 has defaults
