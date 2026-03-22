// Oura API response envelope — all collection endpoints use this shape
export interface OuraResponse<T> {
  data: T[];
  next_token?: string; // cursor for next page; absent when no more data
}

// Daily Readiness
export interface OuraDailyReadiness {
  id: string;
  day: string; // "YYYY-MM-DD"
  score: number; // 0–100
  temperature_deviation?: number; // °C deviation from baseline
  contributors: {
    activity_balance: number; // contributor scores 1–100
    body_temperature: number;
    hrv_balance: number;
    previous_day_activity: number;
    previous_night: number;
    recovery_index: number;
    resting_heart_rate: number;
    sleep_balance: number;
  };
}

// Sleep session (detailed nightly record)
export interface OuraSleep {
  id: string;
  day: string;
  bedtime_start: string; // ISO datetime
  bedtime_end: string;
  total_sleep_duration: number; // seconds
  time_in_bed: number; // seconds
  efficiency: number; // percentage 0–100
  latency: number; // seconds to fall asleep
  rem_sleep_duration: number; // seconds
  deep_sleep_duration: number; // seconds
  light_sleep_duration: number; // seconds
  awake_time: number; // seconds
  average_hrv?: number; // RMSSD in ms — key coaching signal
  lowest_heart_rate?: number; // bpm
  average_heart_rate?: number; // bpm
  average_breath?: number; // breaths per minute
  average_spo2_percentage?: number;
  lowest_spo2_percentage?: number;
  type: 'long_sleep' | 'short_sleep' | 'rest' | 'deleted';
}

// Daily Sleep Score (rolled-up, separate from the session record)
export interface OuraDailySleep {
  id: string;
  day: string;
  score: number; // 0–100
  contributors: {
    deep_sleep: number;
    efficiency: number;
    latency: number;
    rem_sleep: number;
    restfulness: number;
    timing: number;
    total_sleep: number;
  };
}

// Heart rate sample (5-min interval)
export interface OuraHeartRate {
  bpm: number;
  source: 'awake' | 'rest' | 'sleep' | 'session' | 'live' | 'auto';
  timestamp: string; // ISO datetime
}

// Daily SpO2
export interface OuraDailySpO2 {
  id: string;
  day: string;
  spo2_percentage?: { average: number };
  breathing_disturbance_index?: number;
}

// Daily Stress
// NOTE: stress_high and recovery_high are in SECONDS — convert to minutes for display
export interface OuraDailyStress {
  id: string;
  day: string;
  stress_high?: number; // seconds of high stress — convert to minutes
  recovery_high?: number; // seconds of high recovery — convert to minutes
  day_summary?: 'restored' | 'normal' | 'strained' | 'challenging';
}

// Cycle Insights
export interface OuraDailyCycleInsights {
  id: string;
  day: string;
  cycle_day?: number;
  cycle_phase?: 'menstrual' | 'follicular' | 'ovulatory' | 'luteal';
  pregnant?: boolean;
  predicted_cycle_start?: string; // ISO date "YYYY-MM-DD"
}

// Personal Info
export interface OuraPersonalInfo {
  id: string;
  age?: number;
  weight?: number; // kg
  height?: number; // metres
  biological_sex?: 'male' | 'female';
  email?: string; // fetched but EXCLUDED from tool output
}

// Custom error classes
export class OuraAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OuraAuthError';
  }
}

export class OuraForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OuraForbiddenError';
  }
}

export class OuraNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OuraNotFoundError';
  }
}

export class OuraValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OuraValidationError';
  }
}

export class OuraAppUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OuraAppUpdateError';
  }
}

export class OuraRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OuraRateLimitError';
  }
}

export class OuraServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OuraServerError';
  }
}
