'use client';

import { useEffect, useRef } from 'react';

/** Bottom sheet on phones, centred dialog on wider screens. Native <dialog> for focus + Escape. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-labelledby="sheet-title"
      className="m-0 mt-auto max-h-[88dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] text-fg backdrop:bg-black/60 sm:m-auto sm:max-w-lg sm:rounded-3xl">
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />
      <h2 id="sheet-title" className="text-lg font-extrabold">{title}</h2>
      {open && <div className="mt-3">{children}</div>}
    </dialog>
  );
}
