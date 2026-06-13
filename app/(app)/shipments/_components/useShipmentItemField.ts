import { useEffect } from "react";
import { useWatch, type Control } from "react-hook-form";

import type {
  ShipmentInput,
  ShipmentOptions,
  CulturePackagingOption,
  PackagingNormOption,
  ContractLineOption,
} from "@/server/shipments/schema";
import type { ComboboxOption } from "@/components/ui/combobox";

// Единая точка истины каскада позиции отгрузки (B3 срез 1, рефактор B2.5):
// фермер → культура → тип тары → строка контракта → инфо-тара. Чистые хелперы
// (тестируемы без React) + тонкий хук с двумя эффектами синхронизации стора RHF.
// Поведение B2.5 сохранено 1-в-1. Серверную валидацию/схему НЕ трогаем.

// Разрешённый тип тары для культуры: навал (0 типов) → ""; сохранённый валидный
// тип оставляем; иначе дефолт (is_default), иначе первый. Считается синхронно,
// чтобы Select сразу показывал дефолт, без зависимости от перерисовки Controller.
export function resolvePackagingType(
  typeId: string | undefined,
  packagingTypes: CulturePackagingOption[],
): string {
  if (packagingTypes.length === 0) return "";
  if (typeId && packagingTypes.some((t) => String(t.id) === typeId)) return typeId;
  const def = packagingTypes.find((t) => t.is_default) ?? packagingTypes[0];
  return String(def.id);
}

export type TareInfo =
  | null
  | { ok: false }
  | { ok: true; units: number; typeName: string };

// Инфо-строка тары: норма по тройке (клиент считает для показа, сервер — истина).
export function computeTareInfo(args: {
  hasPackaging: boolean;
  resolvedTypeId: string;
  weight: string | undefined;
  farmerId: string | undefined;
  cultureId: string | undefined;
  packagingTypes: CulturePackagingOption[];
  norms: PackagingNormOption[];
}): TareInfo {
  const { hasPackaging, resolvedTypeId, weight, farmerId, cultureId, packagingTypes, norms } = args;
  if (!hasPackaging || !resolvedTypeId || !weight) return null;
  const w = Number(String(weight).replace(",", "."));
  if (!Number.isFinite(w) || w <= 0) return null;
  const norm = norms.find(
    (n) =>
      String(n.farmer_id) === farmerId &&
      String(n.culture_id) === cultureId &&
      String(n.packaging_type_id) === resolvedTypeId,
  );
  if (!norm) return { ok: false };
  const unit = Number(norm.value);
  const typeName =
    packagingTypes.find((t) => String(t.id) === resolvedTypeId)?.name ?? "тара";
  return { ok: true, units: Math.ceil(w / unit), typeName };
}

// Строки контракта фермера+культуры (текущий сезон). Выбранную при правке
// привязку сохраняем, даже если её строка вне опций сезона (образец FK-Select).
export function filterContractLines(args: {
  contractLines: ContractLineOption[];
  farmerId: string | undefined;
  cultureId: string | undefined;
  lineId: string | undefined;
  extraLineLabels: Record<number, string>;
}): { matching: ContractLineOption[]; lineOptions: ComboboxOption[] } {
  const { contractLines, farmerId, cultureId, lineId, extraLineLabels } = args;
  const matching = contractLines.filter(
    (l) => String(l.farmer_id) === farmerId && String(l.culture_id) === cultureId,
  );
  const lineOptions: ComboboxOption[] = matching.map((l) => ({
    value: String(l.id),
    label: `${l.label ?? `строка #${l.id}`} · ${l.price_per_kg} ₽/кг`,
  }));
  if (lineId && !lineOptions.some((o) => o.value === lineId)) {
    const num = Number(lineId);
    lineOptions.unshift({
      value: lineId,
      label: extraLineLabels[num] ?? `строка #${lineId}`,
    });
  }
  return { matching, lineOptions };
}

export type ShipmentItemFieldState = {
  packagingTypes: CulturePackagingOption[];
  singleType: CulturePackagingOption | null;
  showPackagingSelect: boolean;
  hasPackaging: boolean;
  resolvedTypeId: string;
  tareInfo: TareInfo;
  lineOptions: ComboboxOption[];
  showLine: boolean;
};

export function useShipmentItemField({
  index,
  control,
  options,
  extraLineLabels,
  setLine,
  setPackagingType,
}: {
  index: number;
  control: Control<ShipmentInput>;
  options: ShipmentOptions;
  extraLineLabels: Record<number, string>;
  setLine: (value: string) => void;
  setPackagingType: (value: string) => void;
}): ShipmentItemFieldState {
  const farmerId = useWatch({ control, name: `items.${index}.farmer_id` });
  const cultureId = useWatch({ control, name: `items.${index}.culture_id` });
  const lineId = useWatch({ control, name: `items.${index}.contract_line_id` });
  const typeId = useWatch({ control, name: `items.${index}.packaging_type_id` });
  const weight = useWatch({ control, name: `items.${index}.planned_weight_kg` });

  const culture = options.cultures.find((c) => String(c.id) === cultureId);
  const packagingTypes = culture?.packagingTypes ?? [];
  const typeCount = packagingTypes.length;
  // 0 типов — навал (поля нет); 1 — авто-тип со статичной меткой; ≥2 — select.
  const singleType = typeCount === 1 ? packagingTypes[0] : null;
  const showPackagingSelect = Boolean(cultureId) && typeCount >= 2;
  const hasPackaging = Boolean(cultureId) && typeCount > 0;

  const resolvedTypeId = resolvePackagingType(typeId, packagingTypes);

  // Эффект только синхронизирует стор формы (для submit): навал, смена культуры,
  // авто-дефолт. Отображение уже держит resolvedTypeId.
  useEffect(() => {
    if ((typeId ?? "") !== resolvedTypeId) setPackagingType(resolvedTypeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTypeId]);

  const tareInfo = computeTareInfo({
    hasPackaging,
    resolvedTypeId,
    weight,
    farmerId,
    cultureId,
    packagingTypes,
    norms: options.packagingNorms,
  });

  const { matching, lineOptions } = filterContractLines({
    contractLines: options.contractLines,
    farmerId,
    cultureId,
    lineId,
    extraLineLabels,
  });

  const showLine = Boolean(farmerId && cultureId);
  // Авто-подстановка единственной подходящей строки (если ещё ничего не выбрано).
  useEffect(() => {
    if (showLine && matching.length === 1 && !lineId) {
      setLine(String(matching[0].id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLine, matching.length, lineId]);

  return {
    packagingTypes,
    singleType,
    showPackagingSelect,
    hasPackaging,
    resolvedTypeId,
    tareInfo,
    lineOptions,
    showLine,
  };
}
