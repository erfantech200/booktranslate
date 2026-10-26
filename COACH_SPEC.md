# Claude Code Prompt — Rebuild "Book Translator" into a Personal Strength & Nutrition Coach

> How to use: put this file in the repo root as `COACH_SPEC.md`, then tell Claude Code:
> "Read COACH_SPEC.md and start with Phase 0." (Or paste everything below `---` directly.)

---

## 0. Context

This repo is currently a book-translation web app (built yesterday, already deployed). **The infrastructure stays; the product is replaced.** Hosting, domain, database, ORM/migrations, file storage, auth plumbing, env vars and the OpenAI API key are all set up and working. Reuse them. Do not re-provision anything.

Replace the entire product with a **private, single-user personal coach** for me (Erfan): evidence-based strength training programs, a varied nutrition plan, daily logging, progress photos, progress analytics and an AI coach — all in one app that only I can access.

**My goal:** maximize muscle gain over 12 months. I'd like 10–15 kg of muscle, but the app must be honest: an untrained man gaining naturally builds roughly 8–11 kg of lean mass in year one under ideal conditions. So the app targets **bodyweight gain at a rate that maximizes the lean-mass share** and tracks muscle-vs-fat proxies (waist, strength, photos). Never display a fabricated "kg of muscle gained" number — show bodyweight change plus the proxies.

Top priorities, in order:
1. **Safety & correctness** — programming must follow established standards (ACSM resistance-training guidelines, current hypertrophy research). No injuries.
2. **Nutrition control** — hit calorie/protein targets with genuinely varied food.
3. **Engaging UX** — I should *want* to open it every day and follow my progress.

---

## 1. Hard constraints

- Reuse the existing stack (framework, DB, ORM, storage, hosting, auth). Don't swap frameworks or add infra unless something is truly missing; if so, explain why first.
- Don't rename or remove existing env vars that hosting depends on. If new env vars are needed, add them to `.env.example` and list them in your phase report.
- Work on branch `rebuild/coach`; commit at the end of every phase with a clear message.
- **Destructive DB operations** (dropping the translator tables) must be in their own migration. Before running it against production, show me the table list with row counts and wait for my explicit "yes".
- All tunable coaching constants live in ONE config file (e.g. `coach.config.ts` or the stack's equivalent), each with a one-line comment explaining the rationale. No magic numbers scattered in code.
- **Deterministic engine, LLM for language.** Every number that matters (calories, macros, sets, reps, loads, progression, deloads, adjustments) is computed in code by the rules below. The LLM explains, writes content, chooses foods/meals within constraints and chats — it never sets training or nutrition numbers outside engine bounds.
- Code and comments in English. UI and all AI-generated user-facing text in **Persian (RTL)**.

---

## 2. Phase 0 — Audit & cleanup (stop and report before cleanup)

1. Audit the repo and write `docs/AUDIT.md`: framework and version, DB and ORM, migration tool, auth method, storage provider, hosting/deploy config, env vars in use (names only), OpenAI models currently used, existing tables with row counts.
2. Produce a removal plan: translator routes, components, API handlers, workers/queues, PDF/OCR logic, dependencies that become unused, DB tables.
3. **Stop and show me the audit + plan.** After my OK: remove translator code and unused deps, add the drop-tables migration (waiting for the production confirmation above), and confirm the app still builds and deploys as an empty authenticated shell.

---

## 3. Auth & privacy (single owner)

- Exactly one user. No signup route, no password reset by email, no multi-user code paths. Delete any existing registration flow.
- Credentials: reuse the existing auth system if present; otherwise `OWNER_EMAIL` + `OWNER_PASSWORD_HASH` (argon2/bcrypt) from env.
- Session: httpOnly, Secure, SameSite=Lax cookie, 30-day rolling expiry (I don't want to log in at the gym).
- Login rate limiting (e.g. 5 attempts / 15 min / IP).
- Every page and API route requires auth server-side.
- `robots.txt` disallow all, `<meta name="robots" content="noindex,nofollow">`, and `X-Robots-Tag: noindex` header.
- Progress photos: private bucket/folder, served only via short-lived signed URLs, EXIF metadata stripped on upload, never publicly addressable.

---

## 4. Language, design & feel

- Persian UI, full RTL, font **Vazirmatn** (self-hosted or Google Fonts). Weights/reps/numbers in Latin digits with tabular numerals for gym readability (configurable).
- Exercise names shown as Persian + English (e.g. «اسکات با هالتر — Barbell Back Squat»), since gym terms are usually English.
- Dark theme by default (light theme available), one energetic accent color, generous spacing, smooth micro-animations. Modern fitness-app quality, not an admin panel.
- Mobile-first PWA (installable, home-screen icon, works one-handed); also good on desktop.
- Bottom tab navigation: **Today · Workout · Nutrition · Progress · Coach**.
- **Gym mode** during an active workout: big tap targets, high contrast, Screen Wake Lock API to keep the screen on, haptic feedback (`navigator.vibrate`) on set completion, rest timer with sound + notification.
- Resilience: an in-progress workout is saved locally as I log each set and synced to the server, so a lost connection or app reload never loses data.

---

## 5. Onboarding & profile

Multi-step onboarding (editable later in Settings):
- Age, sex, height, current weight, waist circumference (at navel), optional chest/arm/thigh.
- Training experience: none / < 6 months / 6–24 months / 2+ years.
- Where I train: commercial gym / home (list equipment: barbell, rack, bench, dumbbells with range, cables, machines, pull-up bar, bands).
- Days per week (3–6) and session length (45 / 60 / 75 / 90 min); preferred training days.
- Injuries, joint pain, medical conditions (free text + body-area checklist: shoulder, elbow, wrist, lower back, hip, knee, ankle). If any cardiovascular condition or high blood pressure is reported, show a recommendation to get medical clearance before starting.
- Daily activity outside training (sedentary / light / active job).
- Food: cuisines I like (Persian by default), foods I dislike, allergies/intolerances, dietary rules, cooking time per day, budget level, meals per day (3–6), appetite (low / normal / high).
- Goal settings: target rate of gain (default from engine), 12-month bodyweight target.
- Baseline progress photos (front / side / back) with an on-screen pose and lighting guide.

---

## 6. Training engine (deterministic)

### Program structure by frequency
- 3 days → Full body A / B / C
- 4 days → Upper / Lower ×2
- 5 days → Upper / Lower / Push / Pull / Legs
- 6 days → Push / Pull / Legs ×2
- Fit each session to the chosen session length (estimate ~2.5 min per working set incl. rest for accessories, ~4 min for heavy compounds, + warm-up).

### Exercise selection rules
- Every week covers all movement patterns: squat, hip hinge, horizontal push, vertical push, horizontal pull, vertical pull, lunge/single-leg, core; plus direct arm, rear-delt, calf work.
- Weekly pulling sets ≥ pushing sets (shoulder health).
- 1–2 main compound lifts per session first, then accessories.
- Filter by available equipment and by contraindications from reported injuries (e.g. reported lower-back pain → no conventional deadlift or good mornings initially; use hip thrust, back extension, RDL with light load only if pain-free).
- Beginners get stable, easier-to-learn variations first (goblet squat, DB bench, machine/cable rows, leg press) and progress to barbell variations as technique is confirmed.

### Volume
- Count hard sets per muscle per week (primary muscle = 1 set, secondary = 0.5).
- Each muscle trained ≥ 2×/week.
- Start novices at ~10 sets/muscle/week; ramp +1–2 sets per muscle per week through a mesocycle when recovery is good, capped at ~20; reset to the starting volume after a deload.

### Intensity & reps
- Main compounds: 5–8 or 6–10 reps. Accessories: 8–15. Isolation/small muscles: 10–20.
- Effort via RIR (reps in reserve). Mesocycle wave: week 1 = 3 RIR, week 2 = 2, week 3 = 1–2, week 4 = 1 (isolation may reach 0), then deload.
- **First 2 weeks for a novice are technique weeks**: RIR 3–4, moderate loads, focus on form cues.
- Rest: heavy compounds 2–3 min, accessories 60–90 s (rest timer pre-set per exercise).

### Starting loads
- First exposure to an exercise is a calibration session: I pick a weight I can do for the target reps with ~3 RIR; the app learns from logged sets. Never prescribe absolute loads from bodyweight formulas.

### Progression (double progression)
- Each exercise has a rep range. When all working sets reach the top of the range at the target RIR → next session increases load by the smallest sensible increment (upper body +2.5 kg, lower body +5 kg, dumbbells → next pair; configurable for my equipment).
- If reps fall below the bottom of the range two sessions in a row → reduce load 5–10%.
- Stall detection: no estimated-1RM improvement over 3 exposures → flag it and suggest a variation swap at the next mesocycle.
- e1RM formula: Epley `w × (1 + reps/30)`, only for sets of ≤ 12 reps.

### Warm-up
- Auto-generated: 5 min general warm-up + ramp-up sets for the first compound (≈ 40%×8, 60%×5, 80%×3 of the working weight). Shorter ramp for subsequent compounds.

### Deload & autoregulation
- Deload every 5th week by default (or 4–6, configurable): ~50% of sets, same loads, RIR 4.
- Early deload triggered if 2+ main lifts regress for 2 sessions, or readiness scores stay low for a week.
- Optional daily readiness check (sleep hours, energy 1–5, soreness 1–5). Low readiness → suggest dropping the last set of each exercise that day.

### Pain handling
- Any exercise can be logged with pain 0–10. Pain ≥ 4 or "sharp" → the app tells me to stop that exercise, offers a regression or substitute, and excludes it from the next sessions until I re-enable it. Recurring pain in the same area → recommend seeing a physiotherapist.
- Red flags (chest pain, dizziness, numbness, sudden sharp joint pain) → stop training immediately and seek medical care. Hard-coded message, not LLM-generated.

---

## 7. Exercise library

Table `exercises` with: slug, name_en, name_fa, movement_pattern, primary_muscles[], secondary_muscles[], equipment[], difficulty (1–3), unilateral, default_rep_range, default_rest_sec, **setup_steps[]**, **execution_steps[]**, **form_cues[]** (3–5 short cues), **common_mistakes[]** (each with how to fix it), breathing, tempo, safety_notes, contraindications[] (body areas), regressions[], progressions[], substitutes[], image_url, image_status (`pending` | `ok` | `flagged`), video_search_url.

- **Seed ~70 exercises** covering all patterns and equipment types. Write all coaching content (steps, cues, mistakes, safety) yourself into a versioned seed file in Persian, based on established coaching standards. This is the source of truth and must be reviewable in git.
- New exercises added later are generated via OpenAI with the same JSON schema (structured outputs) and marked `source: ai`.
- `video_search_url`: a YouTube search link for "<name_en> proper form".

### Exercise images (OpenAI)
- Generate one illustration per exercise with the OpenAI image model (`OPENAI_IMAGE_MODEL` env var; check which model the project already uses).
- Consistent style across all exercises: clean anatomical illustration, neutral background, side or 3/4 view, two panels (start position / end position), the working muscles subtly highlighted, **no text in the image**, no logos or brands.
- Generate once (lazily on first view or via a batch admin action), store in existing storage, cache forever.
- AI images can show incorrect form. On the exercise page: written cues are primary, the image is a visual aid. Add "image is wrong" (sets `flagged`, hides it) and "regenerate" buttons.

### Exercise detail page
Image → muscles worked (simple front/back body map highlight) → setup → execution → cues → common mistakes → safety notes → my history for this exercise (chart + PRs) → substitutes → "watch demo" link.

---

## 8. Workout session UX

- Today's workout card → "Start" opens gym mode.
- Per exercise: target sets × rep range × load × RIR, warm-up sets, last session's performance shown ("Last time: 60 kg × 8, 8, 7").
- Log each set with stepper inputs (weight, reps, RIR) pre-filled with the target, so one tap confirms. Rest timer starts automatically.
- Swap exercise mid-workout (substitutes list), skip, add a set, add a note, log pain.
- PR detection (load, reps-at-load, e1RM) with a celebratory animation.
- Finish screen: duration, total volume, sets per muscle, PRs, and a 1–2 sentence coach comment (LLM, Persian).
- Missed workout → reschedule options (shift the week / merge / skip), never "make up" by doubling volume.

---

## 9. Nutrition engine

### Targets (deterministic)
- BMR: Mifflin-St Jeor (men `10W + 6.25H − 5A + 5`, women `… − 161`).
- TDEE = BMR × activity factor (from daily activity + training days, ≈ 1.4–1.7).
- Starting surplus: +300 kcal (config), tuned by weekly adjustment.
- Target rate of gain: novice 0.4–0.5% bodyweight/week, intermediate 0.25–0.35%/week (config).
- Protein 1.8 g/kg (range 1.6–2.2), spread over 3–5 meals with ≥ 0.4 g/kg per meal.
- Fat 0.8–1.0 g/kg and ≥ 20% of kcal. Carbs = remainder. Fiber ≈ 14 g per 1000 kcal. Water ≈ 35 ml/kg plus training losses.

### Food database
- Table `foods` with macros per 100 g. Seed ~200 common foods including Persian staples (rice, sangak/barbari/lavash, lentils, chickpeas, kidney beans, split peas, chicken, beef, lamb, fish, eggs, yogurt/mast, doogh, feta/panir, milk, dates, raisins, walnuts, almonds, pistachios, tahini, olive oil, potatoes, herbs, common vegetables and fruits) and gain-friendly foods (oats, peanut butter, whole milk, protein powder, bananas, granola).
- Use reliable reference values (e.g. USDA FoodData Central). Unknown foods proposed by the LLM may be added with estimated macros, flagged `estimated`.

### Weekly meal plan
- LLM proposes 7 days of meals (dishes + ingredients in grams) from my preferences, dislikes, allergies, cuisine, cooking time and budget. Structured JSON output.
- **Code computes macros** from the foods table, then scales portions so each day lands within ±5% kcal and ±10% protein of target. The LLM's own macro numbers are never trusted.
- Variety rules: no identical meal more than 2× per week; ≥ 4 different protein sources per week; ≥ 5 servings of vegetables/fruit per day; rotate carb sources.
- Appetite support if appetite is low/normal: calorie-dense snacks, a daily shake option (milk + oats + banana + peanut butter), more frequent meals.
- Auto-generated weekly grocery list grouped by category.
- One-tap meal swap with an alternative of similar macros.

### Logging (fast)
- Tap "ate as planned" per meal.
- Free-text log ("دو تا تخم‌مرغ و یه نون سنگک") → LLM parses to foods + grams → code computes macros → I confirm.
- Meal photo → OpenAI vision estimates foods + grams → code computes → I confirm/edit. Label it as an estimate.
- Daily rings for kcal and protein; end-of-day nudge if protein is far from target.

### Supplements (optional info card only)
Creatine monohydrate 3–5 g/day and protein powder as a convenience are the only defaults mentioned. Never suggest other supplements, and never mention steroids, SARMs or other drugs.

---

## 10. Progress tracking

- **Weigh-in:** daily, morning, after bathroom, before eating. Chart: raw points + 7-day moving average + target trajectory line + 12-month goal projection.
- **Measurements:** every 2 weeks: waist, chest, arm (flexed), thigh.
- **Photos:** every 2–4 weeks, front/side/back. The camera screen shows a ghost overlay of the previous photo for consistent alignment. Compare view: pick two dates, side-by-side and a slider. No AI body-fat estimates from photos.
- **Strength:** e1RM charts for main lifts, PR list, total weekly volume.
- **Volume per muscle:** weekly bars vs target range.
- **Adherence:** workouts done/planned, days protein target hit, days calorie target hit, logging streaks.
- **Muscle-vs-fat proxies:** waist change vs weight change, strength trend vs weight trend, shown as a simple "gain quality" indicator with an explanation.
- **12-month journey timeline:** milestones, mesocycles, PRs and photo snapshots along a single scrolling timeline.

---

## 11. Weekly check-in & auto-adjustment

Runs automatically once a week (my chosen day) and shows a report card:

1. **Weight trend:** compare this week's 7-day average with last week's (requires ≥ 4 weigh-ins; otherwise say so and don't adjust).
2. **Calorie adjustment (max one per week):**
   - 2-week average gain below target by > 0.1 kg/week → +150 kcal.
   - Above target by > 0.15 kg/week, or waist rising > 1 cm/month while strength is flat → −100 to −150 kcal.
   - Otherwise no change.
3. **Training:** stalled lifts, recovery signals, readiness, pain logs → deterministic suggestions (swap, early deload, volume change).
4. **LLM narrative (Persian):** what went well, what to improve, 1–3 concrete focus points for next week, based only on the computed data.
5. All changes are shown as proposals; I approve with one tap. Store every check-in and every change with its reason (audit trail).

---

## 12. AI Coach (chat)

- Chat tab with persistent history, Persian.
- Context injected each request: profile, injuries, current mesocycle and week, today's plan, targets, summary of the last 14 days (weights, sessions, adherence, PRs, pain logs), latest check-in.
- Can explain anything (why this exercise, how to brace, what to eat before training…).
- Can **propose** changes through function calling (`swap_exercise`, `adjust_calories`, `reschedule_workout`, `add_note`, `regenerate_meal`). Proposals render as confirmation cards; nothing is applied without my tap, and engine bounds are validated server-side.
- System prompt safety rules: stay within engine bounds; no extreme diets or fasting protocols for this goal; no drugs/PEDs; pain → stop and regress; red flags → medical care; when unsure, say so.

---

## 13. Engagement layer

- **Today screen:** greeting, today's workout card, meal checklist, weigh-in prompt, readiness check, streak counter, one coach tip of the day (contextual, not random).
- PR celebrations, weekly badges (perfect week, protein streak, new lift unlocked), mesocycle progress bar, "days since start" and progress toward the 12-month goal.
- Subtle, fast animations; nothing that slows logging down.

---

## 14. Data model (adapt to the existing ORM)

`profile`, `body_metrics` (date, weight, waist, chest, arm, thigh), `progress_photos` (date, angle, storage_key), `readiness` (date, sleep, energy, soreness), `exercises`, `mesocycles` (start, weeks, phase), `program_days`, `program_exercises` (sets, rep_range, rir, rest, order), `workout_sessions`, `set_logs` (weight, reps, rir, is_warmup, pain), `pain_reports`, `foods`, `nutrition_targets` (effective_from, kcal, p, c, f, reason), `meal_plans`, `meals`, `meal_items`, `food_logs`, `checkins`, `adjustments` (type, before, after, reason, approved_at), `coach_messages`, `ai_usage` (model, tokens, est_cost, feature).

---

## 15. OpenAI usage & cost control

- Model names from env: `OPENAI_TEXT_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_IMAGE_MODEL` (default to what the project already uses).
- Structured outputs (JSON schema) for every machine-consumed response; validate (zod/pydantic or equivalent); retry once on validation failure, then show a friendly error.
- Cache everything that can be cached (exercise content, images, meal plans).
- Log usage to `ai_usage`; `OPENAI_MONTHLY_BUDGET_USD` env cap; show month-to-date spend in Settings and block non-essential calls when over budget.
- API key used server-side only.

---

## 16. Quality bar

- Unit tests for the engine: BMR/TDEE, macro split, weekly adjustment rules, double progression, deload triggers, e1RM, volume counting, meal-plan portion scaler.
- A dev-only seed script that generates 8 weeks of realistic fake data so all charts and the check-in can be reviewed before real use.
- Lighthouse mobile performance ≥ 90 on Today and Workout screens.
- No translator remnants left (code, routes, deps, env vars no longer used — list the unused env vars for me to delete).

---

## 17. Build phases

Each phase ends deployable, committed, with a short report: what changed, how to test it on my phone, new env vars, open questions. Don't stop between phases except for Phase 0 approval and the production drop-tables confirmation.

- **Phase 0** — Audit, removal plan (stop for approval), cleanup, empty authenticated shell.
- **Phase 1** — Auth hardening, app shell (RTL, theme, tab nav, PWA), onboarding, profile, weigh-in + weight chart.
- **Phase 2** — Exercise library seed, program generator, workout logging in gym mode, rest timer, progression, PRs.
- **Phase 3** — Food DB, nutrition targets, weekly meal plan, logging (tap / text / photo), grocery list.
- **Phase 4** — Progress dashboard, measurements, photos with ghost overlay and compare, strength and volume charts, journey timeline.
- **Phase 5** — Exercise images, weekly check-in with auto-adjustment, AI coach chat, engagement layer, cost controls.

Start with Phase 0 now.
