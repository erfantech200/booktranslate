import 'server-only';
import { addDays, COACH, isLowReadiness, setsFor, substitutesFor, toDay, weekContext, weekday } from '@coach/core/shared';
import { latestCheckin, lastCalorieChange } from './checkin';
import { loadLibrary } from './library';
import { ensureTargets, loadPlan, weekStartOf } from './nutrition';
import { planSummary } from './plan';
import type { Profile } from './profile';
import { firstTimes, loadFoodDays, loadPRs, loadWorkSets } from './progress';
import type { supabaseServer } from './supabase/server';
import { eligibilityFor, holdRampFor, loadActiveMeso, loadActiveProgram, loadExcluded, loadReadiness, loadSessions, mesoInfo, weekView } from './training';
import { loadWeighIns } from './weights';

// What the coach knows each request (spec §12): profile, injuries, program and week, today's plan,
// targets, the last 14 days, the latest check-in. Numbers come from the engine; the model reads them.
// Also returns the ids it may use in proposals, so the server can reject anything else.

type SB = Awaited<ReturnType<typeof supabaseServer>>;

export interface CoachAllowed {
  programSlugs: Set<string>;
  substitutes: Map<string, Set<string>>;
  mealIds: Set<string>;
}

export async function coachContext(sb: SB, userId: string, profile: Profile, today: string) {
  const since = addDays(today, -COACH.coach.contextDays);
  const [weighIns, block, program, library, excluded, targets, plan, work, prs, readiness, pain, checkin, lastChange, food] = await Promise.all([
    loadWeighIns(sb), loadActiveMeso(sb), loadActiveProgram(sb), loadLibrary(), loadExcluded(sb), ensureTargets(sb, userId, profile, today),
    loadPlan(sb, weekStartOf(today)), loadWorkSets(sb), loadPRs(sb), loadReadiness(sb, since),
    sb.from('pain_reports').select('date, area, level, slug').gte('date', since), latestCheckin(sb), lastCalorieChange(sb),
    loadFoodDays(sb, since),
  ]);
  const name = new Map(library.map((e) => [e.slug, e.nameFa]));
  const s = planSummary(profile, weighIns, today);
  const allowed: CoachAllowed = { programSlugs: new Set(), substitutes: new Map(), mealIds: new Set() };

  let training: unknown = { program: null };
  if (block) {
    const wc = weekContext(mesoInfo(block.meso), profile.experience ?? 'none', today);
    const view = weekView(block.meso, block.days, await loadSessions(sb, block.meso.id), today);
    const el = eligibilityFor(profile, excluded, block.meso.blockNo);
    const hold = holdRampFor(readiness, today);
    for (const d of block.days) for (const x of d.exercises) {
      allowed.programSlugs.add(x.slug);
      const e = library.find((l) => l.slug === x.slug);
      if (e && !allowed.substitutes.has(x.slug)) allowed.substitutes.set(x.slug, new Set(substitutesFor(e, library, el).slice(0, 5).map((y) => y.slug)));
    }
    training = {
      program: program ? { name: program.name, location: program.trainLocation, daysPerWeek: program.daysPerWeek, sessionMinutes: program.sessionMinutes } : null,
      block: { number: block.meso.blockNo, week: Math.min(wc.week, block.meso.weeks), weeks: block.meso.weeks, deload: wc.deload, technique: wc.technique },
      trainingWeekdays: block.meso.trainingDays,
      nextSession: view.state.next ? { dayIdx: view.state.next.dayIdx, plannedDate: view.state.next.planned, dueToday: view.state.dueToday, late: view.state.late } : null,
      days: block.days.map((d) => ({
        idx: d.idx, kind: d.kind,
        exercises: d.exercises.map((x) => ({
          slug: x.slug, name: name.get(x.slug), role: x.role, sets: setsFor(x.sets, wc, { holdRamp: hold, lowReadiness: false }), reps: x.reps,
          substitutes: [...(allowed.substitutes.get(x.slug) ?? [])].map((slug) => ({ slug, name: name.get(slug) })),
        })),
      })),
    };
  }

  const meals = plan?.status === 'ready' ? plan.meals : [];
  for (const m of meals) allowed.mealIds.add(m.id);
  const sessions = work.sessions.filter((x) => x.date >= since);
  const first = firstTimes(work.sets);
  const daysSinceChange = lastChange ? toDay(today) - toDay(lastChange) : null;

  const context = {
    today, weekday: weekday(today),
    profile: {
      sex: profile.sex, age: profile.birth_year ? Number(today.slice(0, 4)) - profile.birth_year : null, heightCm: profile.height_cm,
      experience: profile.experience, injuries: profile.injury_areas, injuryNotes: profile.injury_notes, medicalNotes: profile.medical_notes,
      cardioRisk: profile.cardio_risk, dislikedFoods: profile.disliked_foods, allergies: profile.allergies, dietaryRules: profile.dietary_rules,
    },
    goal: {
      startDate: profile.start_date, startKg: s.startKg, trendKg: s.current, targetRatePctPerWeek: s.ratePct,
      targetKgPerWeek: Math.round(s.targetKgPerWeek * 100) / 100, target12mKg: s.target12m, dayNumber: s.dayNumber,
    },
    training,
    nutrition: {
      targets: { kcal: targets.kcal, protein: targets.protein, carbs: targets.carbs, fat: targets.fat, surplus: targets.surplus },
      calorieChangeAllowedNow: daysSinceChange == null || daysSinceChange >= COACH.checkin.minDaysBetweenChanges,
      calorieChangeBounds: { maxStepKcal: COACH.coach.calorieChangeMaxKcal, surplusMin: COACH.checkin.surplusMinKcal, surplusMax: COACH.checkin.surplusMaxKcal },
      todayMeals: meals.filter((m) => m.dayIdx === weekday(today)).map((m) => ({ meal_id: m.id, slot: m.slot, name: m.nameFa, kcal: Math.round(m.kcal), protein: Math.round(m.protein) })),
      weekMeals: meals.map((m) => ({ meal_id: m.id, day: m.dayIdx, slot: m.slot, name: m.nameFa })),
      supplements: { creatineGramsPerDay: COACH.supplements.creatineGramsPerDay, note: 'creatine and protein powder only' },
    },
    last14Days: {
      weighIns: weighIns.filter((w) => w.date >= since).map((w) => ({ date: w.date, kg: w.weightKg })),
      workoutsDone: sessions.map((x) => x.date),
      prs: prs.filter((p) => p.date >= since && first.get(p.slug) !== p.date).map((p) => ({ date: p.date, exercise: name.get(p.slug) ?? p.slug, weight: p.weight, reps: p.reps })),
      food: food.map((f) => ({ date: f.date, kcal: Math.round(f.kcal), protein: Math.round(f.protein) })),
      lowReadinessDays: readiness.filter((r) => isLowReadiness(r)).map((r) => r.date),
      pain: (pain.data ?? []).map((p) => ({ date: p.date, area: p.area, level: p.level, exercise: p.slug ? name.get(p.slug) : null })),
    },
    latestCheckin: checkin ? { weekEnd: checkin.weekEnd, report: checkin.report, narrative: checkin.narrative } : null,
  };
  return { context, allowed };
}
