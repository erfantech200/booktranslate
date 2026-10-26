'use client';

import { useFormStatus } from 'react-dom';

/** Submit button for a server-action form; asks first when `confirm` is given. */
export function ConfirmSubmit({ children, confirm, className, pendingLabel, name, value }: {
  children: React.ReactNode; confirm?: string; className?: string; pendingLabel?: string; name?: string; value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} className={className ?? 'btn btn-primary'} disabled={pending}
      onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
