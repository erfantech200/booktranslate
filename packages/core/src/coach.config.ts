// Every tunable coaching constant lives here, each with the reason it has this value.
// The engine (src/engine/*) reads only from this file; the LLM never sets these numbers.

export const COACH = {
  // ─── Bodyweight gain targets (spec §1, §9) ──────────────────────────────────────────────
  gainRate: {
    // % of bodyweight per week. Untrained lifters can add lean mass fastest, so a larger surplus
    // still goes mostly to muscle; trained lifters need a smaller one to limit fat gain.
    novice: { min: 0.4, max: 0.5, default: 0.45 },
    intermediate: { min: 0.25, max: 0.35, default: 0.3 },
    // Bounds for a manual override: below ~0.1 %/week the surplus is too small to measure against
    // daily noise; above ~0.6 %/week most of the extra weight is fat, even for beginners.
    hardMin: 0.1,
    hardMax: 0.6,
    // Novice gains slow down after roughly six months of consistent training; the plan switches
    // to the intermediate rate from this week on.
    noviceWeeks: 26,
  },
  goal: {
    // The plan covers 12 months.
    horizonWeeks: 52,
  },

  // ─── Weigh-ins and trend (spec §10, §11) ────────────────────────────────────────────────
  weight: {
    // Daily weight swings 1–2 kg with water, glycogen and gut content; a 7-day average shows the trend.
    movingAverageDays: 7,
    // A weekly comparison needs at least 4 weigh-ins in the week to be meaningful.
    minWeighInsPerWeek: 4,
    // Don't extrapolate a trend from less than two weeks of data.
    projectionMinDays: 14,
    // Fit the trend to the last 4 weeks: recent enough to reflect the current calorie target.
    projectionWindowDays: 28,
  },

  // ─── Onboarding input bounds (sanity checks, not targets) ───────────────────────────────
  profile: {
    ageMin: 16, // programming and nutrition rules here assume an adult
    ageMax: 80,
    heightCmMin: 130,
    heightCmMax: 220,
    weightKgMin: 35,
    weightKgMax: 200,
    waistCmMin: 50,
    waistCmMax: 170,
    daysPerWeek: [3, 4, 5, 6] as const, // 3 = full body … 6 = push/pull/legs ×2 (spec §6)
    sessionMinutes: [45, 60, 75, 90] as const,
    mealsPerDay: [3, 4, 5, 6] as const, // protein spread over 3–5+ meals (spec §9)
  },

  // ─── Progress photos (spec §3, §10) ─────────────────────────────────────────────────────
  photos: {
    // Resized in the browser before upload: enough detail for comparison, small enough for the
    // 4.5 MB request limit, and re-encoding drops EXIF (location, device).
    maxLongSidePx: 1600,
    jpegQuality: 0.85,
    signedUrlSeconds: 600, // ≤ 10 min, as for every private file
  },

  // ─── Sign-in (spec §3) ──────────────────────────────────────────────────────────────────
  auth: {
    // 5 failed attempts per IP in 15 minutes: slows password guessing to a crawl, while a typo or
    // two never locks the owner out for long.
    maxFailures: 5,
    windowMinutes: 15,
    // A session stays valid while the app is used at least once a month (no logging in at the gym).
    sessionDays: 30,
  },

  // ─── Display ────────────────────────────────────────────────────────────────────────────
  display: {
    // Latin digits with tabular figures read faster on gym screens; Persian digits are optional.
    defaultDigits: 'latin' as 'latin' | 'persian',
  },
} as const;
