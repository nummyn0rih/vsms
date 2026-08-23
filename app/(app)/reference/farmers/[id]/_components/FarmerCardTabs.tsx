"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  "main",
  "contracts",
  "settlement",
  "shipments",
  "balances",
  "quality",
  "analytics",
] as const;
type TabValue = (typeof TABS)[number];

// Вкладки карточки фермера: активная — в URL (?tab=), без localStorage (конвенция
// проекта, см. ContractFilters). Невалидное/отсутствующее значение → "main".
export function FarmerCardTabs({
  mainPanel,
  contractsPanel,
  settlementPanel,
  shipmentsPanel,
  balancesPanel,
  qualityPanel,
  analyticsPanel,
}: {
  mainPanel: ReactNode;
  contractsPanel: ReactNode;
  settlementPanel: ReactNode;
  shipmentsPanel: ReactNode;
  balancesPanel: ReactNode;
  qualityPanel: ReactNode;
  analyticsPanel: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const raw = params.get("tab");
  const active: TabValue = (TABS as readonly string[]).includes(raw ?? "")
    ? (raw as TabValue)
    : "main";

  function onValueChange(value: string) {
    const next = new URLSearchParams(params.toString());
    next.set("tab", value);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <Tabs value={active} onValueChange={onValueChange} className="mt-2 gap-4">
      <TabsList variant="line" className="h-auto flex-wrap justify-start border-b pb-0">
        <TabsTrigger value="main">Основное + контакты</TabsTrigger>
        <TabsTrigger value="contracts">Контракты</TabsTrigger>
        <TabsTrigger value="settlement">Расчёты</TabsTrigger>
        <TabsTrigger value="shipments">Отгрузки</TabsTrigger>
        <TabsTrigger value="balances">Тара / ингредиенты</TabsTrigger>
        <TabsTrigger value="quality">Качество</TabsTrigger>
        <TabsTrigger value="analytics">Аналитика</TabsTrigger>
      </TabsList>
      <TabsContent value="main">{mainPanel}</TabsContent>
      <TabsContent value="contracts">{contractsPanel}</TabsContent>
      <TabsContent value="settlement">{settlementPanel}</TabsContent>
      <TabsContent value="shipments">{shipmentsPanel}</TabsContent>
      <TabsContent value="balances">{balancesPanel}</TabsContent>
      <TabsContent value="quality">{qualityPanel}</TabsContent>
      <TabsContent value="analytics">{analyticsPanel}</TabsContent>
    </Tabs>
  );
}
