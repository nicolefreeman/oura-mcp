import { OuraClient } from '../oura-client.js';
import {
  OuraDailyReadiness,
  OuraSleep,
  OuraDailySleep,
  OuraDailyStress,
  OuraDailyCycleInsights,
} from '../types.js';
import { rollingAverage, toHoursMinutes, toMinutes } from '../utils.js';
import { logger } from '../logger.js';

export async function summarizeRecoveryState(
  ouraClient: OuraClient,
  start_date: string,
  end_date: string
): Promise<string> {
  logger.debug('Tool: summarize_recovery_state', { start_date, end_date });

  // Fetch all endpoints in parallel
  const [readinessRecords, sleepRecords, dailySleepRecords, stressRecords, cycleRecords] =
    await Promise.all([
      ouraClient.getPaginated<OuraDailyReadiness>('/v2/usercollection/daily_readiness', {
        start_date,
        end_date,
      }),
      ouraClient.getPaginated<OuraSleep>('/v2/usercollection/sleep', {
        start_date,
        end_date,
      }),
      ouraClient.getPaginated<OuraDailySleep>('/v2/usercollection/daily_sleep', {
        start_date,
        end_date,
      }),
      ouraClient.getPaginated<OuraDailyStress>('/v2/usercollection/daily_stress', {
        start_date,
        end_date,
      }),
      ouraClient
        .getPaginated<OuraDailyCycleInsights>('/v2/usercollection/daily_cycle_insights', {
          start_date,
          end_date,
        })
        .catch(() => [] as OuraDailyCycleInsights[]), // cycle data may be unavailable — fail gracefully
    ]);

  const lines: string[] = [];
  lines.push(`Recovery Summary: ${start_date} → ${end_date}`);
  lines.push('');

  // ── HRV ──────────────────────────────────────────────────────────────
  const longSleepByDay = new Map<string, OuraSleep>();
  for (const r of sleepRecords) {
    if (r.type === 'deleted') continue;
    const existing = longSleepByDay.get(r.day);
    if (!existing) {
      longSleepByDay.set(r.day, r);
    } else if (existing.type !== 'long_sleep' && r.type === 'long_sleep') {
      longSleepByDay.set(r.day, r);
    }
  }

  const hrvPoints = Array.from(longSleepByDay.entries())
    .filter(([, r]) => r.average_hrv !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, r]) => ({ day, value: r.average_hrv! }));

  let hrvFlags = 0;
  if (hrvPoints.length > 0) {
    const with7Day = rollingAverage(hrvPoints, 7);
    const last = with7Day[with7Day.length - 1];
    const currentHrv = last.value;
    const sevenDayAvg = last.rollingAvg;

    // Days suppressed: >10% below their own 7-day rolling avg
    let suppressed = 0;
    for (const d of with7Day) {
      if (d.value < d.rollingAvg * 0.9) suppressed++;
    }
    if (suppressed >= 2) hrvFlags++;

    // Trend direction across window
    const firstAvg = with7Day[0]?.rollingAvg ?? sevenDayAvg;
    const delta = sevenDayAvg - firstAvg;
    const trend = Math.abs(delta) < 2 ? 'Stable' : delta > 0 ? 'Improving' : 'Declining';
    if (trend === 'Declining') hrvFlags++;

    lines.push('HRV');
    lines.push(
      `  Current: ${currentHrv}ms  |  7-day avg: ${sevenDayAvg}ms  |  Trend: ${trend}  |  Days suppressed (>10% below avg): ${suppressed}`
    );
  } else {
    lines.push('HRV');
    lines.push('  No HRV data available for this period.');
  }
  lines.push('');

  // ── Readiness ─────────────────────────────────────────────────────────
  let readinessFlags = 0;
  if (readinessRecords.length > 0) {
    const sorted = readinessRecords.sort((a, b) => a.day.localeCompare(b.day));
    const avg = Math.round(
      sorted.reduce((sum, r) => sum + r.score, 0) / sorted.length
    );
    const lowest = sorted.reduce((min, r) => (r.score < min.score ? r : min), sorted[0]);
    const daysBelow70 = sorted.filter((r) => r.score < 70).length;

    if (daysBelow70 >= 2) readinessFlags++;
    if (lowest.score < 60) readinessFlags++;

    lines.push('Readiness');
    lines.push(
      `  Average: ${avg}  |  Lowest: ${lowest.score} (${lowest.day})  |  Days below 70: ${daysBelow70}`
    );
  } else {
    lines.push('Readiness');
    lines.push('  No readiness data available for this period.');
  }
  lines.push('');

  // ── Sleep ─────────────────────────────────────────────────────────────
  if (dailySleepRecords.length > 0) {
    const avgScore = Math.round(
      dailySleepRecords.reduce((sum, r) => sum + r.score, 0) / dailySleepRecords.length
    );

    // Efficiency and duration from sleep session records
    const sleepSessions = Array.from(longSleepByDay.values());
    const avgEfficiency =
      sleepSessions.length > 0
        ? Math.round(
            sleepSessions.reduce((sum, r) => sum + (r.efficiency ?? 0), 0) / sleepSessions.length
          )
        : null;
    const avgDuration =
      sleepSessions.length > 0
        ? Math.round(
            sleepSessions.reduce((sum, r) => sum + r.total_sleep_duration, 0) / sleepSessions.length
          )
        : null;

    const effStr = avgEfficiency !== null ? `${avgEfficiency}%` : 'n/a';
    const durStr = avgDuration !== null ? toHoursMinutes(avgDuration) : 'n/a';

    lines.push('Sleep');
    lines.push(`  Avg score: ${avgScore}  |  Avg efficiency: ${effStr}  |  Avg duration: ${durStr}`);
  } else {
    lines.push('Sleep');
    lines.push('  No sleep score data available for this period.');
  }
  lines.push('');

  // ── Stress ────────────────────────────────────────────────────────────
  let stressFlags = 0;
  const stressWithBoth = stressRecords.filter(
    (r) => r.stress_high !== undefined && r.recovery_high !== undefined && r.recovery_high > 0
  );

  if (stressWithBoth.length > 0) {
    const ratios = stressWithBoth.map((r) => r.stress_high! / r.recovery_high!);
    const avgRatio = Math.round((ratios.reduce((sum, r) => sum + r, 0) / ratios.length) * 10) / 10;
    const highStressDays = stressWithBoth.filter((_, i) => ratios[i] > 1.5);

    if (highStressDays.length >= 2) stressFlags++;

    const highStressStr =
      highStressDays.length > 0
        ? `${highStressDays.length} (${highStressDays.map((d) => d.day).join(', ')})`
        : '0';

    lines.push('Stress');
    lines.push(
      `  Avg stress/recovery ratio: ${avgRatio}  |  High-stress days (>1.5): ${highStressStr}`
    );
  } else if (stressRecords.length > 0) {
    // Have stress records but can't compute ratio — show day summaries
    const latest = stressRecords.sort((a, b) => b.day.localeCompare(a.day))[0];
    lines.push('Stress');
    lines.push(
      `  Stress/recovery ratio unavailable. Latest day summary: ${latest.day_summary ?? 'unknown'}`
    );
  } else {
    lines.push('Stress');
    lines.push('  No stress data available for this period.');
  }
  lines.push('');

  // ── Cycle ─────────────────────────────────────────────────────────────
  const cycleData = (cycleRecords as OuraDailyCycleInsights[]).filter(
    (r) => r.cycle_phase !== undefined
  );

  if (cycleData.length > 0) {
    // Most recent record
    const latest = cycleData.sort((a, b) => b.day.localeCompare(a.day))[0];
    const phase =
      latest.cycle_phase
        ? latest.cycle_phase.charAt(0).toUpperCase() + latest.cycle_phase.slice(1)
        : 'Unknown';
    const dayNum = latest.cycle_day !== undefined ? ` (Day ${latest.cycle_day})` : '';
    const nextCycle = latest.predicted_cycle_start
      ? `  |  Next cycle est.: ${latest.predicted_cycle_start}`
      : '';

    lines.push('Cycle');
    lines.push(`  Current phase: ${phase}${dayNum}${nextCycle}`);
    lines.push('');
  }
  // If no cycle data — omit the section entirely (no error message)

  // ── Overall signal ────────────────────────────────────────────────────
  const totalFlags = hrvFlags + readinessFlags + stressFlags;
  let signal: string;
  if (totalFlags === 0) {
    signal = 'Recovery looks solid. Training stress is being absorbed well.';
  } else if (totalFlags <= 2) {
    const flagDetails: string[] = [];
    if (hrvFlags > 0) flagDetails.push('HRV declining or suppressed');
    if (readinessFlags > 0) flagDetails.push('low-readiness days');
    if (stressFlags > 0) flagDetails.push('elevated stress days');
    signal = `⚠ Recovery under mild pressure. ${flagDetails.join(', ')}. Consider reducing intensity or adding recovery before next hard session.`;
  } else {
    const flagDetails: string[] = [];
    if (hrvFlags > 0) flagDetails.push('HRV declining or suppressed');
    if (readinessFlags > 0) flagDetails.push('multiple low-readiness days');
    if (stressFlags > 0) flagDetails.push('multiple high-stress days');
    signal = `⚠ Recovery under significant pressure. ${flagDetails.join(', ')}. Recommend reducing load and prioritising recovery.`;
  }

  lines.push(`Overall signal: ${signal}`);

  return lines.join('\n');
}

// ── correlate_training_and_recovery ──────────────────────────────────────
// Pure computation — NO API calls. Claude passes pre-fetched data as input.

interface TrainingDay {
  distance_miles?: number;
  duration_minutes?: number;
  avg_heart_rate?: number;
  suffer_score?: number;
  perceived_effort?: string;
}

interface RecoveryDay {
  readiness_score?: number;
  hrv_ms?: number;
  hrv_vs_baseline_pct?: number;
  sleep_score?: number;
  stress_ratio?: number;
}

interface DayInput {
  date: string;
  training?: TrainingDay;
  recovery?: RecoveryDay;
}

function normaliseLoad(t?: TrainingDay): number | null {
  if (!t) return null;

  // Use suffer_score as primary load signal (Strava scale is typically 0–300+)
  if (t.suffer_score !== undefined && t.suffer_score > 0) {
    return Math.min(10, Math.round((t.suffer_score / 200) * 10 * 10) / 10);
  }

  // Estimate from distance + HR if suffer_score absent
  if (t.distance_miles !== undefined || t.duration_minutes !== undefined) {
    const distComponent = (t.distance_miles ?? 0) / 15; // ~15 miles = high load
    const durComponent = (t.duration_minutes ?? 0) / 120; // ~120 min = high load
    const hrComponent =
      t.avg_heart_rate !== undefined ? Math.max(0, (t.avg_heart_rate - 120) / 60) : 0;
    const raw = (distComponent + durComponent + hrComponent) / 3;
    return Math.min(10, Math.round(raw * 10 * 10) / 10);
  }

  return null;
}

function normaliseRecovery(r?: RecoveryDay): number | null {
  if (!r) return null;

  const components: number[] = [];

  if (r.readiness_score !== undefined) {
    components.push(r.readiness_score / 10); // 0–100 → 0–10
  }
  if (r.hrv_ms !== undefined || r.hrv_vs_baseline_pct !== undefined) {
    // HRV vs baseline: 0% → 5 (neutral), +20% → 7, -20% → 3
    const pct = r.hrv_vs_baseline_pct ?? 0;
    const score = Math.max(0, Math.min(10, 5 + pct / 10));
    components.push(score);
  }
  if (r.sleep_score !== undefined) {
    components.push(r.sleep_score / 10); // 0–100 → 0–10
  }

  if (components.length === 0) return null;
  return Math.round((components.reduce((sum, c) => sum + c, 0) / components.length) * 10) / 10;
}

function alignmentFlag(
  load: number | null,
  recovery: number | null,
  hasTraining: boolean
): string {
  if (!hasTraining || load === null || load < 0.5) return 'Rest day';
  if (recovery === null) return 'Insufficient data';
  if (recovery >= 7 && load <= 6) return 'Well recovered';
  if (recovery < 6 && load >= 7) return 'Pushing through';
  if (recovery >= 8 && load <= 3) return 'Undertraining';
  return 'Appropriate';
}

function perceivedDivergence(
  perceived?: string,
  load?: number | null
): string {
  if (!perceived || load === null || load === undefined) return '—';
  const tag = perceived.toLowerCase();
  if ((tag.includes('easy') || tag.includes('felt-easy')) && load !== null && load >= 7) {
    return '⚠ Felt easy at high load → fitness signal';
  }
  if ((tag.includes('hard') || tag.includes('felt-hard')) && load !== null && load <= 4) {
    return '⚠ Felt hard at moderate load → fatigue signal';
  }
  return '—';
}

export function correlateTrainingAndRecovery(days: DayInput[]): string {
  logger.debug('Tool: correlate_training_and_recovery', { days: days.length });

  if (days.length === 0) {
    return 'No data provided for correlation.';
  }

  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const startDate = sorted[0].date;
  const endDate = sorted[sorted.length - 1].date;

  const header = `Training ↔ Recovery Correlation: ${startDate} → ${endDate}\n`;
  const tableHeader = `${'Date'.padEnd(12)}${'Load'.padEnd(6)}${'Recovery'.padEnd(10)}${'Alignment'.padEnd(19)}Divergence`;

  const rows: string[] = [];
  let pushingThroughCount = 0;
  let fatigueDivergenceCount = 0;
  let fitnessDivergenceCount = 0;

  for (const day of sorted) {
    const load = normaliseLoad(day.training);
    const recovery = normaliseRecovery(day.recovery);
    const hasTraining = !!(day.training && (
      (day.training.distance_miles ?? 0) > 0 ||
      (day.training.duration_minutes ?? 0) > 0 ||
      (day.training.suffer_score ?? 0) > 0
    ));

    const alignment = alignmentFlag(load, recovery, hasTraining);
    const divergence = perceivedDivergence(day.training?.perceived_effort, load);

    if (alignment === 'Pushing through') pushingThroughCount++;
    if (divergence.includes('fatigue')) fatigueDivergenceCount++;
    if (divergence.includes('fitness')) fitnessDivergenceCount++;

    const loadStr = load !== null ? String(load) : '—';
    const recStr = recovery !== null ? String(recovery) : '—';

    rows.push(
      `${day.date.padEnd(12)}${loadStr.padEnd(6)}${recStr.padEnd(10)}${alignment.padEnd(19)}${divergence}`
    );
  }

  // Reverse for most-recent-first display
  rows.reverse();

  const patternLines: string[] = ['\nPattern summary:'];
  if (pushingThroughCount > 0) {
    patternLines.push(`  ${pushingThroughCount} day(s) pushing through recovery deficit`);
  }
  if (fatigueDivergenceCount > 0) {
    patternLines.push(
      `  ${fatigueDivergenceCount} perceived-effort divergence(s) suggesting accumulated fatigue (felt hard at moderate load)`
    );
  }
  if (fitnessDivergenceCount > 0) {
    patternLines.push(
      `  ${fitnessDivergenceCount} positive divergence(s) suggesting fitness adaptation (felt easy at high load)`
    );
  }
  if (pushingThroughCount === 0 && fatigueDivergenceCount === 0 && fitnessDivergenceCount === 0) {
    patternLines.push('  Training load and recovery well matched across this period.');
  }

  // Recommendation cue (reasoning prompt for Claude — not for verbatim display to user)
  let recCue = '';
  if (pushingThroughCount >= 2 && fatigueDivergenceCount >= 1) {
    recCue =
      '\nRecommendation cue: Multiple consecutive high-load days against declining recovery, combined with perceived fatigue, suggests reduced readiness for another hard session. A consolidation day is indicated.';
  } else if (pushingThroughCount >= 2) {
    recCue =
      '\nRecommendation cue: Two or more high-load days pushed against a recovery deficit. Watch for accumulated fatigue before scheduling the next hard effort.';
  } else if (fitnessDivergenceCount >= 1) {
    recCue =
      '\nRecommendation cue: Positive perceived-effort divergence detected — athlete performing better than load metrics suggest. May indicate fitness adaptation; consider whether training stimulus is sufficient.';
  }

  return [
    header,
    tableHeader,
    ...rows,
    ...patternLines,
    recCue,
  ]
    .join('\n')
    .trimEnd();
}
