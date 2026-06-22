import { z } from "zod";

// Единый источник валидации Contract + ContractLine: импортируется формой
// (zodResolver) и server actions (safeParse). Не дублировать правила.

// Decimal-поля (volume_tons, price_per_kg) держим СТРОКАМИ, а не coerce.number:
// деньги/объёмы → точность важна, float её теряет. В action строка уходит в Prisma
// Decimal напрямую (Prisma сохраняет точность). Здесь только проверяем «число > 0».
const decimalPositive = (msg: string) =>
  z
    .string()
    .trim()
    .min(1, msg)
    .refine((v) => {
      const n = Number(v.replace(",", "."));
      return Number.isFinite(n) && n > 0;
    }, msg);

// Все Select-id держим СТРОКАМИ (как packaging_type_id у Culture): значение Radix
// Select — строка, RHF хранит её как есть, в action нормализуем Number(). Без coerce —
// он ломает типизацию RHF (input type становится unknown).
//
// Одна строка контракта. label опционален («стандарт», «нестандарт >12»). Дубли культур
// НЕ запрещаем (BR-5) — нет refine на уникальность culture_id.
export const contractLineSchema = z.object({
  culture_id: z.string().trim().min(1, "Выберите культуру"),
  label: z.string().trim().optional(),
  volume_tons: decimalPositive("Объём должен быть больше 0"),
  price_per_kg: decimalPositive("Цена должна быть больше 0"),
});

export type ContractLineInput = z.infer<typeof contractLineSchema>;

export const contractSchema = z.object({
  farmer_id: z.string().trim().min(1, "Выберите фермера"),
  season_year: z.string().trim().min(1, "Выберите сезон"),
  notes: z.string().trim().optional(),
  // Минимум 1 строка. Несколько строк одной культуры допустимы (BR-5).
  lines: z.array(contractLineSchema).min(1, "Добавьте хотя бы одну строку"),
});

export type ContractInput = z.infer<typeof contractSchema>;

// --- View-типы для клиентских компонентов (Decimal → string) ---

// Суммарный объём по культуре в строке списка (просто Σ тонн, без выполнения).
export type CultureVolume = {
  culture_id: number;
  culture_name: string;
  color: string;
  tons: number;
};

export type ContractListRow = {
  id: number;
  farmer_name: string;
  season_year: number;
  lines_count: number;
  volume_by_culture: CultureVolume[];
};

// Строка контракта для карточки/формы. Decimal приходит строкой.
export type ContractLineRow = {
  id: number;
  culture_id: number;
  culture_name: string;
  color: string;
  label: string;
  volume_tons: string;
  price_per_kg: string;
};

export type ContractDetail = {
  id: number;
  farmer_id: number;
  farmer_name: string;
  season_year: number;
  notes: string;
  lines: ContractLineRow[];
};

// Строка с живым выполнением/стоимостью (C3d). Поля 1-в-1 из LineExecutionRow.
// Расчёт — getContractExecution (C3a), ничего не хранится.
export type ContractLineView = ContractLineRow & {
  acceptedKg: number; // принято на строку (живой)
  targetKg: number; // volume_tons × 1000
  pct: number; // выполнение, без округления (округлять на показе)
  remainingKg: number; // может быть < 0 (перевыполнение)
  costRub: number; // accepted × price
  paid: boolean; // в строку попал принятый вес
};

export type ContractDetailView = Omit<ContractDetail, "lines"> & {
  lines: ContractLineView[];
  hasMissingLine: boolean; // есть принятый вес без привязанной строки
};

// Опции для Select'ов формы и фильтров.
export type FarmerOption = { id: number; name: string };
export type SeasonOption = { season_year: number };
export type CultureOption = { id: number; name: string; color: string };
