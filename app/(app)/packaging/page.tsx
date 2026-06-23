import { getTareBalances } from "@/server/inventory/balances";
import { FACTORY_LOCATION_ID } from "@/server/shipments/packaging";
import { TareBalanceMatrix } from "./_components/TareBalanceMatrix";

export default async function PackagingPage() {
  const data = await getTareBalances();

  // Сводка завода (целая тара по типам) — статична, считаем на сервере из cells.
  const factory = data.types.map((t) => {
    const cell = data.cells.find(
      (c) =>
        c.locationId === FACTORY_LOCATION_ID &&
        c.packagingTypeId === t.id &&
        c.state === "good",
    );
    return { name: t.name, qty: cell ? cell.quantity : 0 };
  });

  return (
    <div className="w-full max-w-[1120px]">
      <div
        id="tare-page-head"
        className="sticky top-0 z-40 -mx-6 flex flex-wrap items-start justify-between gap-6 border-b bg-background px-6 py-4"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Тара</h1>
          <p className="max-w-[640px] text-sm text-muted-foreground">
            Реальные остатки тары по локациям и типам: начальный + доставлено −
            отгружено. Строки «в пути» — тара в дороге между заводом и фермерами.
            Read-only.
          </p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3 shadow-sm">
          <div className="mb-1.5 text-[11px] text-muted-foreground">
            На заводе · целая
          </div>
          <div className="flex items-baseline gap-4">
            {factory.map((f) => (
              <span key={f.name} className="flex items-baseline gap-1.5">
                <span className="text-xl font-semibold tabular-nums">
                  {f.qty}
                </span>
                <span className="text-xs text-muted-foreground">{f.name}</span>
              </span>
            ))}
          </div>
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            Разные типы тары не суммируются — учёт раздельный.
          </div>
        </div>
      </div>

      <div className="pt-4">
        <TareBalanceMatrix data={data} />
      </div>
    </div>
  );
}
