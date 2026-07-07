import Link from "next/link";
import { ChevronLeft, Mail, MessageCircle, Phone, User } from "lucide-react";

import type { FarmerCard } from "@/server/farmers/card";
import { formatPhone, normalizePhone } from "@/lib/validators";
import { Button } from "@/components/ui/button";

// Токены статуса — как STATUS_STYLE в shipments/_components/shipment-status.tsx:
// точные hex из DESIGN-SYSTEM, не generic Badge (нужны именно эти 2 состояния).
function StatusPill({ active }: { active: boolean }) {
  const style = active
    ? { color: "#1d8e75", background: "#eafaf5", borderColor: "#cdeee4" }
    : { color: "#888888", background: "#f5f5f5", borderColor: "#ebebeb" };
  const dot = active ? "#29bc9b" : "#a1a1a1";
  return (
    <span
      className="mt-0.5 inline-flex h-6 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium"
      style={style}
    >
      <span className="inline-block size-1.5 rounded-full" style={{ background: dot }} />
      {active ? "Активен" : "Архивный"}
    </span>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-[140px] flex-1 rounded-lg border bg-muted/30 px-3.5 py-2.5">
      <div className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

export function FarmerCardHeader({ card }: { card: FarmerCard }) {
  const { farmer, kpi, contracts } = card;
  const hasContracts = contracts.items.length > 0;
  const execLabel = hasContracts ? `${Math.round(contracts.farmerTotal.pct)}%` : "—";
  const acceptedTons = (contracts.farmerTotal.acceptedKg / 1000).toLocaleString("ru-RU", {
    maximumFractionDigits: 1,
  });
  const targetTons = (contracts.farmerTotal.targetKg / 1000).toLocaleString("ru-RU", {
    maximumFractionDigits: 1,
  });
  const costLabel = `${Math.round(contracts.farmerTotal.costRub).toLocaleString("ru-RU")} ₽`;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/reference/farmers" className="hover:text-foreground hover:underline">
          Справочники / Фермеры
        </Link>
        <span>/</span>
        <span className="text-foreground">{farmer.name}</span>
        <div className="ml-auto">
          <Button variant="outline" size="sm" asChild>
            <Link href="/reference/farmers">
              <ChevronLeft className="size-4" />
              К списку
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-start gap-3">
        <span className="text-2xl font-semibold tracking-tight">{farmer.name}</span>
        <StatusPill active={farmer.active} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        {farmer.contacts.phone && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Phone className="size-3.5" />
            <a
              href={`tel:${normalizePhone(farmer.contacts.phone)}`}
              className="font-mono font-medium text-primary hover:underline"
            >
              {formatPhone(farmer.contacts.phone)}
            </a>
          </span>
        )}
        {farmer.contacts.contactPerson && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <User className="size-3.5" />
            <span className="font-medium text-foreground">{farmer.contacts.contactPerson}</span>
          </span>
        )}
        {farmer.contacts.messenger && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <MessageCircle className="size-3.5" />
            {farmer.contacts.messenger}
          </span>
        )}
        {farmer.contacts.email && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Mail className="size-3.5" />
            <a href={`mailto:${farmer.contacts.email}`} className="text-primary hover:underline">
              {farmer.contacts.email}
            </a>
          </span>
        )}
      </div>

      <div className="mt-4 mb-1 flex flex-wrap gap-2.5">
        <Kpi label="Контрактов в сезоне" value={String(contracts.items.length)} sub={`сезон ${farmer.season}`} />
        <Kpi
          label="Выполнение сезона"
          value={execLabel}
          sub={hasContracts ? `принято ${acceptedTons} из ${targetTons} т` : "нет контрактов"}
        />
        <Kpi
          label="Тара на балансе"
          value={String(kpi.tareOnBalance)}
          sub={kpi.tareByType.map((t) => `${t.qty} ${t.name.toLowerCase()}`).join(" · ") || "нет тары"}
        />
        <Kpi label="Стоимость сезона" value={costLabel} sub="по принятому весу" />
      </div>
    </div>
  );
}
