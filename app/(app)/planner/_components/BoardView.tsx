"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  GripVertical,
  Lock,
  Plus,
  Package,
  Info,
  AlertCircle,
  AlertTriangle,
  Truck,
  Unlink,
  RefreshCcw,
  CheckSquare,
  Square,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import type { BoardWeek, BoardCard, BoardColumn } from "@/server/board/schema";
import type { ShipmentDetail, ShipmentOptions } from "@/server/shipments/schema";
import {
  getShipment,
  assembleShipments,
  disassembleShipment,
} from "@/server/shipments/actions";
import { moveShipmentToDay } from "@/server/board/actions";
import { formatTareTotals } from "@/server/shipments/format";
import { RoleGate } from "@/components/auth/RoleGate";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ShipmentFormDialog } from "@/app/(app)/shipments/_components/ShipmentFormDialog";
import { WholeMachineDialog } from "./WholeMachineDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Прогресс-бар: цель стоит на 95.2%, чтобы оставить поле. EPS — допуск сравнения тонн (3 знака).
const BAR_FILL_PCT = 95.2;
const EPS = 0.0005;

const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", timeZone: "UTC" });
const kgFmt = new Intl.NumberFormat("ru-RU");
// Дефицит ингредиента: до 3 знаков (соль ~кг; микродозы — округление на показе).
const ingFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });
const UNIT_LABEL: Record<"kg" | "l", string> = { kg: "кг", l: "л" };

function parse(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}
function shortWeekday(dateStr: string): string {
  return WEEKDAY_SHORT[(parse(dateStr).getUTCDay() + 6) % 7];
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
// Тонны всегда с 1 знаком (прогресс-бар): «19,0», «−1,8»
function tons1(n: number): string {
  return n.toFixed(1).replace(".", ",");
}
// Подытог дня: «3,24 т» (2 знака) или «—» при нуле
function tons2(kg: number): string {
  return kg > 0 ? `${(kg / 1000).toFixed(2).replace(".", ",")} т` : "—";
}
function pluralMachines(n: number): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return "машина";
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return "машины";
  return "машин";
}
// «Коваль Роман Сергеевич» → «Коваль Р. С.»
function driverShort(full: string): string {
  const [last, ...rest] = full.trim().split(/\s+/);
  const initials = rest.map((p) => `${p.charAt(0).toUpperCase()}.`).join(" ");
  return initials ? `${last} ${initials}` : last;
}

const STATUS_LABEL: Record<BoardCard["status"], string> = {
  planned: "Плановая",
  sent: "Отправлена",
  arrived: "Прибыла",
  accepted: "Принята",
};

// Фон/бордер чипа из Culture.color (прототип: 9% / 18%)
function chipStyle(color: string): React.CSSProperties {
  return {
    background: `color-mix(in srgb, ${color} 9%, #fff)`,
    borderColor: `color-mix(in srgb, ${color} 18%, var(--hairline))`,
  };
}

// Можно ли бросить карточку в день targetISO (клиент-зеркало серверных гардов).
function canDrop(card: BoardCard | null, targetISO: string): boolean {
  if (!card || !card.draggable) return false;
  if (card.arrivalDate === targetISO) return false; // та же колонка — no-op
  if (targetISO < todayISO()) return false; // прошлый день
  // sent: отправление зафиксировано, прибытие не может быть раньше/равно ему
  if (card.arrivalOnly && card.departureDate && targetISO <= card.departureDate) return false;
  return true;
}

// --- Чипы культур (общие для одно-фермерской и машины) ---
function CultureChips({ card }: { card: BoardCard }) {
  return (
    <div className="chips">
      {card.cultures.map((c) => (
        <div key={c.cultureId} className="cchip" style={chipStyle(c.color)}>
          <span className="sq" style={{ background: c.color }} />
          <span className="nm">{c.name}</span>
          <span className="wt tnum">
            {kgFmt.format(c.totalKg)}
            <span className="u">кг</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// B5-2: информационный бейдж дефицита тары/ингредиента у фермеров рейса. Тон —
// амбер из status-fills (как s-arrived). null, если дефицита нет (слот остаётся пуст).
function DeficitBadge({ card }: { card: BoardCard }) {
  const tare = card.tareDeficit ?? [];
  const ing = card.ingredientDeficit ?? [];
  if (tare.length === 0 && ing.length === 0) return null;
  const kinds: string[] = [];
  if (tare.length > 0) kinds.push("тары");
  if (ing.length > 0) kinds.push("ингредиента");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="deficit-chip"
          onClick={(e) => e.stopPropagation()}
          aria-label={`дефицит ${kinds.join(" и ")}`}
        >
          <AlertTriangle />
          дефицит
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="deficit-tip">
          {tare.length > 0 && (
            <div className="dt-group">
              <div className="dt-head">Дефицит тары</div>
              {tare.map((t) => (
                <div key={t.packagingTypeId} className="dt-row">
                  <span>{t.name}</span>
                  <span className="tnum">−{kgFmt.format(t.shortUnits)} ед.</span>
                </div>
              ))}
            </div>
          )}
          {ing.length > 0 && (
            <div className="dt-group">
              <div className="dt-head">Дефицит ингредиента</div>
              {ing.map((i) => (
                <div key={i.ingredientId} className="dt-row">
                  <span>{i.name}</span>
                  <span className="tnum">
                    −{ingFmt.format(i.shortQty)} {UNIT_LABEL[i.unit]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// B5-bulk: загрузка рейса для одно-парной карточки (Σ план / норма рейса).
// Информационно, приглушённо, без нового цвета. Нет нормы/смешанная карточка → null.
function TripCap({ card }: { card: BoardCard }) {
  const cap = card.tripCapacity;
  if (!cap || cap.normKg <= 0) return null;
  const over = cap.plannedKg > cap.normKg;
  const label = over
    ? `перегруз +${tons1((cap.plannedKg - cap.normKg) / 1000)} т`
    : `рейс ${Math.round((cap.plannedKg / cap.normKg) * 100)}%`;
  return <span className={`trip-cap tnum${over ? " over" : ""}`}>{label}</span>;
}

function TareFoot({ card, showDeficit = true }: { card: BoardCard; showDeficit?: boolean }) {
  const tareLabel = formatTareTotals(card.tare.boxes, card.tare.barrels);
  return (
    <>
      <span className="tara">
        <Package />
        <b>{tareLabel ? `${card.status === "planned" ? "≈ " : ""}${tareLabel}` : "навал"}</b>
      </span>
      <TripCap card={card} />
      {/* B5-2: бейдж дефицита (single). В машине рендерится в .mcard-actions. */}
      <span className="deficit-slot">{showDeficit && <DeficitBadge card={card} />}</span>
    </>
  );
}

function Dates({ card }: { card: BoardCard }) {
  const dep = card.departureDate ? dayFmt.format(parse(card.departureDate)) : "—";
  const arr = card.arrivalDate ? dayMonthFmt.format(parse(card.arrivalDate)) : "—";
  return (
    <span className="card-dates">
      <span className="dep">{dep}</span>
      <span className="arrow">→</span>
      <span className="arr">{arr}</span>
    </span>
  );
}

// Хват/замок. Для перетаскиваемых карточек — слушатели dnd-kit на хвате.
function Handle({
  draggable,
  locked,
  listeners,
  attributes,
  setActivatorNodeRef,
}: {
  draggable: boolean;
  locked: boolean;
  listeners?: ReturnType<typeof useDraggable>["listeners"];
  attributes?: ReturnType<typeof useDraggable>["attributes"];
  setActivatorNodeRef?: (el: HTMLElement | null) => void;
}) {
  if (locked) {
    return (
      <span className="card-handle" title="Залочена — перенос недоступен">
        <Lock />
      </span>
    );
  }
  return (
    <span
      className="card-handle"
      ref={setActivatorNodeRef}
      title={draggable ? "Перетащите на другой день" : "Перенос — только для администратора"}
      onClick={(e) => e.stopPropagation()}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
    >
      <GripVertical />
    </span>
  );
}

function SingleCard({
  card,
  canDrag,
  onOpen,
  selectable,
  selected,
  onToggleSelect,
}: {
  card: BoardCard;
  canDrag: boolean;
  onOpen: (id: number) => void;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({ id: card.shipmentId, disabled: !canDrag });
  const farmer = card.farmers[0];

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`card s-${card.status} ${canDrag ? "draggable" : ""} ${
        card.locked ? "locked" : ""
      } ${isDragging ? "dragging" : ""} ${selectable ? "selectable" : ""} ${
        selected ? "selected" : ""
      }`}
      onClick={() => (selectable ? onToggleSelect(card.shipmentId) : onOpen(card.shipmentId))}
    >
      <div className="card-strip" />
      <div className="card-top">
        {selectable && (
          <button
            type="button"
            className="card-check"
            title={selected ? "Снять выбор" : "Выбрать для сборки"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(card.shipmentId);
            }}
          >
            {selected ? <CheckSquare /> : <Square />}
          </button>
        )}
        <span className={`badge s-${card.status}`}>
          <span className="dot" />
          {STATUS_LABEL[card.status]}
        </span>
        <Dates card={card} />
        <Handle
          draggable={canDrag}
          locked={card.locked}
          listeners={listeners}
          attributes={attributes}
          setActivatorNodeRef={setActivatorNodeRef}
        />
      </div>
      <div className="card-body">
        <div>
          <div className="farmer">{farmer?.farmerName ?? "—"}</div>
          {card.driverName ? (
            <span className="driver">
              {driverShort(card.driverName)}
              {card.transportCompanyName ? ` · ${card.transportCompanyName}` : ""}
              <Info className="i" />
            </span>
          ) : (
            <span className="driver driver-none">водитель не назначен</span>
          )}
        </div>
        <CultureChips card={card} />
        <div className="card-foot">
          <TareFoot card={card} />
        </div>
      </div>
    </article>
  );
}

function MachineCard({
  card,
  canDrag,
  onOpen,
  onDisassemble,
}: {
  card: BoardCard;
  canDrag: boolean;
  onOpen: (id: number) => void;
  onDisassemble: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({ id: card.shipmentId, disabled: !canDrag });

  const handle = (
    <Handle
      draggable={canDrag}
      locked={card.locked}
      listeners={listeners}
      attributes={attributes}
      setActivatorNodeRef={setActivatorNodeRef}
    />
  );

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`card mcard s-${card.status} ${canDrag ? "draggable" : ""} ${
        card.locked ? "locked" : ""
      } ${isDragging ? "dragging" : ""}`}
      onClick={() => onOpen(card.shipmentId)}
    >
      <div className="card-top">
        <span className="mtag">
          <Truck />
          Машина
        </span>
        {card.arrivalOnly ? (
          <span className={`badge s-${card.status}`} style={{ marginLeft: "auto" }}>
            <span className="dot" />
            {STATUS_LABEL[card.status]}
          </span>
        ) : (
          <>
            <Dates card={card} />
            {handle}
          </>
        )}
      </div>

      {/* sent: маркер «перенос только прибытия» + даты/хват во второй строке */}
      {card.arrivalOnly && (
        <div className="card-top" style={{ paddingTop: 7 }}>
          <span
            className="arronly"
            title="Перенос меняет только дату прибытия — отправление зафиксировано"
          >
            <RefreshCcw />
            перенос: только прибытие
          </span>
          <Dates card={card} />
          {handle}
        </div>
      )}

      <div className="card-body">
        <div className="farmers-line">
          {card.farmers.map((f, i) => (
            <span key={f.farmerId}>
              {i > 0 && <span className="sepdot">·</span>}
              {f.farmerName}
            </span>
          ))}
        </div>
        <div className="frows">
          {card.farmers.map((f) => (
            <div key={f.farmerId} className="frow">
              <span className="fn">{f.farmerName}</span>
              <span className="fc">{f.cultureNames.join(" · ")}</span>
              <span className="ft tnum">{kgFmt.format(f.totalKg)} кг</span>
            </div>
          ))}
        </div>
        <CultureChips card={card} />
        <div className="card-foot">
          <TareFoot card={card} showDeficit={false} />
        </div>
        <div className="mcard-actions">
          {/* B5-merge: разборка машины — только плановую, admin-only, с подтверждением */}
          {card.status === "planned" && (
            <RoleGate allow={["admin"]}>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    className="btn-disassemble"
                    title="Разобрать на отдельные отгрузки"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Unlink />
                    Разобрать
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Разобрать машину {card.code}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Машина разделится на {card.farmers.length} отдельных плановых отгрузки
                      (по фермеру). Водитель будет снят. Действие обратимо сборкой.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onDisassemble(card.shipmentId)}>
                      Разобрать
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </RoleGate>
          )}
          <span className="deficit-slot" style={{ marginLeft: "auto" }}>
            <DeficitBadge card={card} />
          </span>
        </div>
      </div>
    </article>
  );
}

function BoardCardView({
  card,
  isAdmin,
  onOpen,
  selectMode,
  selected,
  onToggleSelect,
  onDisassemble,
}: {
  card: BoardCard;
  isAdmin: boolean;
  onOpen: (id: number) => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: number) => void;
  onDisassemble: (id: number) => void;
}) {
  // В режиме выбора drag отключаем — клик по карточке = выбор.
  const canDrag = card.draggable && isAdmin && !selectMode;
  return card.farmers.length > 1 ? (
    <MachineCard card={card} canDrag={canDrag} onOpen={onOpen} onDisassemble={onDisassemble} />
  ) : (
    <SingleCard
      card={card}
      canDrag={canDrag}
      onOpen={onOpen}
      selectable={selectMode && isAdmin && card.status === "planned"}
      selected={selected}
      onToggleSelect={onToggleSelect}
    />
  );
}

function Column({
  col,
  isAdmin,
  activeCard,
  onOpen,
  onAdd,
  selectMode,
  selected,
  onToggleSelect,
  onAssemble,
  onDisassemble,
}: {
  col: BoardColumn;
  isAdmin: boolean;
  activeCard: BoardCard | null;
  onOpen: (id: number) => void;
  onAdd: (col: BoardColumn) => void;
  selectMode: boolean;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  onAssemble: (ids: number[]) => void;
  onDisassemble: (id: number) => void;
}) {
  const { setNodeRef } = useDroppable({ id: col.dateISO });
  const dropReady = activeCard != null && canDrop(activeCard, col.dateISO);

  // Выбранные сборочные id ИМЕННО этой колонки (одно-фермерские плановые) — скоуп днём.
  const selectedInCol = col.cards
    .filter((c) => c.status === "planned" && c.farmers.length === 1 && selected.has(c.shipmentId))
    .map((c) => c.shipmentId);

  return (
    <section
      ref={setNodeRef}
      className={`col${col.cards.length === 0 ? " is-empty" : ""}${
        dropReady ? " drop-ready" : ""
      }${dropReady && activeCard?.arrivalOnly ? " arr-only" : ""}`}
    >
      <div className="col-head">
        <span className="dow">{shortWeekday(col.dateISO)}</span>
        <span className="date">{dayMonthFmt.format(parse(col.dateISO))}</span>
        <span className="sub">
          <b>{col.machineCount}</b> {pluralMachines(col.machineCount)} ·{" "}
          <b>{tons2(col.daySubtotalKg)}</b>
        </span>
      </div>
      <div className="col-body">
        {col.cards.length === 0 ? (
          <div className="col-empty-hint">Нет отгрузок</div>
        ) : (
          col.cards.map((card) => (
            <BoardCardView
              key={card.shipmentId}
              card={card}
              isAdmin={isAdmin}
              onOpen={onOpen}
              selectMode={selectMode}
              selected={selected.has(card.shipmentId)}
              onToggleSelect={onToggleSelect}
              onDisassemble={onDisassemble}
            />
          ))
        )}
      </div>
      <div className="col-foot">
        {selectMode && selectedInCol.length >= 2 && (
          <button
            type="button"
            className="assemble-btn"
            onClick={() => onAssemble(selectedInCol)}
          >
            <Truck />
            Собрать в машину ({selectedInCol.length})
          </button>
        )}
        <RoleGate allow={["admin"]}>
          <button type="button" className="addship" onClick={() => onAdd(col)}>
            <Plus />
            Отгрузка
          </button>
        </RoleGate>
      </div>
    </section>
  );
}

function ProgressBar({
  planned,
  target,
  color,
}: {
  planned: number;
  target: number;
  color: string;
}) {
  const scaleMax = Math.max(target, planned);
  const fillPct = scaleMax > 0 ? (planned / scaleMax) * BAR_FILL_PCT : 0;
  const tickPct = scaleMax > 0 ? (target / scaleMax) * BAR_FILL_PCT : 0;
  const over = planned > target + EPS;
  return (
    <div className={`mbar${over ? " over" : ""}`}>
      <div className="fill" style={{ width: `${fillPct}%`, background: color }} />
      <div className="tick" style={{ left: `${tickPct}%` }} />
    </div>
  );
}

export function BoardView({
  week,
  loading,
  options,
  reload,
  onOpenPlan,
}: {
  week: BoardWeek | null;
  loading: boolean;
  options: ShipmentOptions;
  reload: () => void | Promise<void>;
  onOpenPlan: () => void;
}) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";

  // Локальная копия колонок — для оптимистичного переноса. Синк с week делаем в
  // фазе рендера (паттерн React «информация из предыдущего рендера»), а не в effect.
  const [columns, setColumns] = useState<BoardColumn[]>(week?.columns ?? []);
  const [prevWeek, setPrevWeek] = useState(week);

  // Режим выбора для сборки в машину (тумблер «Выбрать»). Скоуп выбора — колонка (день).
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // B5-bulk: диалог «Целая машина».
  const [wholeOpen, setWholeOpen] = useState(false);

  if (week !== prevWeek) {
    setPrevWeek(week);
    setColumns(week?.columns ?? []);
    // Смена недели — выходим из выбора (выбранные id больше не на экране).
    setSelectMode(false);
    setSelected(new Set());
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function onAssemble(ids: number[]) {
    const res = await assembleShipments(ids);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Машина собрана");
    exitSelect();
    await reload();
  }

  async function onDisassemble(id: number) {
    const res = await disassembleShipment(id);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Машина разобрана");
    await reload();
  }

  const [activeId, setActiveId] = useState<number | null>(null);
  const activeCard =
    activeId != null
      ? (columns.flatMap((c) => c.cards).find((c) => c.shipmentId === activeId) ?? null)
      : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Хост диалога правки (детали грузим лениво по клику).
  const [editOpen, setEditOpen] = useState(false);
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  // Хост диалога создания из колонки («+ Отгрузка»): даты дня.
  const [addDefaults, setAddDefaults] = useState<{
    arrival_date: string;
    departure_date: string;
  } | null>(null);

  async function openCard(id: number) {
    const d = await getShipment(id);
    if (!d) {
      toast.error("Отгрузка не найдена");
      return;
    }
    setDetail(d);
    setEditOpen(true);
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(Number(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    const card = activeCard;
    setActiveId(null);
    if (!card || !e.over) return;
    const targetISO = String(e.over.id);
    if (!canDrop(card, targetISO)) return;

    // Оптимистично переносим карточку в целевую колонку (прибытие = день).
    setColumns((prev) =>
      prev.map((col) => {
        if (col.dateISO === card.arrivalDate) {
          return { ...col, cards: col.cards.filter((c) => c.shipmentId !== card.shipmentId) };
        }
        if (col.dateISO === targetISO) {
          return { ...col, cards: [...col.cards, { ...card, arrivalDate: targetISO }] };
        }
        return col;
      }),
    );

    const res = await moveShipmentToDay(card.shipmentId, targetISO);
    if (!res.ok) toast.error(res.error);
    // В обоих случаях перечитываем авторитетные данные (успех → новые даты;
    // ошибка → откат к серверному состоянию).
    await reload();
  }

  if (!week) {
    return (
      <div className="board-wrap">
        <p className="text-sm text-[#888]">{loading ? "Загрузка…" : "Нет доступа"}</p>
      </div>
    );
  }

  // Кластер действий доски — живёт в полосе прогресса справа (admin-only). Расширяемый:
  // позже рядом встанет «+ Целая машина» (B5-bulk). Нужен в обоих вариантах полосы.
  const boardActions = (
    <RoleGate allow={["admin"]}>
      <div className="board-actions">
        <button
          type="button"
          className="select-toggle"
          onClick={() => setWholeOpen(true)}
        >
          <Truck />
          Целая машина
        </button>
        <button
          type="button"
          className={`select-toggle${selectMode ? " on" : ""}`}
          onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
        >
          <CheckSquare />
          {selectMode ? "Готово" : "Выбрать"}
        </button>
      </div>
    </RoleGate>
  );

  return (
    <>
      {/* Прогресс к плану (или намёк, если плана нет) */}
      {week.hasPlan ? (
        <div className="progress">
          <div className="pg-lead">
            <span className="t">Прогресс к плану</span>
            <span className="v tnum">
              {tons1(week.totalPlannedTons)}{" "}
              <span className="g">/ {tons1(week.totalTargetTons)} т</span>
            </span>
          </div>
          <div className="pgbars">
            {week.progress.map((p) => {
              const delta = p.plannedTons - p.targetTons;
              const over = delta > EPS;
              return (
                <div key={p.cultureId} className="pgcol">
                  <div className="pgcol-top">
                    <span className="sq" style={{ background: p.color }} />
                    <span className="nm">{p.name}</span>
                    <span className={`delta ${over ? "over" : "under"} tnum`}>
                      {over ? "+" : "−"}
                      {tons1(Math.abs(delta))}
                    </span>
                  </div>
                  <ProgressBar planned={p.plannedTons} target={p.targetTons} color={p.color} />
                  <div className="pgcol-cap tnum">
                    {tons1(p.plannedTons)} <span className="g">/ {tons1(p.targetTons)} т</span>
                  </div>
                </div>
              );
            })}
          </div>
          {boardActions}
        </div>
      ) : (
        <div className="progress flat">
          <div className="noplan">
            <AlertCircle />
            Цели по культурам на неделю не заданы — прогресс не считается.{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onOpenPlan();
              }}
            >
              Задать план →
            </a>
          </div>
          {boardActions}
        </div>
      )}

      {/* Доска: колонки рабочих дней, карточки по дате прибытия */}
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <TooltipProvider delayDuration={150}>
        <div className="board-wrap">
          <div className="board" style={{ "--cols": columns.length } as React.CSSProperties}>
            {columns.map((col) => (
              <Column
                key={col.dateISO}
                col={col}
                isAdmin={isAdmin}
                activeCard={activeCard}
                onOpen={openCard}
                onAdd={(c) =>
                  setAddDefaults({
                    arrival_date: c.dateISO,
                    departure_date: c.addDepartureISO,
                  })
                }
                selectMode={selectMode}
                selected={selected}
                onToggleSelect={toggleSelect}
                onAssemble={onAssemble}
                onDisassemble={onDisassemble}
              />
            ))}
          </div>
        </div>
        </TooltipProvider>
        <DragOverlay dropAnimation={null}>
          {activeCard ? (
            <div className="drag-ghost">
              {activeCard.farmers.length > 1
                ? "Машина"
                : (activeCard.farmers[0]?.farmerName ?? "Отгрузка")}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {detail && (
        <ShipmentFormDialog
          // key по id — форма реинициализируется под СВОЮ отгрузку при смене карточки
          key={detail.id}
          mode="edit"
          row={detail}
          options={options}
          open={editOpen}
          onOpenChange={(o) => {
            setEditOpen(o);
            if (!o) void reload();
          }}
          showTrigger={false}
        />
      )}

      {wholeOpen && (
        <WholeMachineDialog
          options={options}
          columns={columns}
          open={true}
          onOpenChange={setWholeOpen}
          onSuccess={reload}
        />
      )}

      {addDefaults && (
        <ShipmentFormDialog
          // key по дате — форма пере-инициализируется новыми дефолтами на каждый день
          key={addDefaults.arrival_date}
          mode="create"
          options={options}
          createDefaults={addDefaults}
          open={true}
          onOpenChange={(o) => {
            if (!o) {
              setAddDefaults(null);
              void reload();
            }
          }}
          showTrigger={false}
        />
      )}
    </>
  );
}
