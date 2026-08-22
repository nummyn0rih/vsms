"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Phone, Copy, UserRoundCog } from "lucide-react";

import { formatPhone, normalizePhone } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { RoleGate } from "@/components/auth/RoleGate";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listDrivers } from "@/server/drivers/actions";
import { changeShipmentDriver } from "@/server/shipments/actions";
import { changeMaterialShipmentDriver } from "@/server/materials/actions";

// Точечная смена водителя (BR-34): рейс, которому она адресована. Проп
// НЕОБЯЗАТЕЛЬНЫЙ — без него модалка работает ровно как раньше (карточка водителя).
// status нужен дважды: на planned блок не показываем (там водитель правится обычной
// формой отгрузки — один путь на статус), на accepted предупреждаем про акт.
export type DriverChangeTarget = {
  kind: "shipment" | "material";
  id: number;
  currentDriverId: number;
  status: "planned" | "sent" | "arrived" | "accepted";
};

// Модалка водителя (DESIGN §2). Триггер — кнопка «Фамилия · ТК» в левой зоне
// машины. Данные приходят из FeedShipment (passthrough из feed.ts).
export function DriverModal({
  driverName,
  transportCompanyName,
  phone,
  info,
  change,
}: {
  driverName: string;
  transportCompanyName: string | null;
  phone: string | null;
  info: string | null;
  change?: DriverChangeTarget;
}) {
  const [open, setOpen] = useState(false);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} скопировано`);
    } catch {
      toast.error("Не удалось скопировать");
    }
  }

  function copyAll() {
    const parts = [driverName];
    if (transportCompanyName) parts.push(transportCompanyName);
    if (phone) parts.push(formatPhone(phone));
    if (info) parts.push(info);
    copy(parts.join("\n"), "Карточка водителя");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group inline-flex items-center gap-1 text-left text-[13px] tracking-tight"
      >
        <span className="font-medium text-foreground group-hover:text-[#0070f3]">
          {driverName}
        </span>
        {transportCompanyName && (
          <span className="font-normal text-muted-foreground group-hover:text-[#0070f3]">
            · {transportCompanyName}
          </span>
        )}
        {/* Значок (i): окружность + вертикальная линия + точка (прототип). */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="ml-px size-3 shrink-0 text-muted-foreground"
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="11" x2="12" y2="16" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </button>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{driverName}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {transportCompanyName && (
            <span className="inline-flex w-fit items-center rounded-md border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {transportCompanyName}
            </span>
          )}

          {phone ? (
            <a
              href={`tel:${normalizePhone(phone)}`}
              className="inline-flex items-center gap-2 text-sm text-[#0070f3] hover:underline"
            >
              <Phone className="size-4" />
              <span className="tabular-nums">{formatPhone(phone)}</span>
            </a>
          ) : (
            <span className="text-sm italic text-muted-foreground">номер не указан</span>
          )}

          {info && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
              {info}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {phone && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy(formatPhone(phone), "Телефон")}
              >
                <Copy className="size-3.5" /> Скопировать телефон
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={copyAll}>
              <Copy className="size-3.5" /> Скопировать всё
            </Button>
          </div>

          {change && change.status !== "planned" && (
            <RoleGate allow={["admin"]}>
              <ChangeDriverBlock
                change={change}
                currentCompanyName={transportCompanyName}
                onChanged={() => setOpen(false)}
              />
            </RoleGate>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type DriverRow = { id: number; fullName: string; companyName: string | null };

// Блок смены водителя. Список активных водителей грузится ЛЕНИВО — только когда admin
// раскрыл форму: операция редкая, а тянуть справочник на каждый рендер ленты/приёмки
// (там опций нет вовсе) — лишняя выборка.
function ChangeDriverBlock({
  change,
  currentCompanyName,
  onChanged,
}: {
  change: DriverChangeTarget;
  currentCompanyName: string | null;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [drivers, setDrivers] = useState<DriverRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // listDrivers по умолчанию отдаёт только активных и уже отсортирован по фамилии.
      const rows = await listDrivers();
      setDrivers(
        rows.map((d) => ({
          id: d.id,
          fullName: d.full_name,
          companyName: d.transportCompany?.name ?? null,
        })),
      );
    } catch {
      setError("Не удалось загрузить список водителей");
    } finally {
      setLoading(false);
    }
  }, []);

  function openForm() {
    setFormOpen(true);
    if (drivers == null && !loading) void load();
  }

  function closeForm() {
    setFormOpen(false);
    setSelectedId("");
    setReason("");
    setError(null);
  }

  const options: ComboboxOption[] = (drivers ?? []).map((d) => ({
    value: String(d.id),
    label: d.companyName ? `${d.fullName} · ${d.companyName}` : d.fullName,
  }));

  const selected = (drivers ?? []).find((d) => String(d.id) === selectedId);
  const isSame = selectedId === String(change.currentDriverId);
  // ТК приезжает вместе с водителем (акт читает её через driver.transportCompany
  // живьём) — расхождение показываем ДО сохранения, а не отдаём фильтру по ТК.
  const companyChanges =
    selected != null &&
    !isSame &&
    (selected.companyName ?? "") !== (currentCompanyName ?? "");

  async function submit() {
    if (!selectedId || isSame || submitting) return;
    const driverId = Number(selectedId);
    setSubmitting(true);
    setError(null);
    const trimmed = reason.trim();
    const res =
      change.kind === "shipment"
        ? await changeShipmentDriver({
            shipmentId: change.id,
            driverId,
            reason: trimmed || undefined,
          })
        : await changeMaterialShipmentDriver({
            materialShipmentId: change.id,
            driverId,
            reason: trimmed || undefined,
          });
    setSubmitting(false);
    if (res.ok) {
      closeForm();
      onChanged();
      toast.success("Водитель изменён");
      router.refresh();
    } else {
      setError(res.error);
      toast.error(res.error);
    }
  }

  return (
    <div className="mt-1 border-t pt-3">
      {!formOpen ? (
        <Button variant="outline" size="sm" onClick={openForm}>
          <UserRoundCog className="size-3.5" /> Сменить водителя
        </Button>
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="text-xs text-muted-foreground">
            Смена водителя не меняет статус рейса, веса и движения тары.
          </p>

          {loading ? (
            <p className="text-xs text-muted-foreground">Загрузка списка…</p>
          ) : (
            <Combobox
              options={options}
              value={selectedId}
              onChange={setSelectedId}
              placeholder="Новый водитель"
              searchPlaceholder="Поиск по фамилии…"
              emptyText="Водитель не найден"
              disabled={submitting}
            />
          )}

          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            placeholder="Причина (необязательно): поломка тягача · ротация на базе"
            disabled={submitting}
            className="h-10 w-full rounded-md border px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />

          {isSame && (
            <p className="text-xs text-muted-foreground">
              Это текущий водитель рейса — менять нечего.
            </p>
          )}

          {companyChanges && (
            <p className="text-xs text-[#9a5a12]">
              Транспортная компания рейса изменится: {currentCompanyName ?? "—"} →{" "}
              {selected?.companyName ?? "—"}
            </p>
          )}

          {change.status === "accepted" && (
            <p className="text-xs text-[#9a5a12]">
              Рейс принят: имя водителя и ТК в акте и печатных формах изменятся задним
              числом — они читаются из справочника, а не хранятся в акте.
            </p>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={submit} disabled={!selectedId || isSame || submitting}>
              {submitting ? "Сохранение…" : "Сменить"}
            </Button>
            <Button variant="outline" size="sm" onClick={closeForm} disabled={submitting}>
              Отмена
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
