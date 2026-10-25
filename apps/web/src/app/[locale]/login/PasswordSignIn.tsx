'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';

/**
 * Email + password sign-in. Accounts are created by the owner in the Supabase dashboard
 * (public sign-up is off); the allowlist is checked right after sign-in.
 */
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
    const sb = supabaseBrowser();
    const { error: signInError } = await sb.auth.signInWithPassword({
      email: String(form.get('email')).trim(),
      password: String(form.get('password')),
    });
    if (signInError) {
      setError(t('wrongCredentials'));
      setBusy(false);
      return;
    }
    const { data: allowed } = await sb.rpc('is_allowed');
    if (allowed !== true) {
      await sb.auth.signOut();
      setError(t('notAllowed'));
      setBusy(false);
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="label">{t('email')}</span>
        <input name="email" type="email" required autoComplete="email" dir="ltr" className="input" />
      </label>
      <label className="block">
        <span className="label">{t('password')}</span>
        <input name="password" type="password" required autoComplete="current-password" dir="ltr" className="input" />
      </label>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button className="btn w-full py-3" disabled={busy}>{t('signIn')}</button>
    </form>
  );
}
