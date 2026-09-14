# Changelog

## [2026-09-15] - Fable weekly limit, data-driven bars

### Added
- 7-day Fable limit as a usage bar (pink), included in badge color and notification thresholds
- Any model- or surface-scoped weekly limit the API reports now gets its own bar automatically (label `7-Day <name>`, neutral color for unknown ids)
- `noOrg` state shows an error message instead of an endless shimmer

### Changed
- `background.js` now turns the raw usage response into render-ready `monitorData.usage.bars` (`{ id, label, percent, resets_at, severity }`) built from `usage.limits[]`, with the legacy top-level keys as fallback; badge, notifications and popup all read `bars`, no limit key list is duplicated anymore
- One severity rule: badge color and the red "critical" bar follow the notification thresholds from Settings (default 80/95) instead of hardcoded 80/90 and 90
- Status and usage are fetched concurrently; storage is read once per refresh
- Popup reads storage once on open and skips the network refresh when cached data is under 60 s old (the refresh button still forces one)
- Bar colors are CSS custom properties set per bar; per-limit CSS classes and `!important` overrides removed
- Status component names: trailing "(host)" stripped by rule instead of a map keyed on upstream strings (the map had already gone stale: "Claude Console (platform.claude.com)"); long names truncate with an ellipsis
- Popup tells you to reload the extension when stored data comes from an older `background.js` (popup pages reload from disk on open, the service worker only after an extension reload)
- Options page: swatch lookup done once per color change, `bgColor` part of the settings literal, unused `#orgCard` id removed
- Manifest version 1.0.0 -> 1.1.0

### Fixed
- `limits[]` entries with a missing or non-numeric `percent` are dropped and values are clamped to 0-100 (previously rendered as a full green bar labelled `NaN%`)
- Entries without `kind` or scope are dropped instead of producing an `undefined` bar and `undefined_80` notification keys
- Thresholds are sorted on read, so warning 95 / critical 80 in Settings no longer makes every value above 80 "critical"
- `notificationSettings` without `thresholds` falls back to defaults instead of crashing the refresh
- `firedNotifications` is read right before use and rebuilt from the current bars, so overlapping refreshes cannot clobber each other and keys for vanished limits do not accumulate
- Message handler always answers the popup, even when a refresh throws

### Security (review 2026-09-15: 0 critical)
- Both `innerHTML` interpolations in the bar template are escaped; API-keyed maps use `Object.hasOwn` so `__proto__` / `constructor` from the API cannot resolve to prototype members
- `limits[]` capped at 12 bars, keeping the fullest ones so the badge cannot go green over a hidden limit; model names truncated to 40 chars before they reach ids, storage keys and notification titles
- `firedNotifications` is rebuilt even while notifications are disabled, so a disable/enable cycle cannot leave stale keys behind
- `orgId` URL-encoded in the usage URL
- Session cookie value is never read anymore, only its presence
- Residual (not applied): the `cookies` permission is still requested only for that presence check; dropping it and mapping HTTP 401 to the login prompt would remove the extension's read access to the `sessionKey` token. Left as a follow-up because it changes login detection.

Verified: `node --check` on background.js, popup.js, options.js; manifest JSON valid; Node `vm` harness with mocked `chrome`/`fetch` and a fixture captured from the live usage API: 47/47 PASS. Live popup check requires an extension reload in `chrome://extensions`, not done in this session.

## [2026-03-25] - Initial Release

### Added
- Chrome/Brave extension with Manifest V3
- Usage monitoring via `claude.ai/api/organizations/{orgId}/usage` — displays 5-hour, 7-day, 7-day Opus, and 7-day Sonnet limits as progress bars
- Service status via `status.claude.com/api/v2/summary.json` — shows all 5 Claude services with real-time status indicators
- Active incident display when outages occur
- Auto cookie extraction from claude.ai (zero-setup authentication)
- Configurable refresh interval (1–30 min, default 5 min) via `chrome.alarms`
- Customizable notification thresholds (default 80%, 95%) with `chrome.notifications`
- Background color customization with 7 presets + custom color picker
- Multi-organization support with org selector in settings
- Badge icon changes to `!` with red/yellow when outage or high usage detected
- Dark mode UI with color-coded progress bars (amber/purple/cyan/green)
- Shimmer loading animation while fetching data
- Error states: login prompt when not authenticated, retry on API failures
- Claude Code mascot as extension icon (all sizes: 16/32/48/128px)
- Security: HTML escaping for API data, sender validation on messages, UUID validation for orgId, explicit CSP, input clamping
- Screenshots in README, emoji-rich documentation
