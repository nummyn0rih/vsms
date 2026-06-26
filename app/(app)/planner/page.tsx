import { listShipmentOptions } from "@/server/shipments/actions";
import { parseWeekParam } from "@/server/shipments/workdays";
import { PlannerShell } from "./_components/PlannerShell";

export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const week = parseWeekParam(sp.week);
  const view = sp.view === "board" ? "board" : "plan";
  // options — для «+ Отгрузка» и диалога правки карточки на доске.
  const options = await listShipmentOptions();

  return (
    <div className="mx-auto w-full max-w-[1880px]">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Планировщик</h1>
        <p className="text-sm text-muted-foreground">
          Планы по культурам и доска отгрузок · сезон {week.seasonYear}
        </p>
      </div>

      <PlannerShell initialWeek={week} initialView={view} options={options} />
    </div>
  );
}
