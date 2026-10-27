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

  // ─── Nutrition (spec §9) ────────────────────────────────────────────────────────────────
  nutrition: {
    // TDEE = BMR × factor. Base factor from daily activity outside training (Mifflin-St Jeor
    // multipliers), plus a little per weekly training day; clamped to the 1.4–1.7 range the spec gives.
    activityBase: { sedentary: 1.35, light: 1.45, active: 1.6 },
    perTrainingDay: 0.025, // a 60-min lifting session burns ≈ 200–300 kcal ≈ +0.025 of daily factor per weekly day
    activityMin: 1.4,
    activityMax: 1.75,
    surplusKcal: 300, // starting surplus; the weekly check-in (Phase 5) tunes it to the gain rate
    proteinGPerKg: 1.8, // muscle-gain sweet spot; range 1.6–2.2 g/kg
    proteinRangeGPerKg: [1.6, 2.2] as [number, number],
    proteinPerMealGPerKg: 0.4, // ≥ 0.4 g/kg per meal maximises muscle protein synthesis per sitting
    fatGPerKg: 0.9, // middle of 0.8–1.0 g/kg
    fatRangeGPerKg: [0.8, 1.0] as [number, number],
    fatMinPctKcal: 20, // below ~20 % of energy, hormone health and fat-soluble vitamins suffer
    fiberGPer1000Kcal: 14, // dietary guideline (14 g per 1000 kcal)
    waterMlPerKg: 35,
    waterTrainingMl: 500, // extra on training days for sweat losses
    kcalRounding: 10, // targets shown to the nearest 10 kcal
    plan: {
      kcalTolerancePct: 5, // each planned day within ±5 % kcal of target
      proteinTolerancePct: 10, // and ±10 % protein
      maxSameMealPerWeek: 2, // variety: no identical meal more than twice a week
      minProteinSourcesPerWeek: 4,
      minCarbSourcesPerWeek: 3, // rotate rice, bread, potatoes, oats, pasta, bulgur …
      minVegFruitServingsPerDay: 5,
      vegFruitServingG: 80, // one serving of vegetables or fruit
      scaleMin: 0.5, // portions are scaled to hit targets, never below half or above double
      scaleMax: 2,
      // Rough share of the day's kcal per meal slot, to guide the plan (code rescales anyway).
      slotShare: { breakfast: 0.25, lunch: 0.3, dinner: 0.3, snack: 0.1, shake: 0.15 },
    },
    // End-of-day nudge: after this local hour, protein under this share of target gets a note.
    nudgeAfterHour: 19,
    lowProteinNudgePct: 75,
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

  // ─── Progress tracking (spec §10) ───────────────────────────────────────────────────────
  progress: {
    measurementEveryDays: 14, // waist, chest, arm, thigh every 2 weeks: slower changes drown in noise
    photoDueDays: 14, // photos every 2–4 weeks: offered after 2 weeks …
    photoOverdueDays: 28, // … and flagged after 4
    // Gain quality ("muscle-vs-fat proxy"): waist growth per kg gained over the last 4 weeks.
    // Lean gain in men usually adds ≤ ~0.5 cm of waist per kg; more than ~1 cm/kg is mostly fat.
    qualityWindowDays: 28,
    qualityMinWeightChangeKg: 0.4, // smaller changes are within the weekly noise of the trend
    waistPerKgGood: 0.5,
    waistPerKgWatch: 1.0,
    // Strength over the same window, as the mean change of the main lifts' best e1RM.
    strengthFlatPct: 0, // strength holding or rising while weight rises supports lean gain
    // Adherence: a day "hits" protein at ≥ 90 % of target, calories within ±10 %.
    proteinHitPct: 90,
    kcalHitTolerancePct: 10,
    weightMilestoneKg: 2, // a timeline milestone every 2 kg of trend gain
    workoutMilestones: [1, 10, 25, 50, 100, 150, 200, 250],
    // Accepted tape measurements in cm (the database bounds; anything outside is a typo).
    measureCm: { waist: [40, 200], chest: [50, 200], arm: [15, 70], thigh: [30, 110] },
    strengthCharts: 6, // e1RM small multiples on the Strength screen: the most-trained main lifts
    volumeWeeks: 12, // weekly tonnage bars shown
    adherenceWeeks: 4, // adherence summarizes the last 4 weeks, the same window as gain quality
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
