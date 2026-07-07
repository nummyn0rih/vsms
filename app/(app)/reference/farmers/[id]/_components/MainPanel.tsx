import Link from "next/link";
import { Lock } from "lucide-react";

import type { FarmerCard } from "@/server/farmers/card";
import { formatPhone, normalizePhone } from "@/lib/validators";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

export function MainPanel({ card }: { card: FarmerCard }) {
  const { farmer } = card;
  return (
    <div className="grid gap-8 sm:grid-cols-2">
      <div className="flex flex-col gap-4">
        <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
          Контакты
        </p>
        <Field label="Телефон">
          {farmer.contacts.phone ? (
            <a
              href={`tel:${normalizePhone(farmer.contacts.phone)}`}
              className="font-mono text-primary hover:underline"
            >
              {formatPhone(farmer.contacts.phone)}
            </a>
          ) : (
            <span className="text-muted-foreground italic">не указан</span>
          )}
        </Field>
        <Field label="Контактное лицо">
          {farmer.contacts.contactPerson || (
            <span className="text-muted-foreground italic">не указано</span>
          )}
        </Field>
        <Field label="Мессенджер">
          {farmer.contacts.messenger || (
            <span className="text-muted-foreground italic">не указан</span>
          )}
        </Field>
        <Field label="Email">
          {farmer.contacts.email ? (
            <a href={`mailto:${farmer.contacts.email}`} className="text-primary hover:underline">
              {farmer.contacts.email}
            </a>
          ) : (
            <span className="text-muted-foreground italic">не указан</span>
          )}
        </Field>
      </div>

      <div className="flex flex-col gap-4">
        <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
          Основное
        </p>
        <Field label="Статус">{farmer.active ? "Активен" : "Архивный"}</Field>
        <Field label="Сезон">
          <span className="font-mono">{farmer.season}</span>
        </Field>
        <Field label="Заметки">
          {farmer.notes ? (
            <span className="block rounded-lg border bg-muted/30 px-3.5 py-2.5 leading-5">
              {farmer.notes}
            </span>
          ) : (
            <span className="text-muted-foreground italic">нет</span>
          )}
        </Field>
        <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3.5" />
          Просмотр. Правка — в{" "}
          <Link href="/reference/farmers" className="font-medium text-primary hover:underline">
            справочнике фермеров
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
