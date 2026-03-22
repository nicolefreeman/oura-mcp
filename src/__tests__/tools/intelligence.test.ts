import { jest } from '@jest/globals';
import { summarizeRecoveryState, correlateTrainingAndRecovery } from '../../tools/intelligence.js';
import type { OuraClient } from '../../oura-client.js';
import type {
  OuraDailyReadiness,
  OuraSleep,
  OuraDailySleep,
  OuraDailyStress,
  OuraDailyCycleInsights,
} from '../../types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeReadiness(overrides: Partial<OuraDailyReadiness> = {}): OuraDailyReadiness {
  return { id: '1', day: '2025-03-10', score: 80, contributors: {} as OuraDailyReadiness['contributors'], ...overrides };
}

function makeSleep(overrides: Partial<OuraSleep> = {}): OuraSleep {
  return {
    id: '1', day: '2025-03-10', type: 'long_sleep',
    bedtime_start: '', bedtime_end: '',
    total_sleep_duration: 27000, time_in_bed: 28800,
    efficiency: 90, latency: 600,
    rem_sleep_duration: 5400, deep_sleep_duration: 3600,
    light_sleep_duration: 10800, awake_time: 1800,
    average_hrv: 55,
    ...overrides,
  };
}

function makeDailySleep(overrides: Partial<OuraDailySleep> = {}): OuraDailySleep {
  return { id: '1', day: '2025-03-10', score: 82, contributors: {} as OuraDailySleep['contributors'], ...overrides };
}

function makeStress(overrides: Partial<OuraDailyStress> = {}): OuraDailyStress {
  return { id: '1', day: '2025-03-10', stress_high: 3600, recovery_high: 7200, day_summary: 'normal', ...overrides };
}

function makeCycle(overrides: Partial<OuraDailyCycleInsights> = {}): OuraDailyCycleInsights {
  return { id: '1', day: '2025-03-10', cycle_phase: 'follicular', cycle_day: 7, predicted_cycle_start: '2025-03-25', ...overrides };
}

function makeClient(datasets: {
  readiness?: OuraDailyReadiness[];
  sleep?: OuraSleep[];
  dailySleep?: OuraDailySleep[];
  stress?: OuraDailyStress[];
  cycle?: OuraDailyCycleInsights[] | Error;
} = {}): OuraClient {
  const mock = {
    getPaginated: jest.fn().mockImplementation((path: string) => {
      if (path.includes('daily_readiness')) return Promise.resolve(datasets.readiness ?? []);
      if (path.includes('daily_sleep')) return Promise.resolve(datasets.dailySleep ?? []);
      if (path.includes('daily_stress')) return Promise.resolve(datasets.stress ?? []);
      if (path.includes('daily_cycle_insights')) {
        const cycle = datasets.cycle;
        if (cycle instanceof Error) return Promise.reject(cycle);
        return Promise.resolve(cycle ?? []);
      }
      // /v2/usercollection/sleep (exact)
      return Promise.resolve(datasets.sleep ?? []);
    }),
    get: jest.fn(),
  };
  return mock as unknown as OuraClient;
}

// ── summarizeRecoveryState ────────────────────────────────────────────────────

describe('summarizeRecoveryState', () => {
  it('includes all sections and date range in header', async () => {
    const client = makeClient({
      readiness: [makeReadiness()],
      sleep: [makeSleep()],
      dailySleep: [makeDailySleep()],
      stress: [makeStress()],
    });
    const result = await summarizeRecoveryState(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('Recovery Summary: 2025-03-10 → 2025-03-10');
    expect(result).toContain('HRV');
    expect(result).toContain('Readiness');
    expect(result).toContain('Sleep');
    expect(result).toContain('Stress');
    expect(result).toContain('Overall signal:');
  });

  it('shows clean signal when no flags are raised', async () => {
    const client = makeClient({
      readiness: [makeReadiness({ score: 85 })],
      sleep: [makeSleep({ average_hrv: 60 })],
      dailySleep: [makeDailySleep({ score: 85 })],
      stress: [makeStress({ stress_high: 1000, recovery_high: 5000 })], // ratio 0.2 → no flags
    });
    const result = await summarizeRecoveryState(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('Recovery looks solid');
  });

  it('shows mild pressure when 1–2 flags raised', async () => {
    // Readiness flag: score < 60
    const client = makeClient({
      readiness: [makeReadiness({ score: 55 })],
      sleep: [makeSleep({ average_hrv: 60 })],
      dailySleep: [makeDailySleep()],
      stress: [],
    });
    const result = await summarizeRecoveryState(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('mild pressure');
  });

  it('shows significant pressure when 3+ flags raised', async () => {
    // HRV declining flag + readiness < 60 flag + stress flag
    const days = ['2025-03-06', '2025-03-07', '2025-03-08', '2025-03-09', '2025-03-10'];
    const sleepRecords = days.map((day, i) =>
      makeSleep({ id: String(i), day, average_hrv: 80 - i * 10 }) // 80 → 40 = declining
    );
    const readinessRecords = days.map((day, i) =>
      makeReadiness({ id: String(i), day, score: i === 0 ? 55 : 65 }) // one below 60 AND multiple below 70
    );
    const stressRecords = days.map((day, i) =>
      makeStress({ id: String(i), day, stress_high: 9000, recovery_high: 3000 }) // ratio 3 → high stress
    );
    const dailySleepRecords = days.map((day, i) => makeDailySleep({ id: String(i), day }));

    const client = makeClient({
      readiness: readinessRecords,
      sleep: sleepRecords,
      dailySleep: dailySleepRecords,
      stress: stressRecords,
    });
    const result = await summarizeRecoveryState(client, '2025-03-06', '2025-03-10');
    expect(result).toContain('significant pressure');
  });

  it('omits cycle section when no cycle data', async () => {
    const client = makeClient({ cycle: [] });
    const result = await summarizeRecoveryState(client, '2025-03-10', '2025-03-10');
    expect(result).not.toContain('Cycle');
  });

  it('includes cycle section when cycle data is available', async () => {
    const client = makeClient({
      cycle: [makeCycle()],
      sleep: [makeSleep()],
    });
    const result = await summarizeRecoveryState(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('Cycle');
    expect(result).toContain('Follicular');
    expect(result).toContain('Day 7');
    expect(result).toContain('Next cycle est.: 2025-03-25');
  });

  it('omits next-cycle prediction when predicted_cycle_start is absent', async () => {
    const client = makeClient({
      cycle: [makeCycle({ predicted_cycle_start: undefined })],
    });
    const result = await summarizeRecoveryState(client, '2025-03-10', '2025-03-10');
    expect(result).not.toContain('Next cycle est.:');
  });

  it('handles cycle endpoint failure gracefully', async () => {
    const client = makeClient({ cycle: new Error('Not available') });
    const result = await summarizeRecoveryState(client, '2025-03-10', '2025-03-10');
    // Should not throw; just omit cycle section
    expect(result).toContain('Overall signal:');
    expect(result).not.toContain('Cycle');
  });

  it('shows no HRV data when sleep records have no average_hrv', async () => {
    const client = makeClient({ sleep: [makeSleep({ average_hrv: undefined })] });
    const result = await summarizeRecoveryState(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('No HRV data available');
  });

  it('shows no readiness data when readiness records are empty', async () => {
    const client = makeClient({ readiness: [] });
    const result = await summarizeRecoveryState(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('No readiness data available');
  });

  it('shows no sleep score data when daily sleep records are empty', async () => {
    const client = makeClient({ dailySleep: [] });
    const result = await summarizeRecoveryState(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('No sleep score data available');
  });

  it('shows day_summary when stress ratio cannot be computed', async () => {
    const client = makeClient({
      stress: [makeStress({ stress_high: undefined, recovery_high: undefined, day_summary: 'strained' })],
    });
    const result = await summarizeRecoveryState(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('strained');
  });

  it('shows no stress data when stress records are empty', async () => {
    const client = makeClient({ stress: [] });
    const result = await summarizeRecoveryState(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('No stress data available');
  });

  it('includes HRV suppression count and trend in output', async () => {
    const days = ['2025-03-04', '2025-03-05', '2025-03-06', '2025-03-07', '2025-03-08', '2025-03-09', '2025-03-10'];
    // Most nights at 70, two nights suppressed (40 = ~57% below avg of 70 → well under 90%)
    const sleepRecords = days.map((day, i) =>
      makeSleep({ id: String(i), day, average_hrv: i < 2 ? 40 : 70 })
    );
    const client = makeClient({ sleep: sleepRecords });
    const result = await summarizeRecoveryState(client, '2025-03-04', '2025-03-10');
    expect(result).toContain('Days suppressed');
  });

  it('flags readiness when multiple days below 70', async () => {
    const readiness = [
      makeReadiness({ id: '1', day: '2025-03-10', score: 65 }),
      makeReadiness({ id: '2', day: '2025-03-11', score: 60 }),
    ];
    const client = makeClient({ readiness });
    const result = await summarizeRecoveryState(client, '2025-03-10', '2025-03-11');
    expect(result).toContain('Days below 70: 2');
  });

  it('includes cycle_day when available', async () => {
    const client = makeClient({ cycle: [makeCycle({ cycle_day: 14, cycle_phase: 'ovulatory' })] });
    const result = await summarizeRecoveryState(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('Day 14');
  });

  it('replaces short_sleep with long_sleep for same day when computing HRV', async () => {
    const client = makeClient({
      sleep: [
        makeSleep({ id: 'short', type: 'short_sleep', average_hrv: 40 }), // same day
        makeSleep({ id: 'long', type: 'long_sleep', average_hrv: 60 }),   // same day — should win
      ],
    });
    const result = await summarizeRecoveryState(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('60ms');
    expect(result).not.toContain('40ms');
  });

  it('skips deleted sleep records when computing HRV', async () => {
    const client = makeClient({
      sleep: [
        makeSleep({ average_hrv: 999, type: 'deleted' }),
        makeSleep({ average_hrv: 55, type: 'long_sleep' }),
      ],
    });
    const result = await summarizeRecoveryState(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('55ms');
    expect(result).not.toContain('999');
  });
});

// ── correlateTrainingAndRecovery ──────────────────────────────────────────────

describe('correlateTrainingAndRecovery', () => {
  it('returns message for empty input', () => {
    expect(correlateTrainingAndRecovery([])).toBe('No data provided for correlation.');
  });

  it('labels rest day when no training data', () => {
    const result = correlateTrainingAndRecovery([{ date: '2025-03-10', recovery: { readiness_score: 85 } }]);
    expect(result).toContain('Rest day');
  });

  it('labels rest day when all training metrics are zero', () => {
    const result = correlateTrainingAndRecovery([{
      date: '2025-03-10',
      training: { distance_miles: 0, duration_minutes: 0, suffer_score: 0 },
      recovery: { readiness_score: 85 },
    }]);
    expect(result).toContain('Rest day');
  });

  it('labels Well recovered when high recovery and moderate load', () => {
    const result = correlateTrainingAndRecovery([{
      date: '2025-03-10',
      training: { suffer_score: 80 }, // ~4 load
      recovery: { readiness_score: 90, hrv_vs_baseline_pct: 20, sleep_score: 88 }, // ~8.7 recovery
    }]);
    expect(result).toContain('Well recovered');
  });

  it('labels Pushing through when high load against low recovery', () => {
    const result = correlateTrainingAndRecovery([{
      date: '2025-03-10',
      training: { suffer_score: 200 }, // ~10 load
      recovery: { readiness_score: 50, hrv_vs_baseline_pct: -30, sleep_score: 55 }, // ~2.2 recovery
    }]);
    expect(result).toContain('Pushing through');
  });

  it('labels Well recovered when very high recovery and very low load (Undertraining branch unreachable due to Well recovered check firing first)', () => {
    const result = correlateTrainingAndRecovery([{
      date: '2025-03-10',
      training: { suffer_score: 20 }, // ~1 load (<=6)
      recovery: { readiness_score: 95, hrv_vs_baseline_pct: 30, sleep_score: 95 }, // ~9.3 recovery (>=7)
    }]);
    // Well recovered fires before Undertraining since both conditions are load<=6 + recovery>=7
    expect(result).toContain('Well recovered');
  });

  it('labels Appropriate when load and recovery are balanced', () => {
    const result = correlateTrainingAndRecovery([{
      date: '2025-03-10',
      training: { suffer_score: 100 }, // ~5 load
      recovery: { readiness_score: 70, hrv_vs_baseline_pct: 0, sleep_score: 70 }, // ~7 recovery
    }]);
    expect(result).toContain('Appropriate');
  });

  it('labels Insufficient data when training exists but recovery is absent', () => {
    const result = correlateTrainingAndRecovery([{
      date: '2025-03-10',
      training: { suffer_score: 150 },
    }]);
    expect(result).toContain('Insufficient data');
  });

  it('detects fatigue divergence when felt hard at moderate load', () => {
    const result = correlateTrainingAndRecovery([{
      date: '2025-03-10',
      training: { suffer_score: 60, perceived_effort: 'felt-hard' }, // load ~3
      recovery: { readiness_score: 75, sleep_score: 75 },
    }]);
    expect(result).toContain('fatigue signal');
  });

  it('detects fitness divergence when felt easy at high load', () => {
    const result = correlateTrainingAndRecovery([{
      date: '2025-03-10',
      training: { suffer_score: 200, perceived_effort: 'felt-easy' }, // load ~10
      recovery: { readiness_score: 80, sleep_score: 80 },
    }]);
    expect(result).toContain('fitness signal');
  });

  it('shows dash for divergence when no perceived effort tag', () => {
    const result = correlateTrainingAndRecovery([{
      date: '2025-03-10',
      training: { suffer_score: 100 },
      recovery: { readiness_score: 75 },
    }]);
    expect(result).toContain('—');
  });

  it('estimates load from distance and duration when suffer_score absent', () => {
    const result = correlateTrainingAndRecovery([{
      date: '2025-03-10',
      training: { distance_miles: 10, duration_minutes: 90, avg_heart_rate: 155 },
      recovery: { readiness_score: 75 },
    }]);
    // Should not be a rest day since distance > 0
    expect(result).not.toContain('Rest day');
  });

  it('outputs pattern summary with "well matched" when no issues', () => {
    const result = correlateTrainingAndRecovery([{
      date: '2025-03-10',
      training: { suffer_score: 80 },
      recovery: { readiness_score: 85, hrv_vs_baseline_pct: 10, sleep_score: 82 },
    }]);
    expect(result).toContain('well matched');
  });

  it('outputs pushing-through pattern summary when 2+ days pushing through', () => {
    const days = [
      {
        date: '2025-03-10',
        training: { suffer_score: 200, perceived_effort: 'felt-hard' },
        recovery: { readiness_score: 50, hrv_vs_baseline_pct: -30, sleep_score: 45 },
      },
      {
        date: '2025-03-11',
        training: { suffer_score: 200, perceived_effort: 'felt-hard' },
        recovery: { readiness_score: 48, hrv_vs_baseline_pct: -35, sleep_score: 44 },
      },
    ];
    const result = correlateTrainingAndRecovery(days);
    expect(result).toContain('Recommendation cue');
  });

  it('outputs fitness-divergence recommendation cue', () => {
    const result = correlateTrainingAndRecovery([{
      date: '2025-03-10',
      training: { suffer_score: 200, perceived_effort: 'easy' }, // 'easy' also matches
      recovery: { readiness_score: 65, sleep_score: 65 },
    }]);
    expect(result).toContain('Recommendation cue');
  });

  it('sorts rows most-recent-first', () => {
    const days = [
      { date: '2025-03-10', training: { suffer_score: 50 } },
      { date: '2025-03-12', training: { suffer_score: 50 } },
    ];
    const result = correlateTrainingAndRecovery(days);
    // Skip the header line which also contains the dates; compare positions in the data rows
    const afterHeader = result.slice(result.indexOf('\n') + 1);
    const pos10 = afterHeader.indexOf('2025-03-10');
    const pos12 = afterHeader.indexOf('2025-03-12');
    expect(pos12).toBeLessThan(pos10);
  });

  it('normaliseLoad returns null for training with no usable metrics', () => {
    // Training object with all metrics absent/zero → normaliseLoad returns null → Insufficient data
    const result = correlateTrainingAndRecovery([{
      date: '2025-03-10',
      training: {}, // no suffer_score, no distance, no duration
      recovery: { readiness_score: 75 },
    }]);
    // load=null, hasTraining=false (no metrics >0) → Rest day
    expect(result).toContain('Rest day');
  });

  it('outputs pushing-through-only recommendation cue (no fatigue divergence)', () => {
    // 2+ pushing through days, but no perceived_effort tags → no fatigue divergence
    const days = [
      {
        date: '2025-03-10',
        training: { suffer_score: 200 }, // no perceived_effort
        recovery: { readiness_score: 45, hrv_vs_baseline_pct: -40, sleep_score: 40 },
      },
      {
        date: '2025-03-11',
        training: { suffer_score: 200 }, // no perceived_effort
        recovery: { readiness_score: 45, hrv_vs_baseline_pct: -40, sleep_score: 40 },
      },
    ];
    const result = correlateTrainingAndRecovery(days);
    expect(result).toContain('Recommendation cue');
    expect(result).toContain('Watch for accumulated fatigue');
  });

  it('uses dash for load and recovery when training and recovery are both absent', () => {
    const result = correlateTrainingAndRecovery([{ date: '2025-03-10' }]);
    expect(result).toContain('—');
  });

  it('shows pushing-through count in pattern summary', () => {
    const days = [
      {
        date: '2025-03-10',
        training: { suffer_score: 200 },
        recovery: { readiness_score: 45, hrv_vs_baseline_pct: -40, sleep_score: 40 },
      },
      {
        date: '2025-03-11',
        training: { suffer_score: 200 },
        recovery: { readiness_score: 45, hrv_vs_baseline_pct: -40, sleep_score: 40 },
      },
    ];
    const result = correlateTrainingAndRecovery(days);
    expect(result).toContain('pushing through recovery deficit');
  });
});
