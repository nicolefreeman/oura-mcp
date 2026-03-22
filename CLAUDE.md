# oura-mcp

MCP server wrapping the Oura Ring API v2. TypeScript, Node.js v20+, stdio transport.

## Key constraints
- `console.log` is FORBIDDEN — it corrupts the MCP stdio protocol. Use `logger.debug()` or `console.error()` only.
- All secrets come from `.env` via dotenv. Never hardcode tokens.
- All tool handlers must catch errors and return human-readable strings — never throw to the MCP layer.
- Notes tools (log/get/delete) make NO network calls. They only read/write ~/.oura-mcp/notes.json via NotesStore.
- `get_hrv_trend` and `get_sleep` both call the same Oura `/sleep` endpoint. The difference is what they return: get_hrv_trend extracts only average_hrv and computes rolling averages; get_sleep returns the full per-night breakdown.

## Tool routing rules (critical for avoiding redundant calls)
- `summarize_recovery_state` is the primary entry point for any coaching or weekly check-in conversation. It internally calls readiness, sleep, stress, and cycle endpoints. Do NOT call those individual endpoints separately and then also call summarize — pick one path.
- `get_readiness`, `get_daily_sleep`, `get_daily_stress`, `get_cycle_insights` do NOT exist as standalone tools in this codebase. Their data is returned by `summarize_recovery_state`. If you are tempted to create them, stop — they were intentionally removed to reduce token overhead.
- `correlate_training_and_recovery` makes ZERO API calls. It is a pure computation function. Never add ouraClient calls inside it.

## Build
`npm run build` — compiles to `build/`. Run with `node build/index.js`.

## Adding a new tool
1. Add the Oura API response interface to `src/types.ts`
2. Implement the handler in the appropriate file under `src/tools/`
3. Register in `src/index.ts` via `server.tool()`
4. Write a tool description that starts with the question it answers

## Critical: stdout is reserved for MCP
Only the MCP SDK writes to stdout. All other output (logs, debug, errors) must go to stderr.

## Intelligence layer tools (src/tools/intelligence.ts)
- `summarize_recovery_state` calls MULTIPLE Oura endpoints internally (readiness, sleep, daily_sleep, daily_stress, cycle_insights). It is the preferred entry point for coaching conversations — do not duplicate its work by also calling those individual tools.
- `correlate_training_and_recovery` makes NO API calls. It is a pure computation function. Claude must pass in pre-fetched Strava and Oura data as structured input. Never call it without both datasets in context.
- The `Recommendation cue` field in correlate output is a reasoning prompt for Claude, not a user-facing string.
