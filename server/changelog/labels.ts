import { FACTORY_TZ, parseDateUTC } from "@/server/shipments/workdays";

// Словарь подписей журнала изменений. Файл БЕЗ prisma и БЕЗ requireRole — чтобы ядро
// покрывалось юнит-тестами без БД и сессии (эталон — analytics/culture-agg.ts).
// Загрузчик страницы журнала — рядом, в ./query. Писателя (server/changelog.ts) не трогаем.
//
// ГЛАВНЫЙ ИНВАРИАНТ: неизвестный entity/field/значение возвращается КАК ЕСТЬ.
// Никогда не бросаем и никогда не прячем запись — журнал обязан показывать всё, что
// записано, даже если словарь отстал от кода. Иначе правка, сделанная новым модулем,
// молча исчезнет из аудита (BR-16).

// ---------------------------------------------------------------- сущности

// Все 20 фактических значений ChangeLog.entity (константы ENTITY в server/*/actions.ts,
// server/plan/schema.ts, server/norms/schema.ts + инлайн "StockMovement" в inventory/).
export const ENTITY_LABELS: Record<string, string> = {
  Farmer: "Поставщик",
  Culture: "Культура",
  Driver: "Водитель",
  TransportCompany: "Транспортная компания",
  PackagingType: "Тип тары",
  Ingredient: "Ингредиент",
  SeasonConfig: "Настройки сезона",
  AlertRule: "Порог алерта",
  IngredientRecipe: "Рецептура",
  PackagingNorm: "Норма тары",
  TripWeightNorm: "Норма веса рейса",
  Contract: "Контракт",
  ContractLine: "Строка контракта",
  Shipment: "Отгрузка",
  ShipmentItem: "Позиция отгрузки",
  AcceptanceAct: "Акт приёмки",
  MaterialShipment: "Рейс материалов",
  WeeklyPlan: "План недели",
  WeeklyPlanScope: "Состав недели",
  StockMovement: "Движение склада",
};

export function entityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? entity;
}

// Опции фильтра «Сущность» (FilterCombo). Сортировка по подписи, а не по коду:
// пользователь ищет «Акт приёмки», а не AcceptanceAct.
export const ENTITY_OPTIONS: { id: string; name: string }[] = Object.entries(
  ENTITY_LABELS,
)
  .map(([id, name]) => ({ id, name }))
  .sort((a, b) => a.name.localeCompare(b.name, "ru"));

// Записи без сессии (скрипты, миграции) имеют user_id = null. В URL-фильтре им нужен
// свой опознаватель — числовой id занять нечем.
export const SYSTEM_USER_ID = "system";
export const SYSTEM_USER_LABEL = "система";

// ------------------------------------------------------------------- поля

// Два яруса. Сквозные поля (created/deleted/status/name…) пишутся многими доменами —
// держим их одним ключом, а точечный "<Entity>.<field>" заводим только там, где общей
// подписи мало. Поиск: "Entity.field" → "field" → сырое имя поля.
export const FIELD_LABELS: Record<string, string> = {
  // --- сквозные ---
  created: "Создано",
  updated: "Изменено",
  deleted: "Удалено",
  active: "Статус записи",
  status: "Статус",
  name: "Название",
  full_name: "ФИО",
  notes: "Заметки",
  comment: "Комментарий",
  info: "Примечание",
  contacts: "Контакты",
  phone: "Телефон",
  color: "Цвет",
  items: "Позиции",
  lines: "Строки",
  movements: "Движения склада",
  storno: "Сторно",
  farmer_id: "Поставщик",
  culture_id: "Культура",
  driver_id: "Водитель",
  transport_company_id: "Транспортная компания",
  contract_line_id: "Строка контракта",
  source_farmer_id: "Откуда (поставщик)",
  departure_date: "Дата отгрузки",
  arrival_date: "Дата прибытия",
  season_year: "Сезон",
  // --- отгрузки и приёмка ---
  bulk_create: "Массовое создание",
  assemble: "Сборка машины",
  disassemble: "Разборка машины",
  item_arrived: "Позиция прибыла",
  item_unarrived: "Откат прибытия позиции",
  actual_weight_kg: "Фактический вес, кг",
  settlement_percent: "Процент к оплате",
  brak_percent: "Брак, %",
  act_number: "№ акта",
  // --- справочники и нормы ---
  kind: "Вид",
  unit: "Единица измерения",
  capacity_kg: "Вместимость, кг",
  acceptance_type: "Тип приёмки",
  packaging_types: "Типы тары",
  calibre_scheme: "Схема калибров",
  qty_per_kg_product: "Норма на 1 кг продукта",
  avg_unit_weight_kg: "Средний вес единицы, кг",
  planned_trip_weight_kg: "Плановый вес рейса, кг",
  // --- контракты ---
  price_per_kg: "Цена, ₽/кг",
  volume_tons: "Объём, т",
  label: "Метка",
  // --- план недели ---
  target_tons: "Цель, т",
  convert_days_to_week: "Конверсия: дни → неделя",
  convert_week_to_days: "Конверсия: неделя → дни",
  scope_add: "Культура добавлена в неделю",
  scope_remove: "Культура убрана из недели",
  // --- сезон и алерты ---
  summer_start: "Начало лета",
  summer_end: "Конец лета",
  summer_workdays: "Рабочие дни (лето)",
  winter_workdays: "Рабочие дни (зима)",
  item_kind: "Тип позиции",
  item_id: "Номенклатура",
  location_scope: "Область (локация)",
  threshold: "Порог",
  // --- склад ---
  scrap: "Списание (брак)",
  disposal: "Утилизация",
  opening: "Начальный остаток",

  // --- точечные переопределения ---
  "Shipment.status": "Статус машины",
  "Shipment.items": "Позиции машины",
  "MaterialShipment.status": "Статус рейса",
  "MaterialShipment.items": "Позиции рейса",
  "AcceptanceAct.created": "Акт создан",
  "AcceptanceAct.updated": "Акт изменён",
  "AcceptanceAct.deleted": "Акт удалён",
  "AcceptanceAct.movements": "Движения по акту",
  "AcceptanceAct.calibres": "Категории калибра",
  // Строки контракта пишутся по-строчно (entity ContractLine). Ключ Contract.lines оставлен
  // ради ИСТОРИЧЕСКИХ записей со сводкой «N строк(а)» — новых таких больше не появляется.
  "Contract.lines": "Строки контракта",
  "ContractLine.created": "Строка добавлена",
  "ContractLine.deleted": "Строка удалена",
  "SeasonConfig.season_year": "Год сезона",
  "AlertRule.item_id": "Номенклатура (тара/ингредиент)",
};

export function fieldLabel(entity: string, field: string): string {
  return FIELD_LABELS[`${entity}.${field}`] ?? FIELD_LABELS[field] ?? field;
}

// ---------------------------------------------------------------- значения

export const EMPTY_VALUE = "—";

// Статусы отгрузки и рейса материалов — один и тот же enum ShipmentStatus.
const STATUS_VALUES: Record<string, string> = {
  planned: "Плановая",
  sent: "Отправлена",
  arrived: "Прибыла",
  accepted: "Принята",
};

// Значения enum'ов по имени поля. Ключ — имя поля, значение — словарь его значений.
const VALUE_DICTS: Record<string, Record<string, string>> = {
  status: STATUS_VALUES,
  active: { true: "активен", false: "архив" },
  acceptance_type: { simple: "Простая", calibre: "По калибрам" },
  kind: { box: "Ящик", barrel: "Бочка" },
  unit: { kg: "кг", l: "л" },
  item_kind: { packaging: "Тара", ingredient: "Ингредиент" },
};

// Даты писатель кладёт в ISO. Узнаём их ПО ФОРМЕ значения, а не по имени поля:
// даты пишут departure_date, arrival_date, summer_start и всё, что появится дальше,
// а перечислять их поимённо — обречь словарь на отставание. № акта вида «2026-12312»
// под шаблон не подходит и остаётся нетронутым.
const ISO_VALUE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Значение для показа. null и пустая строка → «—» (alert-rules пишет "" вместо null,
 * а пустая ячейка визуально читается как поломка). Дальше — словарь поля, потом дата.
 * Всё остальное отдаётся сырым: свободные сводки писателя («12 движ.: Ящик ×340»,
 * JSON контактов) уже читаемы, а незнакомое значение лучше показать как есть.
 */
export function formatValue(
  entity: string,
  field: string,
  value: string | null,
): string {
  if (value == null || value === "") return EMPTY_VALUE;
  const known = VALUE_DICTS[field]?.[value];
  if (known) return known;
  const iso = ISO_VALUE_RE.exec(value);
  return iso ? `${iso[3]}.${iso[2]}.${iso[1]}` : value;
}

// ---------------------------------------------------------------- ссылки

/**
 * Страница объекта, если она в приложении есть. Динамических роутов всего два, поэтому
 * ссылки получают только Поставщик и Культура — вести на нефильтрованный список
 * остальных разделов значило бы обещать переход к объекту и не выполнять обещание.
 */
export function entityHref(entity: string, entityId: number): string | null {
  if (!Number.isInteger(entityId) || entityId <= 0) return null;
  if (entity === "Farmer") return `/reference/farmers/${entityId}`;
  if (entity === "Culture") return `/analytics/culture/${entityId}`;
  return null;
}

/**
 * Что на самом деле лежит в entity_id, когда это не id одноимённой таблицы (или когда
 * его легко принять за чужой). Две ловушки в писателе: акт приёмки логируется по позиции
 * отгрузки (приёмка позиционная, BR-13/26), а конверсии плана — по культуре. Третий
 * случай — строка контракта: id свой, но «Строка контракта · 42» читается как контракт 42.
 */
export function entityIdHint(entity: string, field: string): string | null {
  if (entity === "AcceptanceAct") return "id позиции отгрузки (акт привязан к позиции)";
  if (entity === "ContractLine") return "id строки контракта, а не контракта";
  if (
    entity === "WeeklyPlan" &&
    (field === "convert_days_to_week" || field === "convert_week_to_days")
  ) {
    return "id культуры";
  }
  return null;
}

// ------------------------------------------------------- дата/время и период

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

// YYYY-MM-DD, существующая дата. Round-trip отсекает 2026-02-30 (Date его «донормирует»).
export function isValidISODate(s: string | null | undefined): s is string {
  if (typeof s !== "string" || !ISO_DATE_RE.test(s)) return false;
  const d = parseDateUTC(s);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function cached(key: string, make: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let f = fmtCache.get(key);
  if (!f) {
    f = make();
    fmtCache.set(key, f);
  }
  return f;
}

/**
 * Отметка времени записи журнала: «31.07.2026, 14:05» в заводской зоне.
 * ChangeLog.timestamp — МОМЕНТ времени (now()), а не дата-полночь, поэтому здесь
 * FACTORY_TZ, а не "UTC", как в форматтерах дат отгрузки по всему остальному коду.
 */
export function formatChangeTimestamp(d: Date, tz: string = FACTORY_TZ): string {
  return cached(`ts:${tz}`, () =>
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: tz,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }),
  ).format(d);
}

// Смещение зоны в минутах в конкретный момент (+180 для МСК). Считаем через Intl,
// а не константой: зона задаётся FACTORY_TZ и может оказаться переводящей часы.
function tzOffsetMinutes(instant: Date, tz: string): number {
  const parts = cached(`off:${tz}`, () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }),
  ).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return (wall - instant.getTime()) / 60_000;
}

// Момент местной полуночи для YYYY-MM-DD. Вторая итерация — на случай зоны с переводом
// часов: смещение могло измениться между пробным и уточнённым инстантом.
function zonedDayStart(iso: string, tz: string): Date {
  const utcMidnight = parseDateUTC(iso).getTime();
  const off1 = tzOffsetMinutes(new Date(utcMidnight), tz);
  const first = new Date(utcMidnight - off1 * 60_000);
  const off2 = tzOffsetMinutes(first, tz);
  return off2 === off1 ? first : new Date(utcMidnight - off2 * 60_000);
}

/**
 * Границы фильтра «с/по» как ИНСТАНТЫ местных суток: [начало дня from, начало дня to+1).
 *
 * Наивное parseDateUTC(from) дало бы сдвиг на 3 часа: правка в 00:30 МСК 31-го числа
 * имеет UTC-отметку 21:30 30-го и выпала бы из фильтра from=2026-07-31. Это тот же
 * класс бага, из-за которого «сегодня» в проекте считается только todayLocalISO().
 * Невалидная дата молча игнорируется (граница просто не ставится) — как parseWeekParam.
 */
export function zonedDayRange(
  from?: string | null,
  to?: string | null,
  tz: string = FACTORY_TZ,
): { gte?: Date; lt?: Date } {
  const range: { gte?: Date; lt?: Date } = {};
  if (isValidISODate(from)) range.gte = zonedDayStart(from, tz);
  if (isValidISODate(to)) {
    const nextDay = new Date(parseDateUTC(to).getTime() + DAY_MS)
      .toISOString()
      .slice(0, 10);
    range.lt = zonedDayStart(nextDay, tz);
  }
  return range;
}
