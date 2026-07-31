import { z } from "zod";

import { optionalPhoneSchema } from "@/lib/validators";

// Единый источник валидации Driver. transport_company_id приходит строкой из
// Select; пустая = ошибка (DOMAIN.md §2: водитель без ТК недопустим).
// Телефон необязателен (пусто → null); у Farmer он остаётся обязательным.
export const driverSchema = z.object({
  full_name: z.string().trim().min(1, "ФИО обязательно"),
  phone: optionalPhoneSchema,
  transport_company_id: z.string().trim().min(1, "Компания обязательна"),
  info: z.string().trim().optional(),
});

// Вход и выход схемы расходятся (phone трансформируется в null): форма работает с
// DriverFormValues, server-action получает уже разобранный DriverInput.
export type DriverFormValues = z.input<typeof driverSchema>;
export type DriverInput = z.output<typeof driverSchema>;

// Вью-тип для клиентских компонентов (имя ТК резолвится из FK).
export type DriverRow = {
  id: number;
  full_name: string;
  phone: string | null;
  transport_company_id: number;
  transport_company_name: string | null;
  info: string | null;
  active: boolean;
};

export type { TransportCompanyOption } from "@/server/transport-companies/schema";
