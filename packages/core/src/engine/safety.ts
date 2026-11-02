// Red flags in free text (spec §6, §12): chest pain, dizziness, fainting, numbness, breathlessness.
// When a coach-chat message mentions one, the app answers with the fixed stop message, not the model.

const RED_FLAG_PATTERNS = [
  /درد\s*(?:در\s*)?(?:قفسه[ٔ‌\s]*)?سینه/, /سینه[‌\s]*(?:ام|م)?\s*درد/, /سرگیجه/, /بی[‌\s]?حس/, /غش/, /تنگی\s*نفس/, /نفسم\s*(?:بند|بالا\s*نمی)/,
  /سیاهی\s*رفت/, /chest\s*pain/i, /dizz/i, /faint/i, /numb/i, /short(?:ness)?\s*of\s*breath/i,
];

export const mentionsRedFlag = (text: string) => RED_FLAG_PATTERNS.some((re) => re.test(text));
