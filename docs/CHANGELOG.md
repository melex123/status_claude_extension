# Changelog

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
