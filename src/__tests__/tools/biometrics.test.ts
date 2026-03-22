import { jest } from '@jest/globals';
import { getHeartRate, getDailySpO2 } from '../../tools/biometrics.js';
import type { OuraClient } from '../../oura-client.js';
import type { OuraHeartRate, OuraDailySpO2 } from '../../types.js';

function makeClient(records: unknown[]): OuraClient {
  return {
    getPaginated: jest.fn().mockResolvedValue(records),
    get: jest.fn(),
  } as unknown as OuraClient;
}

// ── getHeartRate ──────────────────────────────────────────────────────────────

function makeSample(overrides: Partial<OuraHeartRate> = {}): OuraHeartRate {
  return { bpm: 55, source: 'sleep', timestamp: '2025-03-10T02:00:00+00:00', ...overrides };
}

describe('getHeartRate', () => {
  it('returns empty message when no samples', async () => {
    const client = makeClient([]);
    const result = await getHeartRate(client, '2025-03-01', '2025-03-07', false);
    expect(result).toContain('No heart rate data found');
  });

  it('returns raw timeseries with warning when include_raw is true', async () => {
    const samples = [
      makeSample({ bpm: 60, source: 'awake', timestamp: '2025-03-10T08:00:00+00:00' }),
      makeSample({ bpm: 52, source: 'sleep', timestamp: '2025-03-10T02:00:00+00:00' }),
    ];
    const client = makeClient(samples);
    const result = await getHeartRate(client, '2025-03-10', '2025-03-10', true);
    expect(result).toContain('raw HR timeseries');
    expect(result).toContain('60 bpm');
    expect(result).toContain('52 bpm');
    expect(result).toContain('[awake]');
    expect(result).toContain('[sleep]');
  });

  it('summary mode uses minimum bpm per day from sleep sources', async () => {
    const samples = [
      makeSample({ bpm: 58, source: 'sleep', timestamp: '2025-03-10T01:00:00+00:00' }),
      makeSample({ bpm: 52, source: 'sleep', timestamp: '2025-03-10T03:00:00+00:00' }),
      makeSample({ bpm: 80, source: 'awake', timestamp: '2025-03-10T09:00:00+00:00' }),
    ];
    const client = makeClient(samples);
    const result = await getHeartRate(client, '2025-03-10', '2025-03-10', false);
    // Should use 52 (minimum from sleep source), not 58 or 80
    expect(result).toContain('52 bpm');
    expect(result).not.toContain('58 bpm');
    expect(result).not.toContain('80 bpm');
  });

  it('falls back to all sources when no sleep-source samples exist', async () => {
    const samples = [
      makeSample({ bpm: 70, source: 'awake', timestamp: '2025-03-10T08:00:00+00:00' }),
      makeSample({ bpm: 65, source: 'rest', timestamp: '2025-03-10T14:00:00+00:00' }),
    ];
    const client = makeClient(samples);
    const result = await getHeartRate(client, '2025-03-10', '2025-03-10', false);
    // Should use minimum across all sources = 65
    expect(result).toContain('65 bpm');
  });

  it('shows summary header, daily rows, and trend summary', async () => {
    const samples = [
      makeSample({ bpm: 54, timestamp: '2025-03-10T02:00:00+00:00' }),
    ];
    const client = makeClient(samples);
    const result = await getHeartRate(client, '2025-03-10', '2025-03-10', false);
    expect(result).toContain('Date');
    expect(result).toContain('Resting HR');
    expect(result).toContain('7-day resting HR average:');
    expect(result).toContain('Trend:');
  });

  it('shows Stable trend when change is less than 3bpm', async () => {
    // Same bpm every day = 0 delta → Stable
    const samples = [
      makeSample({ bpm: 54, timestamp: '2025-03-10T02:00:00+00:00' }),
      makeSample({ bpm: 55, timestamp: '2025-03-11T02:00:00+00:00' }),
    ];
    const client = makeClient(samples);
    const result = await getHeartRate(client, '2025-03-10', '2025-03-11', false);
    expect(result).toContain('Trend: Stable');
  });

  it('shows Rising trend when HR increases by 3+ bpm', async () => {
    const samples = [
      makeSample({ bpm: 50, timestamp: '2025-03-10T02:00:00+00:00' }),
      makeSample({ bpm: 60, timestamp: '2025-03-11T02:00:00+00:00' }),
    ];
    const client = makeClient(samples);
    const result = await getHeartRate(client, '2025-03-10', '2025-03-11', false);
    expect(result).toContain('Trend: Rising');
  });

  it('shows Falling trend when HR decreases by 3+ bpm', async () => {
    const samples = [
      makeSample({ bpm: 65, timestamp: '2025-03-10T02:00:00+00:00' }),
      makeSample({ bpm: 55, timestamp: '2025-03-11T02:00:00+00:00' }),
    ];
    const client = makeClient(samples);
    const result = await getHeartRate(client, '2025-03-10', '2025-03-11', false);
    expect(result).toContain('Trend: Falling');
  });

  it('formats diff as positive when HR is above average', async () => {
    const samples = [
      makeSample({ bpm: 50, timestamp: '2025-03-10T02:00:00+00:00' }),
      makeSample({ bpm: 70, timestamp: '2025-03-11T02:00:00+00:00' }),
    ];
    const client = makeClient(samples);
    const result = await getHeartRate(client, '2025-03-10', '2025-03-11', false);
    expect(result).toContain('+');
  });
});

// ── getDailySpO2 ──────────────────────────────────────────────────────────────

function makeSpO2(overrides: Partial<OuraDailySpO2> = {}): OuraDailySpO2 {
  return { id: '1', day: '2025-03-10', spo2_percentage: { average: 97.5 }, breathing_disturbance_index: 5, ...overrides };
}

describe('getDailySpO2', () => {
  it('returns empty message when no records', async () => {
    const client = makeClient([]);
    const result = await getDailySpO2(client, '2025-03-01', '2025-03-07');
    expect(result).toContain('No SpO2 data found');
  });

  it('formats table with date, SpO2, and BDI label', async () => {
    const client = makeClient([makeSpO2()]);
    const result = await getDailySpO2(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('2025-03-10');
    expect(result).toContain('97.5%');
    expect(result).toContain('Low'); // BDI of 5 → Low
  });

  it('flags SpO2 below 95% with warning symbol', async () => {
    const client = makeClient([makeSpO2({ spo2_percentage: { average: 93.0 } })]);
    const result = await getDailySpO2(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('⚠');
  });

  it('does not flag SpO2 at or above 95%', async () => {
    const client = makeClient([makeSpO2({ spo2_percentage: { average: 95.0 } })]);
    const result = await getDailySpO2(client, '2025-03-10', '2025-03-10');
    expect(result).not.toContain('⚠');
  });

  it('shows n/a when spo2_percentage is absent', async () => {
    const client = makeClient([makeSpO2({ spo2_percentage: undefined })]);
    const result = await getDailySpO2(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('n/a');
  });

  it('labels BDI as Moderate when between 10 and 19', async () => {
    const client = makeClient([makeSpO2({ breathing_disturbance_index: 15 })]);
    const result = await getDailySpO2(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('Moderate');
  });

  it('labels BDI as High when 20 or above', async () => {
    const client = makeClient([makeSpO2({ breathing_disturbance_index: 25 })]);
    const result = await getDailySpO2(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('High');
  });

  it('labels BDI as n/a when undefined', async () => {
    const client = makeClient([makeSpO2({ breathing_disturbance_index: undefined })]);
    const result = await getDailySpO2(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('n/a');
  });

  it('orders rows most-recent-first', async () => {
    const records = [
      makeSpO2({ id: '1', day: '2025-03-10' }),
      makeSpO2({ id: '2', day: '2025-03-12' }),
    ];
    const client = makeClient(records);
    const result = await getDailySpO2(client, '2025-03-10', '2025-03-12');
    const pos10 = result.indexOf('2025-03-10');
    const pos12 = result.indexOf('2025-03-12');
    // Most recent first → 2025-03-12 appears before 2025-03-10
    expect(pos12).toBeLessThan(pos10);
  });
});
