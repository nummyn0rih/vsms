import { listShipmentOptions } from "@/server/shipments/actions";
import { parseWeekParam } from "@/server/shipments/workdays";
import { PlannerShell } from "./_components/PlannerShell";
import { MobilePlanView } from "./_components/MobilePlanView";

export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const week = parseWeekParam(sp.week);
  // Дефолт — «Доска»; «План» открывается явным ?view=plan.
  const view = sp.view === "plan" ? "plan" : "board";
  // options — для «+ Отгрузка» и диалога правки карточки на доске.
  const options = await listShipmentOptions();

  return (
    <div className="mx-auto w-full max-w-[1880px]">
      {/* Десктоп: полный планировщик (Доска|План + правка целей). */}
      <div className="hidden md:block">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">Планировщик</h1>
          <p className="text-sm text-muted-foreground">
            Планы по культурам и доска отгрузок · сезон {week.seasonYear}
          </p>
        </div>

        <PlannerShell initialWeek={week} initialView={view} options={options} />
      </div>

      {/* Мобиле (<md): read-only «План» карточками; «Доска» и правка целей — десктоп. */}
      <div className="md:hidden">
        <MobilePlanView initialWeek={week} />
      </div>
    </div>
  );
}
