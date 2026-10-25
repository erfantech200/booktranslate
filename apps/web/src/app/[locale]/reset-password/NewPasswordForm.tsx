'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';

export function NewPasswordForm() {
  const t = useTranslations('login');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password'));
    if (password.length < 8) return setError(t('passwordTooShort'));
    if (password !== String(form.get('confirm'))) return setError(t('passwordMismatch'));
    setBusy(true);
    setError(null);
    const { error: err } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(err.message);
    router.replace('/');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <label className="field">
        <span className="field-label">{t('newPassword')}</span>
        <input name="password" type="password" required minLength={8} autoComplete="new-password" dir="ltr" className="input" />
      </label>
      <label className="field">
        <span className="field-label">{t('confirmPassword')}</span>
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" dir="ltr" className="input" />
      </label>
      {error && <p role="alert" className="note note-alert">{error}</p>}
      <button className="btn w-full py-3" disabled={busy}>{t('savePassword')}</button>
    </form>
  );
}
