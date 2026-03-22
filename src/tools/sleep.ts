import { OuraClient } from '../oura-client.js';
import { OuraSleep } from '../types.js';
import { toHoursMinutes, rollingAverage, deviationFromAverage } from '../utils.js';
import { logger } from '../logger.js';

// Format a local time string from an ISO datetime (e.g. "2025-03-18T22:42:00+00:00" → "10:42pm")
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  return `${hours}:${minutes.toString().padStart(2, '0')}${ampm}`;
}

// Short weekday name for a YYYY-MM-DD date string
function weekday(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

export async function getSleep(
  ouraClient: OuraClient,
  start_date: string,
  end_date: string
): Promise<string> {
  logger.debug('Tool: get_sleep', { start_date, end_date });

  const records = await ouraClient.getPaginated<OuraSleep>('/v2/usercollection/sleep', {
    start_date,
    end_date,
  });

  // Group records by day — prefer long_sleep, fall back to short_sleep
  const byDay = new Map<string, OuraSleep>();
  for (const record of records) {
    if (record.type === 'deleted') continue;
    const existing = byDay.get(record.day);
    if (!existing) {
      byDay.set(record.day, record);
    } else if (existing.type !== 'long_sleep' && record.type === 'long_sleep') {
      byDay.set(record.day, record);
    }
  }

  if (byDay.size === 0) {
    return `No sleep records found between ${start_date} and ${end_date}.`;
  }

  const days = Array.from(byDay.keys()).sort();
  const lines: string[] = [];

  for (const day of days) {
    const r = byDay.get(day)!;
    const label = `${day} (${weekday(day)})`;
    lines.push(label);

    const efficiency = r.efficiency !== undefined ? `${r.efficiency}%` : 'n/a';
    const latencyMin = r.latency !== undefined ? `${Math.round(r.latency / 60)}m` : 'n/a';
    lines.push(
      `  Total sleep:  ${toHoursMinutes(r.total_sleep_duration)}  |  Efficiency: ${efficiency}  |  Latency: ${latencyMin}`
    );

    const rem = toHoursMinutes(r.rem_sleep_duration);
    const deep = toHoursMinutes(r.deep_sleep_duration);
    const light = toHoursMinutes(r.light_sleep_duration);
    const awake = toHoursMinutes(r.awake_time);
    lines.push(`  REM:          ${rem}  |  Deep: ${deep}  |  Light: ${light}  |  Awake: ${awake}`);

    const hrv = r.average_hrv !== undefined ? `${r.average_hrv}ms` : 'n/a';
    const lowestHR = r.lowest_heart_rate !== undefined ? `${r.lowest_heart_rate}bpm` : 'n/a';
    const avgSpo2 =
      r.average_spo2_percentage !== undefined ? `${r.average_spo2_percentage.toFixed(1)}%` : 'n/a';
    const lowestSpo2 =
      r.lowest_spo2_percentage !== undefined ? `${r.lowest_spo2_percentage}%` : 'n/a';
    lines.push(
      `  Avg HRV:      ${hrv}  |  Lowest HR: ${lowestHR}  |  Avg SpO2: ${avgSpo2}  |  Lowest SpO2: ${lowestSpo2}`
    );

    const bedtime = formatTime(r.bedtime_start);
    const wake = formatTime(r.bedtime_end);
    lines.push(`  Bedtime:      ${bedtime}  |  Wake: ${wake}`);
    lines.push('');
  }

  // Remove trailing blank line
  if (lines[lines.length - 1] === '') lines.pop();

  return lines.join('\n');
}

export async function getHrvTrend(
  ouraClient: OuraClient,
  start_date: string,
  end_date: string
): Promise<string> {
  logger.debug('Tool: get_hrv_trend', { start_date, end_date });

  const records = await ouraClient.getPaginated<OuraSleep>('/v2/usercollection/sleep', {
    start_date,
    end_date,
  });

  // Group by day — prefer long_sleep, fall back to short_sleep
  const byDay = new Map<string, OuraSleep>();
  for (const record of records) {
    if (record.type === 'deleted') continue;
    const existing = byDay.get(record.day);
    if (!existing) {
      byDay.set(record.day, record);
    } else if (existing.type !== 'long_sleep' && record.type === 'long_sleep') {
      byDay.set(record.day, record);
    }
  }

  // Build chronological array of days with HRV values
  const days = Array.from(byDay.keys()).sort();
  const hrvPoints = days
    .filter((day) => byDay.get(day)!.average_hrv !== undefined)
    .map((day) => ({ day, value: byDay.get(day)!.average_hrv! }));

  if (hrvPoints.length === 0) {
    return `No HRV data found between ${start_date} and ${end_date}.`;
  }

  // Compute rolling averages
  const with7Day = rollingAverage(hrvPoints, 7);
  const with30Day = rollingAverage(hrvPoints, 30);

  // Build a lookup for 30-day rolling avg by day
  const baseline30Map = new Map(with30Day.map((d) => [d.day, d.rollingAvg]));

  // Overall 7-day avg = last entry's rollingAvg from the 7-day window
  const last7Avg = with7Day[with7Day.length - 1]?.rollingAvg ?? 0;
  // 30-day baseline = last entry's 30-day rollingAvg
  const baseline30 = baseline30Map.get(with7Day[with7Day.length - 1]?.day) ?? last7Avg;

  // Trend direction: compare first and last 7-day avg
  const firstAvg = with7Day[0]?.rollingAvg ?? last7Avg;
  const delta = last7Avg - firstAvg;
  const trend = Math.abs(delta) < 2 ? 'Stable' : delta > 0 ? 'Improving' : 'Declining';

  const header = `Date        HRV (ms)   7-day Avg   vs Baseline`;
  const rows = with7Day.map((d) => {
    const baseline = baseline30Map.get(d.day) ?? d.rollingAvg;
    const dev = deviationFromAverage(d.value, baseline);
    const pctNum = ((d.value - baseline) / baseline) * 100;
    const flag = pctNum < -10 ? ' ⚠' : '';
    const dateCol = d.day.padEnd(12);
    const hrvCol = `${d.value}${flag}`.padEnd(11);
    const avgCol = String(d.rollingAvg).padEnd(12);
    return `${dateCol}${hrvCol}${avgCol}${dev}`;
  });

  // Reverse to show most recent first
  rows.reverse();

  const summary = `7-day average: ${last7Avg}ms  |  30-day baseline: ${baseline30}ms  |  Trend: ${trend}`;

  return [header, ...rows, summary].join('\n');
}
