'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { signIn, type SignInState } from './actions';

/** Email + password for the single owner account (created in the Supabase dashboard; sign-up is off). */
export function PasswordSignIn() {
  const t = useTranslations('login');
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, null);
  const message = state?.error === 'blocked' ? t('blocked', { minutes: state.minutes ?? 15 })
    : state?.error === 'wrong' ? t('wrongCredentials') : state?.error ? t('error') : null;
  return (
    <form action={action} className="space-y-4">
      <label className="field">
        <span className="field-label">{t('email')}</span>
        <input name="email" type="email" required autoComplete="email" dir="ltr" className="input" />
      </label>
      <label className="field">
        <span className="field-label">{t('password')}</span>
        <input name="password" type="password" required autoComplete="current-password" dir="ltr" className="input" />
      </label>
      {message && <p role="alert" className="note note-danger">{message}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{t('signIn')}</button>
    </form>
  );
}
