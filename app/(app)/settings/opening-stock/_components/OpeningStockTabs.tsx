"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { OpeningBalances } from "@/server/inventory/opening";
import { OpeningStockMatrix } from "./OpeningStockMatrix";

// Вкладки начальных остатков: Тара (целое) | Ингредиенты (Decimal). Tabs клиентские
// (Radix), поэтому загрузка обоих наборов — в server-page, рендер вкладок — здесь.
export function OpeningStockTabs({
  packaging,
  ingredient,
}: {
  packaging: OpeningBalances;
  ingredient: OpeningBalances;
}) {
  return (
    <Tabs defaultValue="packaging" className="gap-4">
      <TabsList>
        <TabsTrigger value="packaging">Тара</TabsTrigger>
        <TabsTrigger value="ingredient">Ингредиенты</TabsTrigger>
      </TabsList>
      <TabsContent value="packaging">
        <OpeningStockMatrix {...packaging} />
      </TabsContent>
      <TabsContent value="ingredient">
        <OpeningStockMatrix {...ingredient} />
      </TabsContent>
    </Tabs>
  );
}
