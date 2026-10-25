'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';

/**
 * Email + password sign-in, plus "forgot password". Accounts are created by the owner in the
 * Supabase dashboard (public sign-up is off); the allowlist is checked right after sign-in.
 */
export function PasswordSignIn() {
  const t = useTranslations('login');
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'forgot' | 'sent'>('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recovery links sent from the Supabase dashboard arrive as #access_token=…&type=recovery.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access_token = hash.get('access_token');
    const refresh_token = hash.get('refresh_token');
    if (!access_token || !refresh_token) return;
    void supabaseBrowser().auth.setSession({ access_token, refresh_token }).then(({ error: e }: { error: unknown }) => {
      history.replaceState(null, '', window.location.pathname);
      if (e) setError(t('linkExpired'));
      else if (hash.get('type') === 'recovery') router.replace('/reset-password');
      else router.replace('/');
    });
  }, [router, t]);

  async function signIn(form: FormData) {
    const sb = supabaseBrowser();
    const { error: signInError } = await sb.auth.signInWithPassword({
      email: String(form.get('email')).trim(),
      password: String(form.get('password')),
    });
    if (signInError) return setError(t('wrongCredentials'));
    const { data: allowed } = await sb.rpc('is_allowed');
    if (allowed !== true) {
      await sb.auth.signOut();
      return setError(t('notAllowed'));
    }
    router.replace('/');
    router.refresh();
  }

  async function sendReset(form: FormData) {
    const { error: e } = await supabaseBrowser().auth.resetPasswordForEmail(String(form.get('email')).trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    if (e) return setError(e.message);
    setMode('sent');
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await (mode === 'forgot' ? sendReset(form) : signIn(form));
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'sent') {
    return (
      <div className="space-y-5">
        <p role="status" className="note note-done">{t('resetSent')}</p>
        <button className="btn-quiet" onClick={() => setMode('signin')}>{t('backToSignIn')}</button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <label className="field">
        <span className="field-label">{t('email')}</span>
        <input name="email" type="email" required autoComplete="email" dir="ltr" className="input" />
      </label>
      {mode === 'signin' && (
        <label className="field">
          <span className="field-label">{t('password')}</span>
          <input name="password" type="password" required autoComplete="current-password" dir="ltr" className="input" />
        </label>
      )}
      {error && <p role="alert" className="note note-alert">{error}</p>}
      <button className="btn w-full py-3" disabled={busy}>{mode === 'forgot' ? t('sendReset') : t('signIn')}</button>
      <button type="button" className="btn-quiet"
        onClick={() => { setError(null); setMode(mode === 'forgot' ? 'signin' : 'forgot'); }}>
        {mode === 'forgot' ? t('backToSignIn') : t('forgot')}
      </button>
    </form>
  );
}
