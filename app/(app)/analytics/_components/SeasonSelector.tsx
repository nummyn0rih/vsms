"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Season = { seasonYear: number; isCurrent: boolean };

// Селектор сезона: пишет ?season= в URL (без localStorage) → server re-fetch.
export function SeasonSelector({
  season,
  seasons,
}: {
  season: number;
  seasons: Season[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(year: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("season", String(year));
    router.replace(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  return (
    <div className="an-seasonsel" ref={ref}>
      <button className="an-season-btn" onClick={() => setOpen((o) => !o)}>
        <span className="dot" />
        Сезон <span className="lab">{season}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="an-season-menu">
          {seasons.length === 0 && (
            <div className="opt" style={{ color: "var(--mute)", cursor: "default" }}>
              нет настроенных сезонов
            </div>
          )}
          {seasons.map((s) => (
            <button
              key={s.seasonYear}
              className={`opt${s.seasonYear === season ? " cur" : ""}`}
              onClick={() => pick(s.seasonYear)}
            >
              <span className="tick-slot">
                {s.seasonYear === season && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
              Сезон {s.seasonYear} <span className="mono">{s.isCurrent ? "текущий" : "архив"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
