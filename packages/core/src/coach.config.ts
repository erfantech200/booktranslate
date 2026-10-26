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

  // ─── Training (spec §6) ─────────────────────────────────────────────────────────────────
  training: {
    // Mesocycle: 4 hard weeks, then a deload week; then a new mesocycle starts.
    mesocycleWeeks: 5,
    // Target reps in reserve for accumulation weeks 1–4: effort climbs as the block goes on.
    rirByWeek: [3, 2, 1.5, 1],
    // Isolation work in the last hard week may go to failure: low injury risk, small muscles.
    isolationRirLastWeek: 0,
    // A novice's first two weeks are technique weeks: easy loads (RIR 3–4), form first.
    techniqueWeeks: 2,
    techniqueRir: 3.5,
    // Deload: half the sets, same loads, very easy (spec §6). Lets fatigue drop without detraining.
    deload: { setFactor: 0.5, rir: 4 },
    // Novices start with stable, easy-to-learn variations; harder ones unlock per mesocycle.
    noviceMaxDifficultyByMesocycle: [1, 2, 3],

    // ─── Volume (hard sets per muscle per week; primary muscle = 1, secondary = 0.5) ───────
    startSetsPerMuscle: { novice: 10, intermediate: 12 }, // ~10 sets is enough to grow for beginners
    maxSetsPerMuscle: 20, // returns diminish and recovery suffers beyond ~20 sets
    minFrequencyPerMuscle: 2, // each muscle trained on at least 2 days a week
    baseSets: { main: 3, accessory: 3, isolation: 2 },
    maxSetsPerExercise: 5, // more than ~5 hard sets of one exercise adds fatigue faster than stimulus
    // Extra weekly sets per muscle in hard weeks 1–4, cumulative (+1–2 sets/muscle/week, spec §6).
    // Added to accessory and isolation work only, held while readiness is low, reset after the deload.
    rampSetsByWeek: [0, 2, 3, 4],

    // ─── Session time (spec §6) ────────────────────────────────────────────────────────────
    warmupMinutes: 8, // 5 min general warm-up + ramp-up sets
    minutesPerSet: { heavy: 4, other: 2.5 }, // per working set, rest included

    // ─── Reps (spec §6) ────────────────────────────────────────────────────────────────────
    mainRepRange: { novice: [6, 10], intermediate: [5, 8] } as Record<'novice' | 'intermediate', [number, number]>,
    accessoryRepRange: [8, 15] as [number, number],
    isolationRepRange: [10, 20] as [number, number],
    // Rest between sets: heavy compounds need 2–3 min to keep reps up; accessories 60–90 s.
    restSec: { heavy: 150, compound: 120, accessory: 90, isolation: 75 },

    // ─── Progression: double progression (spec §6) ────────────────────────────────────────
    increments: {
      barbellUpper: 2.5, // smallest common jump for bench/press (1.25 kg plates)
      barbellLower: 5, // legs and hinges tolerate bigger jumps
      dumbbellStep: 2, // next pair of dumbbells
      machineUpper: 2.5,
      machineLower: 5,
      cable: 2.5,
    },
    // Top of the range at a slightly lower RIR than prescribed still counts as "earned".
    rirTolerance: 1,
    reduceAfterSessionsBelowRange: 2, // two bad sessions in a row, not one off day
    reduceFraction: 0.075, // 5–10 % drop, then build back
    stallExposures: 3, // no e1RM gain in 3 exposures → suggest a variation swap next mesocycle
    e1rmMaxReps: 12, // Epley gets unreliable above ~12 reps
    emptyBarKg: 20,

    // ─── Warm-up ramp (spec §6): fraction of working weight × reps ────────────────────────
    warmupFirst: [[0.4, 8], [0.6, 5], [0.8, 3]] as [number, number][],
    warmupLater: [[0.6, 5], [0.8, 3]] as [number, number][],

    // ─── Readiness & early deload (spec §6) ────────────────────────────────────────────────
    readiness: {
      lowSleepHours: 6, // under 6 h of sleep measurably lowers strength and recovery
      lowEnergyAtMost: 2, // energy 1–5
      highSorenessAtLeast: 4, // soreness 1–5
      lowDaysForDeload: 5, // low readiness on 5 of the last 7 logged days ≈ "low for a week"
      holdRampLowDays: 3, // 3+ low days in the last week: recovery isn't good, don't add sets this week
    },
    earlyDeload: { regressingMainLifts: 2, sessions: 2 },

    // ─── Pain (spec §6) ────────────────────────────────────────────────────────────────────
    pain: {
      stopAt: 4, // pain ≥ 4/10 (or "sharp") stops the exercise and removes it until re-enabled
      recurringReports: 2, // 2 reports in the same body area …
      recurringWindowDays: 28, // … within 4 weeks → recommend a physiotherapist
    },
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
