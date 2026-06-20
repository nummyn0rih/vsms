import { z } from "zod";

// B4b — перевеска. Вес фактической партии (actual_weight_kg). null = очистка
// (односторонний переход sent→arrived это не откатывает, см. actions.setActualWeight).
export const setActualWeightSchema = z.object({
  shipmentItemId: z.number().int().positive(),
  actualWeightKg: z
    .number()
    .positive("Вес должен быть больше 0")
    .nullable(),
});

export type SetActualWeightInput = z.infer<typeof setActualWeightSchema>;

export const markArrivedSchema = z.object({
  shipmentId: z.number().int().positive(),
});

// --- Типы доски приёмки (BR-26). Импортируются client-компонентами, поэтому без
// тяжёлых зависимостей (prisma тянет board.ts). Веса в КГ (number). ---

export type AcceptanceItem = {
  id: number;
  cultureName: string;
  color: string;
  farmerName: string;
  plannedKg: number;
  actualKg: number | null;
};

export type AcceptanceMachine = {
  id: number;
  code: string;
  status: "sent" | "arrived";
  departureDate: string | null;
  arrivalDate: string | null;
  driverName: string | null;
  transportCompanyName: string | null;
  driverPhone: string | null;
  driverInfo: string | null;
  comment: string | null;
  weighed: number; // позиций с введённым фактом
  total: number; // всего позиций
  items: AcceptanceItem[];
};

export type AcceptanceBoard = {
  zone1: AcceptanceMachine[]; // sent — ожидают перевески
  zone2: AcceptanceMachine[]; // arrived — на приёмке
  acceptedCount: number; // зона 3 (заглушка, этап C)
};
