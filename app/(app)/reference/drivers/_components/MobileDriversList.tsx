"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Phone, Search, SearchX } from "lucide-react";

import type { DriverRow, TransportCompanyOption } from "@/server/drivers/schema";
import { normalizePhone, formatPhone } from "@/lib/validators";
import { CompanyFilter } from "./CompanyFilter";

// «Сидоров И. Н.» → «СИ» (фамилия + имя, без отчества/точек).
function initials(fullName: string): string {
  const [surname = "", first = ""] = fullName.trim().split(/\s+/);
  return (surname.charAt(0) + first.replace(".", "").charAt(0)).toUpperCase();
}

// Мобильный поиск по фамилии (md:hidden) — тот же ?q, что десктопный
// ReferenceToolbar (debounce 300мс), но без переключателя «неактивных» и слота
// кнопки создания (read-only на мобиле).
function MobileSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (q) next.set("q", q);
      else next.delete("q");
      router.replace(`${pathname}?${next.toString()}`);
    }, 300);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="msearch-in">
      <Search />
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск по фамилии…"
      />
    </div>
  );
}

function DriverCard({ row }: { row: DriverRow }) {
  return (
    <div className="dcard">
      <span className="dcard-av">{initials(row.full_name)}</span>
      <div className="dcard-main">
        <span className="dcard-name">{row.full_name}</span>
        {(row.info || !row.active) && (
          <span className="dcard-meta">
            {row.info}
            {row.info && !row.active ? " · " : ""}
            {!row.active && "неактивен"}
          </span>
        )}
        <span className="dcard-phone">{row.phone ? formatPhone(row.phone) : "—"}</span>
      </div>
      {row.phone && (
        <a className="callbtn" href={`tel:${normalizePhone(row.phone)}`}>
          <Phone />
          Звонок
        </a>
      )}
    </div>
  );
}

export function MobileDriversList({
  rows,
  companyOptions,
}: {
  rows: DriverRow[];
  companyOptions: TransportCompanyOption[];
}) {
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const companyId = params.get("company") ? Number(params.get("company")) : undefined;
  const companyName = companyId
    ? (companyOptions.find((c) => c.id === companyId)?.name ?? null)
    : null;

  const groups = new Map<string, DriverRow[]>();
  for (const row of rows) {
    const key = row.transport_company_name ?? "Без компании";
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  return (
    <>
      <div className="msearch">
        <MobileSearch />
        <CompanyFilter options={companyOptions} className="w-auto max-w-[130px] shrink-0" />
      </div>

      {rows.length === 0 ? (
        <div className="m-empty">
          <span className="ec-ic">
            <SearchX />
          </span>
          <div className="et">Ничего не найдено</div>
          <div className="ed">
            {q && `По запросу «${q}» водители не найдены. `}
            {companyName && `Нет водителей у «${companyName}». `}
            Проверьте фамилию или сбросьте фильтр по ТК.
          </div>
        </div>
      ) : (
        Array.from(groups.entries()).map(([company, list]) => (
          <div key={company} className="tk-group">
            <div className="tk-group-lab">
              {company}
              <span className="ln" />
            </div>
            <div className="dcards">
              {list.map((row) => (
                <DriverCard key={row.id} row={row} />
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}
