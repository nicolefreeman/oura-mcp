import { jest } from '@jest/globals';
import { getSleep, getHrvTrend } from '../../tools/sleep.js';
import type { OuraClient } from '../../oura-client.js';
import type { OuraSleep } from '../../types.js';

function makeClient(records: OuraSleep[]): OuraClient {
  return {
    getPaginated: jest.fn().mockResolvedValue(records),
    get: jest.fn(),
  } as unknown as OuraClient;
}

function makeSleepRecord(overrides: Partial<OuraSleep> = {}): OuraSleep {
  return {
    id: '1',
    day: '2025-03-10',
    bedtime_start: '2025-03-10T22:00:00+00:00',
    bedtime_end: '2025-03-11T06:00:00+00:00',
    total_sleep_duration: 27000, // 7h 30m
    time_in_bed: 28800,
    efficiency: 94,
    latency: 600, // 10m
    rem_sleep_duration: 5400,
    deep_sleep_duration: 3600,
    light_sleep_duration: 10800,
    awake_time: 1800,
    average_hrv: 52,
    lowest_heart_rate: 48,
    average_heart_rate: 56,
    average_spo2_percentage: 97.5,
    lowest_spo2_percentage: 94,
    type: 'long_sleep',
    ...overrides,
  };
}

// ── getSleep ─────────────────────────────────────────────────────────────────

describe('getSleep', () => {
  it('returns empty message when no records', async () => {
    const client = makeClient([]);
    const result = await getSleep(client, '2025-03-01', '2025-03-07');
    expect(result).toContain('No sleep records found');
    expect(result).toContain('2025-03-01');
  });

  it('formats a single night with all fields', async () => {
    const client = makeClient([makeSleepRecord()]);
    const result = await getSleep(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('2025-03-10');
    expect(result).toContain('7h 30m');
    expect(result).toContain('94%');       // efficiency
    expect(result).toContain('10m');       // latency
    expect(result).toContain('52ms');      // HRV
    expect(result).toContain('48bpm');     // lowest HR
    expect(result).toContain('97.5%');     // SpO2
    expect(result).toContain('94%');       // lowest SpO2
  });

  it('shows n/a for absent optional fields', async () => {
    const record = makeSleepRecord({
      average_hrv: undefined,
      lowest_heart_rate: undefined,
      average_spo2_percentage: undefined,
      lowest_spo2_percentage: undefined,
      efficiency: undefined,
      latency: undefined,
    });
    const client = makeClient([record]);
    const result = await getSleep(client, '2025-03-10', '2025-03-10');
    // All the n/a slots
    expect(result.match(/n\/a/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('prefers long_sleep record over short_sleep for the same day', async () => {
    const shortSleep = makeSleepRecord({ id: 'short', type: 'short_sleep', total_sleep_duration: 3600 });
    const longSleep = makeSleepRecord({ id: 'long', type: 'long_sleep', total_sleep_duration: 27000 });
    const client = makeClient([shortSleep, longSleep]);
    const result = await getSleep(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('7h 30m'); // long_sleep duration
  });

  it('skips deleted records', async () => {
    const deleted = makeSleepRecord({ type: 'deleted' });
    const client = makeClient([deleted]);
    const result = await getSleep(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('No sleep records found');
  });

  it('formats multiple nights in chronological order', async () => {
    const records = [
      makeSleepRecord({ id: '2', day: '2025-03-12', bedtime_start: '2025-03-12T22:00:00+00:00', bedtime_end: '2025-03-13T06:00:00+00:00' }),
      makeSleepRecord({ id: '1', day: '2025-03-10', bedtime_start: '2025-03-10T22:00:00+00:00', bedtime_end: '2025-03-11T06:00:00+00:00' }),
    ];
    const client = makeClient(records);
    const result = await getSleep(client, '2025-03-10', '2025-03-12');
    const pos10 = result.indexOf('2025-03-10');
    const pos12 = result.indexOf('2025-03-12');
    expect(pos10).toBeLessThan(pos12);
  });

  it('keeps short_sleep if no long_sleep exists for that day', async () => {
    const shortSleep = makeSleepRecord({ type: 'short_sleep', total_sleep_duration: 1800 });
    const client = makeClient([shortSleep]);
    const result = await getSleep(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('0h 30m');
  });

  it('does not replace an existing long_sleep with another record for the same day', async () => {
    const first = makeSleepRecord({ id: 'first', type: 'long_sleep', total_sleep_duration: 27000 });
    const second = makeSleepRecord({ id: 'second', type: 'short_sleep', total_sleep_duration: 7200 });
    const client = makeClient([first, second]);
    const result = await getSleep(client, '2025-03-10', '2025-03-10');
    // long_sleep should stay — its 7h 30m total should appear, not the short_sleep's 2h 0m
    expect(result).toContain('7h 30m');
    expect(result).not.toContain('2h 0m');
  });

  it('formats bedtime at midnight (12:00am) correctly using 12-hour clock', async () => {
    // hours=0, 0%12=0, 0||12=12 → "12:00am"  (TZ=UTC guaranteed by test script)
    const record = makeSleepRecord({
      bedtime_start: '2025-03-10T00:00:00+00:00',
      bedtime_end: '2025-03-10T08:00:00+00:00',
    });
    const client = makeClient([record]);
    const result = await getSleep(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('12:00am');
  });
});

// ── getHrvTrend ───────────────────────────────────────────────────────────────

describe('getHrvTrend', () => {
  it('returns empty message when no records', async () => {
    const client = makeClient([]);
    const result = await getHrvTrend(client, '2025-03-01', '2025-03-07');
    expect(result).toContain('No HRV data found');
  });

  it('returns empty message when records exist but all have no HRV', async () => {
    const record = makeSleepRecord({ average_hrv: undefined });
    const client = makeClient([record]);
    const result = await getHrvTrend(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('No HRV data found');
  });

  it('formats table header and summary row', async () => {
    const client = makeClient([makeSleepRecord({ average_hrv: 55 })]);
    const result = await getHrvTrend(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('Date');
    expect(result).toContain('HRV (ms)');
    expect(result).toContain('7-day Avg');
    expect(result).toContain('7-day average:');
    expect(result).toContain('30-day baseline:');
    expect(result).toContain('Trend:');
  });

  it('shows Stable trend when delta < 2ms', async () => {
    // Same HRV value every day → stable
    const records = ['2025-03-01', '2025-03-02', '2025-03-03', '2025-03-04', '2025-03-05'].map(
      (day, i) => makeSleepRecord({ id: String(i), day, average_hrv: 50 })
    );
    const client = makeClient(records);
    const result = await getHrvTrend(client, '2025-03-01', '2025-03-05');
    expect(result).toContain('Trend: Stable');
  });

  it('shows Improving trend when HRV increases significantly', async () => {
    const records = [
      makeSleepRecord({ id: '1', day: '2025-03-01', average_hrv: 40 }),
      makeSleepRecord({ id: '2', day: '2025-03-02', average_hrv: 50 }),
      makeSleepRecord({ id: '3', day: '2025-03-03', average_hrv: 60 }),
      makeSleepRecord({ id: '4', day: '2025-03-04', average_hrv: 70 }),
      makeSleepRecord({ id: '5', day: '2025-03-05', average_hrv: 80 }),
    ];
    const client = makeClient(records);
    const result = await getHrvTrend(client, '2025-03-01', '2025-03-05');
    expect(result).toContain('Trend: Improving');
  });

  it('shows Declining trend when HRV decreases significantly', async () => {
    const records = [
      makeSleepRecord({ id: '1', day: '2025-03-01', average_hrv: 80 }),
      makeSleepRecord({ id: '2', day: '2025-03-02', average_hrv: 70 }),
      makeSleepRecord({ id: '3', day: '2025-03-03', average_hrv: 60 }),
      makeSleepRecord({ id: '4', day: '2025-03-04', average_hrv: 50 }),
      makeSleepRecord({ id: '5', day: '2025-03-05', average_hrv: 40 }),
    ];
    const client = makeClient(records);
    const result = await getHrvTrend(client, '2025-03-01', '2025-03-05');
    expect(result).toContain('Trend: Declining');
  });

  it('flags nights more than 10% below baseline with warning', async () => {
    // baseline ~70, one night at 50 (well below 10%)
    const records = [
      makeSleepRecord({ id: '1', day: '2025-03-01', average_hrv: 70 }),
      makeSleepRecord({ id: '2', day: '2025-03-02', average_hrv: 70 }),
      makeSleepRecord({ id: '3', day: '2025-03-03', average_hrv: 70 }),
      makeSleepRecord({ id: '4', day: '2025-03-04', average_hrv: 70 }),
      makeSleepRecord({ id: '5', day: '2025-03-05', average_hrv: 50 }),
    ];
    const client = makeClient(records);
    const result = await getHrvTrend(client, '2025-03-01', '2025-03-05');
    expect(result).toContain('⚠');
  });

  it('skips deleted records', async () => {
    const deleted = makeSleepRecord({ type: 'deleted', average_hrv: 999 });
    const longSleep = makeSleepRecord({ type: 'long_sleep', average_hrv: 55 });
    const client = makeClient([deleted, longSleep]);
    const result = await getHrvTrend(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('55');
    expect(result).not.toContain('999');
  });

  it('replaces an existing short_sleep entry when a long_sleep arrives for the same day', async () => {
    const shortFirst = makeSleepRecord({ id: 'a', type: 'short_sleep', average_hrv: 40 });
    const longSecond = makeSleepRecord({ id: 'b', type: 'long_sleep', average_hrv: 60 });
    const client = makeClient([shortFirst, longSecond]);
    const result = await getHrvTrend(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('60');
    expect(result).not.toContain('40');
  });

  it('does not replace an existing long_sleep with a later record for the same day', async () => {
    const longFirst = makeSleepRecord({ id: 'a', type: 'long_sleep', average_hrv: 65 });
    const shortAfter = makeSleepRecord({ id: 'b', type: 'short_sleep', average_hrv: 22 });
    const client = makeClient([longFirst, shortAfter]);
    const result = await getHrvTrend(client, '2025-03-10', '2025-03-10');
    expect(result).toContain('65');
    expect(result).not.toContain('22ms');
  });
});
