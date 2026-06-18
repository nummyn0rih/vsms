// Скелетон ленты на время серверной загрузки getFeed (страница — серверный
// компонент с await). Несколько серых строк-плейсхолдеров леджера.
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1880px]">
      <div className="mb-4">
        <div className="h-7 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-muted" />
      </div>
      <div className="mt-4 h-10 w-full animate-pulse rounded-lg bg-muted" />
      <div className="mt-3 flex flex-col gap-2.5 pl-[30px]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-20 w-full animate-pulse rounded-lg border border-[#ebebeb] bg-muted/60"
          />
        ))}
      </div>
    </div>
  );
}
