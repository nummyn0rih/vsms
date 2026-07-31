import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  entityHref,
  entityIdHint,
  entityLabel,
  fieldLabel,
  formatChangeTimestamp,
  formatValue,
  SYSTEM_USER_LABEL,
} from "@/server/changelog/labels";
import type { ChangeLogRow } from "@/server/changelog/query";

// Таблица журнала. В отличие от FarmersTable/SeasonsTable — СЕРВЕРНЫЙ компонент:
// интерактива тут нет, только ссылки и тултипы, а время форматируется на сервере
// (браузер не должен считать дату сам — конвенция проекта).

// Длинные значения (JSON контактов, сводки движений) обрезаем, полный текст — в title.
function Value({ text }: { text: string }) {
  return (
    <span
      className="inline-block max-w-[15rem] truncate align-bottom"
      title={text}
    >
      {text}
    </span>
  );
}

export function ChangeLogTable({ rows }: { rows: ChangeLogRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-40">Дата и время</TableHead>
          <TableHead className="w-36">Пользователь</TableHead>
          <TableHead className="w-56">Сущность</TableHead>
          <TableHead className="w-56">Поле</TableHead>
          <TableHead>Было → Стало</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">
              Изменений за выбранный период нет
            </TableCell>
          </TableRow>
        )}

        {rows.map((r) => {
          const href = entityHref(r.entity, r.entityId);
          const hint = entityIdHint(r.entity, r.field);
          const label = entityLabel(r.entity);

          return (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatChangeTimestamp(r.timestamp)}
              </TableCell>

              <TableCell>
                {r.userLogin ?? (
                  <span className="text-muted-foreground">{SYSTEM_USER_LABEL}</span>
                )}
              </TableCell>

              <TableCell>
                <span className="font-medium">
                  {href ? (
                    <Link href={href} className="hover:underline">
                      {label}
                    </Link>
                  ) : (
                    label
                  )}
                </span>{" "}
                <span
                  className="font-mono text-xs text-muted-foreground"
                  title={hint ?? undefined}
                >
                  · {r.entityId}
                  {hint ? " *" : ""}
                </span>
              </TableCell>

              <TableCell>{fieldLabel(r.entity, r.field)}</TableCell>

              <TableCell>
                <span className="text-muted-foreground">
                  <Value text={formatValue(r.entity, r.field, r.oldValue)} />
                </span>
                <span className="px-1.5 text-muted-foreground">→</span>
                <Value text={formatValue(r.entity, r.field, r.newValue)} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
