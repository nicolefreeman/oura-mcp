import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import 'dotenv/config';

import { createTokenManager } from './token-manager.js';
import { OuraClient } from './oura-client.js';
import { NotesStore } from './notes-store.js';
import { logger } from './logger.js';
import {
  OuraAuthError,
  OuraForbiddenError,
  OuraNotFoundError,
  OuraValidationError,
  OuraAppUpdateError,
  OuraRateLimitError,
  OuraServerError,
} from './types.js';

import { getPersonalInfo } from './tools/profile.js';
import { getSleep, getHrvTrend } from './tools/sleep.js';
import { getHeartRate, getDailySpO2 } from './tools/biometrics.js';
import { logSessionNote, getSessionNotes, deleteSessionNote } from './tools/notes.js';
import { summarizeRecoveryState, correlateTrainingAndRecovery } from './tools/intelligence.js';

// 1. Validate required env vars
const required = ['OURA_CLIENT_ID', 'OURA_CLIENT_SECRET', 'OURA_ACCESS_TOKEN', 'OURA_REFRESH_TOKEN'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`[oura-mcp] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// 2–5. Initialise core modules
const tokenManager = createTokenManager();
const ouraClient = new OuraClient(tokenManager);
const notesStore = new NotesStore();

// 6. Create MCP server
const server = new McpServer({
  name: 'oura-mcp',
  version: '1.0.0',
});

// Error formatter — catches all known Oura errors and returns human-readable strings
function formatError(error: unknown): string {
  if (error instanceof OuraRateLimitError) {
    return 'Oura rate limit reached. Please wait a few minutes and try again.';
  }
  if (error instanceof OuraAuthError) {
    return 'Oura authentication failed. The access token may have expired or been revoked. Restart the MCP server to re-initialise from your .env file.';
  }
  if (error instanceof OuraForbiddenError) {
    return 'Oura access denied. Check that all required OAuth scopes were granted when authorising the app (personal, daily, heartrate, sleep, cycle).';
  }
  if (error instanceof OuraAppUpdateError) {
    return 'Oura app update required to access this data type. Update the Oura app on your phone and try again.';
  }
  if (error instanceof OuraNotFoundError) {
    return 'Oura resource not found. The requested data may not exist for this date range.';
  }
  if (error instanceof OuraValidationError) {
    return `Invalid request parameters: ${error.message}`;
  }
  if (error instanceof OuraServerError) {
    return 'Oura API is experiencing issues. Try again in a few minutes.';
  }
  if (error instanceof Error) {
    return `Unexpected error: ${error.message}`;
  }
  return 'An unknown error occurred.';
}

// 7. Register tools

server.tool(
  'get_personal_info',
  'What are this athlete\'s basic physical stats? Returns age, biological sex, height, and weight from the Oura profile. Use to personalise coaching context or confirm profile setup. Email is excluded from output.',
  {},
  async () => {
    logger.debug('Invoking tool: get_personal_info');
    try {
      const result = await getPersonalInfo(ouraClient);
      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      logger.error('get_personal_info failed', error);
      return { content: [{ type: 'text', text: formatError(error) }] };
    }
  }
);

server.tool(
  'get_sleep',
  'What were the detailed sleep metrics for each night in this date range? Returns full per-night breakdown including total duration, efficiency, latency, REM/deep/light/awake time, HRV, heart rate, SpO2, and bedtime window. Use when the full sleep detail is needed — for example, to understand a specific night in depth or analyse stage composition. For coaching check-ins and weekly recovery summaries, use summarize_recovery_state instead — it includes sleep data alongside readiness, HRV trend, stress, and cycle in a single call.',
  {
    start_date: z.string().describe('Start date in YYYY-MM-DD format'),
    end_date: z.string().describe('End date in YYYY-MM-DD format'),
  },
  async ({ start_date, end_date }) => {
    logger.debug('Invoking tool: get_sleep', { start_date, end_date });
    try {
      const result = await getSleep(ouraClient, start_date, end_date);
      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      logger.error('get_sleep failed', error);
      return { content: [{ type: 'text', text: formatError(error) }] };
    }
  }
);

server.tool(
  'get_hrv_trend',
  'What is this athlete\'s HRV trend over a date range? Returns per-night average HRV (RMSSD in ms), 7-day rolling average, deviation from 30-day baseline, and trend direction (Improving/Stable/Declining). Flags nights more than 10% below the rolling average with ⚠. Use when HRV trend is the specific focus — e.g. "show me my HRV over the last month". For coaching check-ins and weekly summaries, use summarize_recovery_state instead — it includes HRV trend alongside readiness, sleep, stress, and cycle in a single call.',
  {
    start_date: z.string().describe('Start date in YYYY-MM-DD format'),
    end_date: z.string().describe('End date in YYYY-MM-DD format'),
  },
  async ({ start_date, end_date }) => {
    logger.debug('Invoking tool: get_hrv_trend');
    try {
      const result = await getHrvTrend(ouraClient, start_date, end_date);
      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      logger.error('get_hrv_trend failed', error);
      return { content: [{ type: 'text', text: formatError(error) }] };
    }
  }
);

server.tool(
  'get_heart_rate',
  'What has this athlete\'s resting heart rate been over a date range? Summary mode (default) returns daily resting HR derived from sleep-source samples, 7-day average, and trend direction (Rising/Stable/Falling). Pass include_raw: true for the full 5-minute interval timeseries — note this is a large dataset. Use for cardiovascular trend analysis or to spot elevated resting HR indicating fatigue.',
  {
    start_date: z.string().describe('Start date in YYYY-MM-DD format'),
    end_date: z.string().describe('End date in YYYY-MM-DD format'),
    include_raw: z.boolean().optional().describe('Return full timestamped timeseries (default false — returns daily summary)'),
  },
  async ({ start_date, end_date, include_raw }) => {
    logger.debug('Invoking tool: get_heart_rate');
    try {
      const result = await getHeartRate(ouraClient, start_date, end_date, include_raw ?? false);
      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      logger.error('get_heart_rate failed', error);
      return { content: [{ type: 'text', text: formatError(error) }] };
    }
  }
);

server.tool(
  'get_daily_spo2',
  'What has this athlete\'s blood oxygen saturation (SpO2) been over a date range? Returns per-day average SpO2 percentage and breathing disturbance index. Days below 95% are flagged with ⚠. Use to screen for sleep-disordered breathing, altitude effects, or respiratory illness.',
  {
    start_date: z.string().describe('Start date in YYYY-MM-DD format'),
    end_date: z.string().describe('End date in YYYY-MM-DD format'),
  },
  async ({ start_date, end_date }) => {
    logger.debug('Invoking tool: get_daily_spo2');
    try {
      const result = await getDailySpO2(ouraClient, start_date, end_date);
      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      logger.error('get_daily_spo2 failed', error);
      return { content: [{ type: 'text', text: formatError(error) }] };
    }
  }
);

server.tool(
  'log_session_note',
  'Log a training session debrief note for a specific date. Stores free-text notes and optional tags (e.g. "hard", "felt-easy", "long-run") locally — no data sent externally. One note per date — will refuse to overwrite if a note already exists for that date. Use delete_session_note first to correct a mistake.',
  {
    date: z.string().describe('Date of the session in YYYY-MM-DD format'),
    note: z.string().describe('Free text session debrief'),
    tags: z.array(z.string()).optional().describe('Optional tags e.g. ["hard", "felt-easy", "long-run"]'),
  },
  async ({ date, note, tags }) => {
    logger.debug('Invoking tool: log_session_note');
    try {
      const result = logSessionNote(notesStore, date, note, tags ?? []);
      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      logger.error('log_session_note failed', error);
      return { content: [{ type: 'text', text: formatError(error) }] };
    }
  }
);

server.tool(
  'get_session_notes',
  'Retrieve logged training session notes for a date range. Returns all stored notes chronologically with their tags. Use before coaching decisions to include the athlete\'s subjective debrief alongside objective Oura data. Notes are stored locally — no network call made.',
  {
    start_date: z.string().describe('Start date in YYYY-MM-DD format'),
    end_date: z.string().describe('End date in YYYY-MM-DD format'),
  },
  async ({ start_date, end_date }) => {
    logger.debug('Invoking tool: get_session_notes');
    try {
      const result = getSessionNotes(notesStore, start_date, end_date);
      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      logger.error('get_session_notes failed', error);
      return { content: [{ type: 'text', text: formatError(error) }] };
    }
  }
);

server.tool(
  'delete_session_note',
  'Delete a logged training session note for a specific date. Use this to remove an incorrect note before re-logging it with log_session_note. Notes are stored locally — no network call made.',
  {
    date: z.string().describe('Date of the note to delete in YYYY-MM-DD format'),
  },
  async ({ date }) => {
    logger.debug('Invoking tool: delete_session_note');
    try {
      const result = deleteSessionNote(notesStore, date);
      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      logger.error('delete_session_note failed', error);
      return { content: [{ type: 'text', text: formatError(error) }] };
    }
  }
);

server.tool(
  'summarize_recovery_state',
  'What is this athlete\'s overall recovery state for a date range? Aggregates readiness scores, HRV trend, sleep quality, stress balance, and cycle phase (if available) into a single structured snapshot. This is the PRIMARY entry point for any coaching conversation or weekly check-in — it replaces separate calls to readiness, HRV, sleep, stress, and cycle tools. Call this instead of those individual tools. Returns an "Overall signal" line computed from flag count (0 flags = solid, 1–2 = mild pressure, 3+ = significant pressure).',
  {
    start_date: z.string().describe('Start date in YYYY-MM-DD format'),
    end_date: z.string().describe('End date in YYYY-MM-DD format'),
  },
  async ({ start_date, end_date }) => {
    logger.debug('Invoking tool: summarize_recovery_state');
    try {
      const result = await summarizeRecoveryState(ouraClient, start_date, end_date);
      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      logger.error('summarize_recovery_state failed', error);
      return { content: [{ type: 'text', text: formatError(error) }] };
    }
  }
);

server.tool(
  'correlate_training_and_recovery',
  'How well is this athlete\'s training load aligned with their recovery capacity? Pure computation tool — NO API calls. Claude must pass pre-fetched Strava training data and Oura recovery data as structured input. Returns per-day load score (0–10), recovery score (0–10), alignment flag (Well recovered / Appropriate / Pushing through / Undertraining / Rest day), perceived-effort divergence detection, and a pattern summary with recommendation cue. Always call summarize_recovery_state and fetch Strava activities BEFORE calling this tool — it requires both datasets as input.',
  {
    days: z.array(
      z.object({
        date: z.string().describe('YYYY-MM-DD'),
        training: z.object({
          distance_miles: z.number().optional(),
          duration_minutes: z.number().optional(),
          avg_heart_rate: z.number().optional(),
          suffer_score: z.number().optional(),
          perceived_effort: z.string().optional().describe('Tag from session note e.g. "felt-easy", "felt-hard"'),
        }).optional(),
        recovery: z.object({
          readiness_score: z.number().optional(),
          hrv_ms: z.number().optional(),
          hrv_vs_baseline_pct: z.number().optional().describe('Percentage deviation from baseline, e.g. -21.7 means 21.7% below'),
          sleep_score: z.number().optional(),
          stress_ratio: z.number().optional().describe('stress_high / recovery_high ratio'),
        }).optional(),
      })
    ).describe('Array of days with training and/or recovery data'),
  },
  async ({ days }) => {
    logger.debug('Invoking tool: correlate_training_and_recovery');
    try {
      const result = correlateTrainingAndRecovery(days);
      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      logger.error('correlate_training_and_recovery failed', error);
      return { content: [{ type: 'text', text: formatError(error) }] };
    }
  }
);

// 8. Connect transport and start
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[oura-mcp] Server started successfully');
