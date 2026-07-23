"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type CultureOpt = {
  id: number;
  name: string;
  color: string;
  acceptanceType: "simple" | "calibre";
};

// Селектор культуры: переключает весь профиль через URL /analytics/culture/<id>?season=
// (без localStorage). Паттерн — как SeasonSelector дашборда.
export function CultureSelector({
  cultureId,
  season,
  cultures,
}: {
  cultureId: number;
  season: number;
  cultures: CultureOpt[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = cultures.find((c) => c.id === cultureId);

  function pick(id: number) {
    router.push(`/analytics/culture/${id}?season=${season}`);
    setOpen(false);
  }

  return (
    <div className="an-cultsel" ref={ref}>
      <button className="an-cult-btn" onClick={() => setOpen((o) => !o)}>
        <span className="dot" style={{ background: current?.color ?? "var(--mute)" }} />
        {current?.name ?? "Культура"}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="an-cult-menu">
          {cultures.map((c) => (
            <button
              key={c.id}
              className={`opt${c.id === cultureId ? " cur" : ""}`}
              onClick={() => pick(c.id)}
            >
              <span className="dot" style={{ background: c.color }} />
              {c.name}
              <span className="mono">
                {c.acceptanceType === "calibre" ? "калибр" : "по весу"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
