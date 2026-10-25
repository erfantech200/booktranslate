'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';

export function GoogleSignIn({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn w-full py-3"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await supabaseBrowser().auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
      }}
    >
      {label}
    </button>
  );
}
