import { notFound } from "next/navigation";

import { getFarmerCard } from "@/server/farmers/card";
import { FarmerCardHeader } from "./_components/FarmerCardHeader";
import { FarmerCardTabs } from "./_components/FarmerCardTabs";
import { MainPanel } from "./_components/MainPanel";
import { ContractsPanel } from "./_components/ContractsPanel";
import { ShipmentsPanel } from "./_components/ShipmentsPanel";
import { BalancesPanel } from "./_components/BalancesPanel";

// Карточка поставщика (Экран 4, v1): read-only агрегатор getFarmerCard,
// разметка/состояния — по docs/prototypes/farmer-card-v1.html. Вкладка — в
// ?tab= (FarmerCardTabs), без localStorage. Первый прецедент [id]/page.tsx в
// проекте (до этого детальные карточки — Dialog), зафиксирован в задаче явно.
export default async function FarmerCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const farmerId = Number(id);
  if (!Number.isInteger(farmerId)) notFound();

  const card = await getFarmerCard(farmerId);
  if (!card) notFound();

  return (
    <div>
      <FarmerCardHeader card={card} />
      <FarmerCardTabs
        mainPanel={<MainPanel card={card} />}
        contractsPanel={<ContractsPanel card={card} />}
        shipmentsPanel={<ShipmentsPanel card={card} />}
        balancesPanel={<BalancesPanel card={card} />}
      />
    </div>
  );
}
