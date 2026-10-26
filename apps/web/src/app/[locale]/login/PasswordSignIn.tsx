'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';

/** Email + password for the single owner account (created in the Supabase dashboard; sign-up is off). */
export function PasswordSignIn() {
  const t = useTranslations('login');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const { error: err } = await supabaseBrowser().auth.signInWithPassword({
        email: String(form.get('email')).trim(),
        password: String(form.get('password')),
      });
      if (err) return setError(t('wrongCredentials'));
      router.replace('/');
      router.refresh();
    } catch {
      setError(t('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="label">{t('email')}</span>
        <input name="email" type="email" required autoComplete="email" dir="ltr" className="input" />
      </label>
      <label className="block">
        <span className="label">{t('password')}</span>
        <input name="password" type="password" required autoComplete="current-password" dir="ltr" className="input" />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button className="btn w-full" disabled={busy}>{t('signIn')}</button>
    </form>
  );
}
