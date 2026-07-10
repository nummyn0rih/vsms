import { getFeed } from "@/server/shipments/feed-loader";
import { parseWeekParam } from "@/server/shipments/workdays";
import { listShipmentOptions } from "@/server/shipments/actions";
import { ShipmentsFeed } from "./_components/ShipmentsFeed";
import { MobileShipmentsFeed } from "./_components/MobileShipmentsFeed";

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const initialWeek = parseWeekParam(sp.week);
  const initialView = sp.view === "summary" ? "summary" : "lenta";
  const [feed, options] = await Promise.all([
    getFeed({ seasonYear: initialWeek.seasonYear }),
    listShipmentOptions(),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1880px]">
      <div className="mb-4 hidden md:block">
        <h1 className="text-2xl font-semibold tracking-tight">Лента отгрузок</h1>
        <p className="text-sm text-muted-foreground">
          Овощное сырьё на завод · сезон {initialWeek.seasonYear}
        </p>
      </div>

      {/* Тулбар (+ Отгрузка / неделя / фильтры) — внутри ленты (FeedToolbar). */}
      <div className="hidden md:block">
        <ShipmentsFeed
          feed={feed}
          options={options}
          initialWeek={initialWeek}
          initialView={initialView}
        />
      </div>

      <div className="md:hidden">
        <MobileShipmentsFeed feed={feed} options={options} initialWeek={initialWeek} />
      </div>
    </div>
  );
}
