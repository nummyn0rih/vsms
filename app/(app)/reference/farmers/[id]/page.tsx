import { notFound } from "next/navigation";

import { getFarmerCard } from "@/server/farmers/card";
import { getFarmerQuality } from "@/server/farmers/quality";
import { getFarmerAnalytics } from "@/server/farmers/analytics";
import { getFarmerSettlement } from "@/server/farmers/settlement";
import { FarmerCardHeader } from "./_components/FarmerCardHeader";
import { FarmerCardTabs } from "./_components/FarmerCardTabs";
import { MainPanel } from "./_components/MainPanel";
import { ContractsPanel } from "./_components/ContractsPanel";
import { SettlementPanel } from "./_components/SettlementPanel";
import { SettlementPeriodBar } from "./_components/SettlementPeriodBar";
import { QualityPanel } from "./_components/QualityPanel";
import { AnalyticsPanel } from "./_components/AnalyticsPanel";
import { ShipmentsPanel } from "./_components/ShipmentsPanel";
import { BalancesPanel } from "./_components/BalancesPanel";

// Карточка поставщика (Экран 4, v1): read-only агрегатор getFarmerCard,
// разметка/состояния — по docs/prototypes/farmer-card-v1.html. Вкладка — в
// ?tab= (FarmerCardTabs), без localStorage. Первый прецедент [id]/page.tsx в
// проекте (до этого детальные карточки — Dialog), зафиксирован в задаче явно.

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function FarmerCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const farmerId = Number(id);
  if (!Number.isInteger(farmerId)) notFound();

  const [card, sp] = await Promise.all([getFarmerCard(farmerId), searchParams]);
  if (!card) notFound();

  // Расчётный лист считается ЛЕНИВО — только когда открыта его вкладка. Карточку
  // открывают в основном ради контактов и отгрузок, а лист стоит двух выборок;
  // клик по вкладке и так идёт на сервер (страница динамическая), так что задержки
  // это не добавляет. Сезон — тот же, что у всей карточки: разъезжаться внутри
  // одной страницы нельзя.
  const tab = one(sp.tab);
  const settlement =
    tab === "settlement"
      ? await getFarmerSettlement({
          farmerId,
          season: card.farmer.season,
          period: one(sp.period),
          from: one(sp.from),
          to: one(sp.to),
        })
      : null;

  // Лист качества — тем же приёмом и по той же причине: он стоит двух выборок позиций
  // (его и всех поставщиков его культур), а открывают вкладку заметно реже остальных.
  // Сезон — снова card.farmer.season, периода у этой вкладки нет вовсе (качество за
  // неделю — это одна-две партии, шум).
  const quality =
    tab === "quality"
      ? await getFarmerQuality({ farmerId, season: card.farmer.season })
      : null;

  // «Аналитика» — тем же приёмом. Период у неё общий с «Расчётами» (?period=&from=&to=,
  // один resolveSettlementPeriod), поэтому переключение вкладок период не сбрасывает.
  const analytics =
    tab === "analytics"
      ? await getFarmerAnalytics({
          farmerId,
          season: card.farmer.season,
          period: one(sp.period),
          from: one(sp.from),
          to: one(sp.to),
        })
      : null;

  return (
    <div>
      <FarmerCardHeader card={card} />
      <FarmerCardTabs
        mainPanel={<MainPanel card={card} />}
        contractsPanel={<ContractsPanel card={card} />}
        settlementPanel={
          settlement && (
            <div className="flex flex-col gap-4">
              <SettlementPeriodBar
                period={settlement.period}
                today={settlement.generatedAt}
              />
              <SettlementPanel data={settlement} />
            </div>
          )
        }
        shipmentsPanel={<ShipmentsPanel card={card} />}
        balancesPanel={<BalancesPanel card={card} />}
        qualityPanel={quality && <QualityPanel data={quality} />}
        analyticsPanel={
          analytics && (
            <div className="flex flex-col gap-4">
              <SettlementPeriodBar
                period={analytics.period}
                today={analytics.generatedAt}
                tab="analytics"
              />
              <AnalyticsPanel data={analytics} />
            </div>
          )
        }
      />
    </div>
  );
}
