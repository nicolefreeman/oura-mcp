// Compute rolling N-day average from array of { day, value } objects
// Returns same array with rollingAvg added to each entry
export const rollingAverage = (
  data: Array<{ day: string; value: number }>,
  windowDays: number
): Array<{ day: string; value: number; rollingAvg: number }> => {
  return data.map((entry, index) => {
    const start = Math.max(0, index - windowDays + 1);
    const window = data.slice(start, index + 1);
    const avg = window.reduce((sum, e) => sum + e.value, 0) / window.length;
    return { ...entry, rollingAvg: Math.round(avg * 10) / 10 };
  });
};

// Compute percentage deviation from a reference value
// e.g. value=52, reference=67 → "-22.4%"
export const deviationFromAverage = (value: number, reference: number): string => {
  const pct = ((value - reference) / reference) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
};

// Format seconds → "Xh Ym" string (e.g. 26580 → "7h 23m")
export const toHoursMinutes = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

// Format seconds → minutes integer (for stress display)
export const toMinutes = (seconds: number): number =>
  Math.round(seconds / 60);

// ISO date string for N days ago from today
export const daysAgo = (n: number): string =>
  new Date(Date.now() - n * 86400000).toISOString().split('T')[0];
