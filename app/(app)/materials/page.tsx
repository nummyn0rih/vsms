import { getMaterialShipments } from "@/server/materials/feed-loader";
import { listMaterialOptions } from "@/server/materials/actions";
import { currentSeasonWeek } from "@/server/shipments/workdays";
import { MaterialsFeed } from "./_components/MaterialsFeed";

export default async function MaterialsPage() {
  const { seasonYear } = currentSeasonWeek();
  const [feed, options] = await Promise.all([
    getMaterialShipments(seasonYear),
    listMaterialOptions(),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1880px]">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Логистика материалов</h1>
        <p className="text-sm text-muted-foreground">
          Рейсы тары и ингредиентов завод → фермер · возврат пустой тары под отгрузку · сезон {seasonYear}
        </p>
      </div>

      <MaterialsFeed feed={feed} options={options} />
    </div>
  );
}
