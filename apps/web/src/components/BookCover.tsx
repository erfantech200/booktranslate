/**
 * A book in the library: a cover with a lapis spine on the binding edge. Uses the first page's
 * photo when there is one, otherwise a typographic cover with the title.
 */
export function BookCover({ title, author, cover }: { title: string; author: string | null; cover: string | null }) {
  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-e-md rounded-s-sm bg-lajvard-soft shadow-[0_1px_0_var(--color-line),0_10px_24px_-14px_rgba(21,34,82,0.45)] transition-transform duration-200 group-hover:-translate-y-1 motion-reduce:transition-none">
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
        <img src={cover} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full flex-col justify-between gap-2 px-4 pt-5 pb-4 ps-6">
          <p dir="auto" className="line-clamp-4 text-start font-display text-base font-bold leading-snug text-lajvard [overflow-wrap:anywhere] sm:text-lg xl:text-xl">{title}</p>
          {author && <p dir="auto" className="line-clamp-2 text-start text-sm text-muted">{author}</p>}
        </div>
      )}
      <span className="spine-band absolute inset-y-0 start-0 w-3 bg-lajvard bg-origin-content py-6" aria-hidden="true" />
    </div>
  );
}
