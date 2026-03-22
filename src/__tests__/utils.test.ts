import { jest } from '@jest/globals';
import { rollingAverage, deviationFromAverage, toHoursMinutes, toMinutes, daysAgo } from '../utils.js';

describe('rollingAverage', () => {
  it('returns empty array for empty input', () => {
    expect(rollingAverage([], 7)).toEqual([]);
  });

  it('single element has rollingAvg equal to its own value', () => {
    const result = rollingAverage([{ day: '2025-01-01', value: 50 }], 7);
    expect(result).toEqual([{ day: '2025-01-01', value: 50, rollingAvg: 50 }]);
  });

  it('computes rolling average over full window when data exceeds window size', () => {
    const data = [
      { day: '2025-01-01', value: 10 },
      { day: '2025-01-02', value: 20 },
      { day: '2025-01-03', value: 30 },
      { day: '2025-01-04', value: 40 },
    ];
    const result = rollingAverage(data, 3);
    // Index 0: avg of [10] = 10
    // Index 1: avg of [10,20] = 15
    // Index 2: avg of [10,20,30] = 20
    // Index 3: avg of [20,30,40] = 30
    expect(result[0].rollingAvg).toBe(10);
    expect(result[1].rollingAvg).toBe(15);
    expect(result[2].rollingAvg).toBe(20);
    expect(result[3].rollingAvg).toBe(30);
  });

  it('window larger than data uses all available entries', () => {
    const data = [
      { day: '2025-01-01', value: 60 },
      { day: '2025-01-02', value: 80 },
    ];
    const result = rollingAverage(data, 30);
    expect(result[0].rollingAvg).toBe(60);
    expect(result[1].rollingAvg).toBe(70);
  });

  it('rounds to one decimal place', () => {
    const data = [
      { day: '2025-01-01', value: 1 },
      { day: '2025-01-02', value: 2 },
      { day: '2025-01-03', value: 3 },
    ];
    const result = rollingAverage(data, 2);
    // Index 1: avg of [1,2] = 1.5
    expect(result[1].rollingAvg).toBe(1.5);
    // Index 2: avg of [2,3] = 2.5
    expect(result[2].rollingAvg).toBe(2.5);
  });

  it('preserves original day and value fields', () => {
    const data = [{ day: '2025-03-01', value: 42 }];
    const result = rollingAverage(data, 7);
    expect(result[0].day).toBe('2025-03-01');
    expect(result[0].value).toBe(42);
  });
});

describe('deviationFromAverage', () => {
  it('returns +0.0% when value equals reference', () => {
    expect(deviationFromAverage(50, 50)).toBe('+0.0%');
  });

  it('returns positive percentage when value is above reference', () => {
    expect(deviationFromAverage(75, 50)).toBe('+50.0%');
  });

  it('returns negative percentage when value is below reference', () => {
    expect(deviationFromAverage(40, 50)).toBe('-20.0%');
  });

  it('rounds to one decimal place', () => {
    expect(deviationFromAverage(52, 67)).toBe('-22.4%');
  });
});

describe('toHoursMinutes', () => {
  it('converts seconds to hours and minutes', () => {
    expect(toHoursMinutes(26580)).toBe('7h 23m');
  });

  it('handles exact hours with zero minutes', () => {
    expect(toHoursMinutes(7200)).toBe('2h 0m');
  });

  it('handles zero seconds', () => {
    expect(toHoursMinutes(0)).toBe('0h 0m');
  });

  it('handles seconds less than one hour', () => {
    expect(toHoursMinutes(2700)).toBe('0h 45m');
  });
});

describe('toMinutes', () => {
  it('converts seconds to minutes', () => {
    expect(toMinutes(3600)).toBe(60);
  });

  it('rounds to nearest minute', () => {
    expect(toMinutes(90)).toBe(2);
    expect(toMinutes(30)).toBe(1);
  });

  it('handles zero', () => {
    expect(toMinutes(0)).toBe(0);
  });
});

describe('daysAgo', () => {
  it('returns a string in YYYY-MM-DD format', () => {
    const result = daysAgo(7);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a date in the past', () => {
    const today = new Date().toISOString().split('T')[0];
    const result = daysAgo(1);
    expect(result < today).toBe(true);
  });

  it('returns todays date when n is 0', () => {
    const today = new Date().toISOString().split('T')[0];
    expect(daysAgo(0)).toBe(today);
  });
});
