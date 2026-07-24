"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Filter, PackageOpen } from "lucide-react";

import type { AcceptanceBoard as Board, ActContext } from "@/server/acceptance/schema";
import { markArrived } from "@/server/acceptance/actions";
import { getActContext } from "@/server/acceptance/act";
import {
  filterBoard,
  boardOptions,
  anyAcceptanceFilterActive,
} from "@/server/acceptance/board-filter";
import { writeUrlParam } from "@/app/(app)/shipments/_components/week-format";
import { MobileAcceptanceCard } from "./MobileAcceptanceCard";
import { MobileAcceptedCard } from "./MobileAcceptedCard";
import { MobileActDialog } from "./MobileActDialog";
import { MobileAcceptanceFilterSheet } from "./MobileAcceptanceFilterSheet";

type ZoneKey = "zone1" | "zone2" | "zone3";

function EmptyZone({ note }: { note: string }) {
  return (
    <div className="m-empty">
      <div className="ec-ic">
        <PackageOpen />
      </div>
      <div className="ed">{note}</div>
    </div>
  );
}

// Мобильная доска приёмки (<md) — те же данные (getAcceptanceBoard) и server actions,
// что десктопная AcceptanceBoard. Зоны — сегмент-таб (BR-26), состояние в ?zone=
// (writeUrlParam, тот же паттерн, что ?week= в ленте). Диалог акта — на доске, не в
// карточке: markArrived перетасовывает зоны (sent→arrived), карточка размонтируется
// (тот же фикс, что десктопная AcceptanceBoard.tsx).
export function MobileAcceptanceBoard({
  board,
  initialZone,
}: {
  board: Board;
  initialZone: ZoneKey;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canEdit = role === "operator" || role === "admin";
  const isAdmin = role === "admin";

  const [zone, setZone] = useState<ZoneKey>(initialZone);
  const [actState, setActState] = useState<{ context: ActContext; fromSent: boolean } | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  // --- Фильтры (React state, без localStorage) — те же три оси и тот же движок
  // (board-filter.ts), что на десктопной доске. Опции — из полного board. ---
  const [search, setSearch] = useState("");
  const [supplierSel, setSupplierSel] = useState<Set<number>>(new Set());
  const [cultureSel, setCultureSel] = useState<Set<number>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);

  const options = useMemo(() => boardOptions(board), [board]);
  const view = useMemo(
    () => filterBoard(board, { search, supplierSel, cultureSel }),
    [board, search, supplierSel, cultureSel],
  );
  const anyFilterActive = anyAcceptanceFilterActive({ search, supplierSel, cultureSel });
  const filterCount = supplierSel.size + cultureSel.size + (search.trim() ? 1 : 0);

  function toggleNum(setSet: React.Dispatch<React.SetStateAction<Set<number>>>, id: number) {
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function resetAll() {
    setSearch("");
    setSupplierSel(new Set());
    setCultureSel(new Set());
  }

  // Пусто после фильтра показываем осмысленной подписью, а не дефолтной «Нет машин…».
  const emptyNote = (base: string) =>
    anyFilterActive ? "Ничего не найдено по фильтрам." : base;

  function selectZone(z: ZoneKey) {
    setZone(z);
    writeUrlParam("zone", z);
  }

  async function onOpenAct(
    itemId: number,
    machineId: number,
    machineStatus: "sent" | "arrived",
  ) {
    setPendingId(itemId);
    const fromSent = machineStatus === "sent";
    if (fromSent) {
      const arr = await markArrived({ shipmentId: machineId });
      if (!arr.ok) {
        setPendingId(null);
        toast.error(arr.error);
        return;
      }
    }
    const ctx = await getActContext({ shipmentItemId: itemId });
    setPendingId(null);
    if (!ctx) {
      toast.error("Позиция не найдена");
      return;
    }
    setActState({ context: ctx, fromSent });
  }

  return (
    <div className="md:hidden">
      {/* Строка фильтров — дизайн вербатим из .mweekbar ленты, но БЕЗ sticky (`static`):
          иначе она и .zone-seg липнут к одному top: 54px и сегмент зон перекрывает кнопку. */}
      <div className="mweekbar static">
        <div className="mweekbar-row">
          <button type="button" className="filter-btn" onClick={() => setSheetOpen(true)}>
            Фильтры
            {filterCount > 0 && <span className="fdot">{filterCount}</span>}
            <Filter />
          </button>
        </div>
      </div>

      <div className="zone-seg">
        <button
          type="button"
          className={`zone-tab${zone === "zone1" ? " active" : ""}`}
          onClick={() => selectZone("zone1")}
        >
          <span className="zt-count">{view.zone1.length}</span>
          <span className="zt-lab">Ожидают перевески</span>
        </button>
        <button
          type="button"
          className={`zone-tab${zone === "zone2" ? " active" : ""}`}
          onClick={() => selectZone("zone2")}
        >
          <span className="zt-count">{view.zone2.length}</span>
          <span className="zt-lab">На приёмке</span>
        </button>
        <button
          type="button"
          className={`zone-tab${zone === "zone3" ? " active" : ""}`}
          onClick={() => selectZone("zone3")}
        >
          <span className="zt-count">{view.acceptedCount}</span>
          <span className="zt-lab">Принято</span>
        </button>
      </div>

      <div className="acards">
        {zone === "zone1" &&
          (view.zone1.length === 0 ? (
            <EmptyZone note={emptyNote("Нет машин в пути.")} />
          ) : (
            view.zone1.map((m) => (
              <MobileAcceptanceCard
                key={m.id}
                machine={m}
                canEdit={canEdit}
                pendingId={pendingId}
                onOpenAct={onOpenAct}
              />
            ))
          ))}

        {zone === "zone2" &&
          (view.zone2.length === 0 ? (
            <EmptyZone note={emptyNote("Нет машин на приёмке.")} />
          ) : (
            view.zone2.map((m) => (
              <MobileAcceptanceCard
                key={m.id}
                machine={m}
                canEdit={canEdit}
                pendingId={pendingId}
                onOpenAct={onOpenAct}
              />
            ))
          ))}

        {zone === "zone3" &&
          (view.zone3.length === 0 ? (
            <EmptyZone note={emptyNote("Нет принятых машин.")} />
          ) : (
            view.zone3.map((m) => <MobileAcceptedCard key={m.id} machine={m} isAdmin={isAdmin} />)
          ))}
      </div>

      {actState && (
        <MobileActDialog
          key={actState.context.shipmentItemId}
          context={actState.context}
          open
          onOpenChange={(v) => {
            if (!v) {
              setActState(null);
              router.refresh();
            }
          }}
          openedFromSent={actState.fromSent}
          isAdmin={isAdmin}
        />
      )}

      <MobileAcceptanceFilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        board={board}
        options={options}
        search={search}
        supplierSel={supplierSel}
        cultureSel={cultureSel}
        onSearch={setSearch}
        onToggleSupplier={(id) => toggleNum(setSupplierSel, id)}
        onToggleCulture={(id) => toggleNum(setCultureSel, id)}
        onReset={resetAll}
      />
    </div>
  );
}
