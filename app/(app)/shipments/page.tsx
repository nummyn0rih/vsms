import { getFeed } from "@/server/shipments/feed-loader";
import { currentSeasonWeek } from "@/server/shipments/workdays";
import { listShipmentOptions } from "@/server/shipments/actions";
import { ShipmentsFeed } from "./_components/ShipmentsFeed";

export default async function ShipmentsPage() {
  const { seasonYear } = currentSeasonWeek();
  const [feed, options] = await Promise.all([
    getFeed({ seasonYear }),
    listShipmentOptions(),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1880px]">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Лента отгрузок</h1>
        <p className="text-sm text-muted-foreground">
          Овощное сырьё на завод · сезон {seasonYear}
        </p>
      </div>

      {/* Тулбар (+ Отгрузка / неделя / фильтры) — внутри ленты (FeedToolbar). */}
      <ShipmentsFeed feed={feed} options={options} />
    </div>
  );
}
