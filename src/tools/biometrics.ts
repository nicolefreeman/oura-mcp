import { OuraClient } from '../oura-client.js';
import { OuraHeartRate, OuraDailySpO2 } from '../types.js';
import { logger } from '../logger.js';

// Derive YYYY-MM-DD date from a timestamp string
function dateOf(timestamp: string): string {
  return timestamp.split('T')[0];
}

export async function getHeartRate(
  ouraClient: OuraClient,
  start_date: string,
  end_date: string,
  include_raw: boolean
): Promise<string> {
  logger.debug('Tool: get_heart_rate', { start_date, end_date, include_raw });

  // Oura heartrate endpoint uses start_datetime / end_datetime
  const start_datetime = `${start_date}T00:00:00`;
  const end_datetime = `${end_date}T23:59:59`;

  const samples = await ouraClient.getPaginated<OuraHeartRate>('/v2/usercollection/heartrate', {
    start_datetime,
    end_datetime,
  });

  if (samples.length === 0) {
    return `No heart rate data found between ${start_date} and ${end_date}.`;
  }

  if (include_raw) {
    const warning =
      'Note: raw HR timeseries returned — this is a large dataset. Consider using summary mode for trend analysis.\n';
    const rows = samples.map(
      (s) => `${s.timestamp}  ${s.bpm} bpm  [${s.source}]`
    );
    return warning + rows.join('\n');
  }

  // Summary mode: daily resting HR from sleep-source samples
  const sleepSamples = samples.filter((s) => s.source === 'sleep');

  // Group by date and find minimum bpm (resting HR) per day
  const byDay = new Map<string, number>();
  for (const s of sleepSamples) {
    const day = dateOf(s.timestamp);
    const existing = byDay.get(day);
    if (existing === undefined || s.bpm < existing) {
      byDay.set(day, s.bpm);
    }
  }

  // Fall back to all samples if no sleep-source samples exist
  if (byDay.size === 0) {
    for (const s of samples) {
      const day = dateOf(s.timestamp);
      const existing = byDay.get(day);
      if (existing === undefined || s.bpm < existing) {
        byDay.set(day, s.bpm);
      }
    }
  }

  const days = Array.from(byDay.keys()).sort();
  if (days.length === 0) {
    return `No resting heart rate data found between ${start_date} and ${end_date}.`;
  }

  // 7-day rolling average
  const hrValues = days.map((day) => ({ day, value: byDay.get(day)! }));
  const recentWindow = hrValues.slice(-7);
  const sevenDayAvg = recentWindow.reduce((sum, d) => sum + d.value, 0) / recentWindow.length;
  const roundedAvg = Math.round(sevenDayAvg * 10) / 10;

  // Trend direction: compare first and last value in 7-day window
  const firstVal = recentWindow[0]?.value ?? sevenDayAvg;
  const lastVal = recentWindow[recentWindow.length - 1]?.value ?? sevenDayAvg;
  const delta = lastVal - firstVal;
  const trend = Math.abs(delta) < 3 ? 'Stable' : delta > 0 ? 'Rising' : 'Falling';

  const header = `Date        Resting HR   vs 7-day Avg`;
  const rows = days.map((day) => {
    const hr = byDay.get(day)!;
    const diff = Math.round(hr - sevenDayAvg);
    const diffStr = diff >= 0 ? `+${diff} bpm` : `${diff} bpm`;
    return `${day.padEnd(12)}${`${hr} bpm`.padEnd(13)}${diffStr}`;
  });

  // Most recent first
  rows.reverse();

  const summary = `7-day resting HR average: ${roundedAvg} bpm  |  Trend: ${trend}`;

  return [header, ...rows, summary].join('\n');
}

export async function getDailySpO2(
  ouraClient: OuraClient,
  start_date: string,
  end_date: string
): Promise<string> {
  logger.debug('Tool: get_daily_spo2', { start_date, end_date });

  const records = await ouraClient.getPaginated<OuraDailySpO2>('/v2/usercollection/daily_spo2', {
    start_date,
    end_date,
  });

  if (records.length === 0) {
    return `No SpO2 data found between ${start_date} and ${end_date}.`;
  }

  const days = records.sort((a, b) => a.day.localeCompare(b.day));

  function bdiLabel(bdi?: number): string {
    if (bdi === undefined) return 'n/a';
    if (bdi < 10) return 'Low';
    if (bdi < 20) return 'Moderate';
    return 'High';
  }

  const header = `Date        Avg SpO2   Breathing Disturbance`;
  const rows = days.map((d) => {
    const avg = d.spo2_percentage?.average;
    const avgStr = avg !== undefined ? `${avg.toFixed(1)}%` : 'n/a';
    const flag = avg !== undefined && avg < 95 ? ' ⚠' : '';
    const bdi = bdiLabel(d.breathing_disturbance_index);
    return `${d.day.padEnd(12)}${`${avgStr}${flag}`.padEnd(11)}${bdi}`;
  });

  // Most recent first
  rows.reverse();

  return [header, ...rows].join('\n');
}
