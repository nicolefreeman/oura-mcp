# oura-mcp

An MCP (Model Context Protocol) server that wraps the [Oura Ring API v2](https://cloud.ouraring.com/v2/docs), giving AI assistants like Claude access to your sleep, recovery, HRV, heart rate, SpO2, and stress data — plus a local session notes store and an intelligence layer for coaching conversations.

## What it does

Connect this server to any MCP-compatible AI client and you can ask questions like:

- "How is my recovery looking this week?"
- "Show me my HRV trend over the last month."
- "How well was my training load aligned with my recovery last week?"
- "Log a note for today's run — felt strong, easy effort."

## Tools

| Tool | What it answers |
|---|---|
| `get_personal_info` | Basic athlete profile (age, sex, height, weight) |
| `get_sleep` | Full per-night sleep breakdown — duration, stages, HRV, HR, SpO2, efficiency |
| `get_hrv_trend` | HRV trend with 7-day rolling average and 30-day baseline deviation |
| `get_heart_rate` | Daily resting HR trend or full 5-minute timeseries |
| `get_daily_spo2` | Daily average SpO2 and breathing disturbance index |
| `summarize_recovery_state` | Aggregated readiness, HRV, sleep, stress, and cycle phase — primary entry point for coaching conversations |
| `correlate_training_and_recovery` | Pure computation: maps training load against recovery scores per day (requires pre-fetched Strava + Oura data) |
| `log_session_note` | Log a training debrief note with optional tags — stored locally |
| `get_session_notes` | Retrieve logged notes for a date range |
| `delete_session_note` | Remove a note before correcting it |

**For coaching and weekly check-ins, call `summarize_recovery_state` — it replaces separate calls to readiness, sleep, stress, and cycle endpoints.**

## Requirements

- Node.js v20+
- An Oura account with API access
- An Oura OAuth app with the following scopes: `personal`, `daily`, `heartrate`, `sleep`, `cycle`

## Setup

### 1. Get Oura API credentials

1. Go to the [Oura Developer Portal](https://cloud.ouraring.com/oauth/applications) and create an app.
2. Note your **Client ID** and **Client Secret**.
3. Complete the OAuth flow to obtain an **Access Token** and **Refresh Token**.

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
OURA_CLIENT_ID=your_client_id_here
OURA_CLIENT_SECRET=your_client_secret_here
OURA_ACCESS_TOKEN=your_access_token_here
OURA_REFRESH_TOKEN=your_refresh_token_here

# Optional
DEBUG=false                        # set to true for stderr + file logging
LOG_FILE=./oura-mcp-debug.log      # path for debug log output
```

### 3. Install and build

```bash
npm install
npm run build
```

### 4. Connect to your MCP client

Add the server to your MCP client config. For Claude Desktop, edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "oura": {
      "command": "node",
      "args": ["/absolute/path/to/oura-mcp/build/index.js"]
    }
  }
}
```

Restart your client. The Oura tools will be available immediately.

## Development

```bash
npm run dev      # watch mode — recompiles on save
npm run build    # production build to build/
npm run clean    # remove build/
```

### Project structure

```
src/
  index.ts           # MCP server entry point — tool registration
  oura-client.ts     # Oura API HTTP client with token refresh
  token-manager.ts   # OAuth token lifecycle
  notes-store.ts     # Local session notes (reads/writes ~/.oura-mcp/notes.json)
  logger.ts          # Debug logger (stderr + optional file)
  utils.ts           # Rolling averages, time formatting
  types.ts           # Oura API response interfaces
  tools/
    profile.ts       # get_personal_info
    sleep.ts         # get_sleep, get_hrv_trend
    biometrics.ts    # get_heart_rate, get_daily_spo2
    notes.ts         # log_session_note, get_session_notes, delete_session_note
    intelligence.ts  # summarize_recovery_state, correlate_training_and_recovery
```

### Adding a new tool

1. Add the Oura API response interface to `src/types.ts`
2. Implement the handler in the appropriate file under `src/tools/`
3. Register it in `src/index.ts` via `server.tool()`
4. Write a tool description that starts with the question it answers

### Critical constraints

- **`console.log` is forbidden** — it corrupts the MCP stdio protocol. Use `logger.debug()` for debug output or `console.error()` for startup messages.
- All tool handlers must catch errors and return human-readable strings — never throw to the MCP layer.
- `correlate_training_and_recovery` makes **zero API calls** — it is pure computation. Claude must pass pre-fetched data in.
- Notes tools (`log_session_note`, `get_session_notes`, `delete_session_note`) make **zero network calls** — they only read/write `~/.oura-mcp/notes.json`.

## Token refresh

The server handles token refresh automatically. When a request fails with a 401, `token-manager.ts` uses the refresh token to obtain a new access token and retries. Refreshed tokens are written back to `.env` so they persist across restarts.

## Session notes

Notes are stored locally at `~/.oura-mcp/notes.json` — nothing is sent to Oura or any external service. One note per date is enforced. Use `delete_session_note` before correcting an existing entry.

## Contributing

1. Fork the repo and create a feature branch.
2. Follow the project constraints above (no `console.log`, errors as return values, no unnecessary API calls).
3. Run `npm run build` to confirm the TypeScript compiles cleanly before opening a PR.
4. Open a PR with a description of what the change does and why.

Issues and PRs are welcome — especially for new Oura v2 endpoints not yet covered.

## License

MIT
