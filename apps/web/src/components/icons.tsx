// Small stroke icons (24×24), drawn for this app. currentColor, 1.8px strokes.
type P = { className?: string };
const S = ({ className, children }: P & { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" className={className ?? 'h-6 w-6'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
export const IconToday = (p: P) => <S {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></S>;
export const IconWorkout = (p: P) => <S {...p}><path d="M6.5 7.5v9M3.5 10v4M17.5 7.5v9M20.5 10v4M6.5 12h11" /></S>;
export const IconNutrition = (p: P) => <S {...p}><path d="M4 11h16a8 8 0 0 1-16 0zM9 7c0-1.5 1-2.5 1-4M13 7c0-1.5 1-2.5 1-4" /></S>;
export const IconProgress = (p: P) => <S {...p}><path d="M3.5 19.5h17M5 16l4.5-5 3.5 3 6-7" /><path d="M15.5 7H19v3.5" /></S>;
export const IconCoach = (p: P) => <S {...p}><path d="M5 18.5V6.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9z" /><path d="M9 9.5h6M9 12.5h3.5" /></S>;
export const IconSettings = (p: P) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></S>;
export const IconCamera = (p: P) => <S {...p}><path d="M4 8h3l2-2.5h6L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></S>;
export const IconCheck = (p: P) => <S {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></S>;
export const IconAlert = (p: P) => <S {...p}><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4M12 16.8v.2" /></S>;
export const IconInfo = (p: P) => <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 7.8v.2" /></S>;
export const IconMinus = (p: P) => <S {...p}><path d="M6 12h12" /></S>;
export const IconTrophy = (p: P) => <S {...p}><path d="M8 4.5h8v5a4 4 0 0 1-8 0zM8 6.5H5a3 3 0 0 0 3 3.5M16 6.5h3a3 3 0 0 1-3 3.5M12 13.5v3M8.5 19.5h7M9.5 16.5h5" /></S>;
export const IconFlag = (p: P) => <S {...p}><path d="M5.5 20.5v-16M5.5 4.5h11l-2 3.5 2 3.5h-11" /></S>;
export const IconRuler = (p: P) => <S {...p}><path d="M3.5 15.5 15.5 3.5l5 5-12 12zM7 12l2 2M10 9l2 2M13 6l2 2" /></S>;
export const IconScale = (p: P) => <S {...p}><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M9 9.5a3.5 3.5 0 0 1 6 0M12 9.5l1-1.5" /></S>;
export const IconFlip = (p: P) => <S {...p}><path d="M4 8h13l-3-3M20 16H7l3 3" /></S>;
