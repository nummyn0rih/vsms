"use client";

import { FileText, Loader2 } from "lucide-react";

// Кнопка «Акт» на позиции (BR-13: приёмка позиционная). Триггер — открытие диалога
// делает доска (markArrived + getActContext), чтобы диалог пережил перетасовку зон
// (фикс 1). accepted → бейдж «принят», клик открывает форму на редактирование.
// user (read-only) — только бейдж/«—».
export function ActButton({
  shipmentItemId,
  machineId,
  machineStatus,
  accepted,
  actNumber,
  canEdit,
  pending,
  onOpenAct,
}: {
  shipmentItemId: number;
  machineId: number;
  machineStatus: "sent" | "arrived";
  accepted: boolean;
  actNumber: string | null;
  canEdit: boolean;
  pending: boolean;
  onOpenAct: (
    itemId: number,
    machineId: number,
    machineStatus: "sent" | "arrived",
  ) => void;
}) {
  // № акта прямо на кнопке (acceptance-ux-2): раньше он жил только в title, и найти
  // нужный акт можно было лишь наведением на каждую позицию. Номер — техническая метка,
  // значит Geist Mono (DESIGN-SYSTEM). Акт без номера (старые данные) — прежняя подпись.
  const label = actNumber ? (
    <>
      Акт <span className="font-mono">№ {actNumber}</span>
    </>
  ) : (
    "Акт принят"
  );

  // user: только индикатор, без действий.
  if (!canEdit) {
    return accepted ? (
      <span className="inline-flex items-center gap-1 truncate text-xs font-medium tabular-nums text-[#1d8e75]">
        <FileText className="size-3 shrink-0" /> {label}
      </span>
    ) : (
      <span className="text-xs text-[#888888]">—</span>
    );
  }

  const onClick = () => onOpenAct(shipmentItemId, machineId, machineStatus);

  return accepted ? (
    <button
      onClick={onClick}
      disabled={pending}
      title={actNumber ? `Акт № ${actNumber} · открыть` : undefined}
      className="inline-flex h-7 max-w-full items-center gap-1.5 truncate rounded-md border border-[#c7f6ea] bg-[#ddfff7] px-2.5 text-[0.8rem] font-medium tracking-tight text-[#1d8e75] hover:bg-[#c7f6ea]"
    >
      <FileText className="size-3.5 shrink-0" /> {label}
    </button>
  ) : (
    <button
      onClick={onClick}
      disabled={pending}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#171717] bg-[#171717] px-2.5 text-[0.8rem] font-medium tracking-tight text-white hover:bg-[#171717]/90 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <FileText className="size-3.5" />
      )}{" "}
      Акт
    </button>
  );
}
