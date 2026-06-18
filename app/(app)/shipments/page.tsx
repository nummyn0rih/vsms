import { getFeed } from "@/server/shipments/feed-loader";
import { currentSeasonWeek } from "@/server/shipments/workdays";
import { listShipmentOptions } from "@/server/shipments/actions";
import { RoleGate } from "@/components/auth/RoleGate";
import { ShipmentsFeed } from "./_components/ShipmentsFeed";
import { ShipmentFormDialog } from "./_components/ShipmentFormDialog";

export default async function ShipmentsPage() {
  const { seasonYear } = currentSeasonWeek();
  const [feed, options] = await Promise.all([
    getFeed({ seasonYear }),
    listShipmentOptions(),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1880px]">
      <div className="mb-4 flex items-start">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Лента отгрузок</h1>
          <p className="text-sm text-muted-foreground">
            Овощное сырьё на завод · сезон {seasonYear}
          </p>
        </div>
        {/* Полноценный тулбар (+ фильтры/поиск/переключатель недели) — срез 17c. */}
        <div className="ml-auto">
          <RoleGate allow={["admin"]}>
            <ShipmentFormDialog mode="create" options={options} />
          </RoleGate>
        </div>
      </div>

      <ShipmentsFeed feed={feed} options={options} />
    </div>
  );
}
