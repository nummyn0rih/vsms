import { listCultures, listPackagingOptions } from "@/server/cultures/actions";
import type { CultureRow } from "@/server/cultures/schema";
import { RoleGate } from "@/components/auth/RoleGate";
import { ReferenceToolbar } from "@/components/reference/ReferenceToolbar";
import { CultureFormDialog } from "./_components/CultureFormDialog";
import { CulturesTable } from "./_components/CulturesTable";

// searchParams в Next 16 — асинхронный. Фильтры живут в URL, страница
// перезапрашивает данные на сервере при их изменении.
export default async function CulturesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string }>;
}) {
  const { q, inactive } = await searchParams;
  const [list, packagingOptions] = await Promise.all([
    listCultures({ q, includeInactive: inactive === "1" }),
    listPackagingOptions(),
  ]);

  const rows: CultureRow[] = list.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    acceptance_type: c.acceptance_type,
    packaging_type_id: c.packaging_type_id,
    packaging_type_name: c.packagingType?.name ?? null,
    active: c.active,
  }));

  return (
    <div>
      <ReferenceToolbar searchPlaceholder="Поиск по названию…">
        <RoleGate allow={["admin"]}>
          <CultureFormDialog mode="create" packagingOptions={packagingOptions} />
        </RoleGate>
      </ReferenceToolbar>

      <CulturesTable rows={rows} packagingOptions={packagingOptions} />
    </div>
  );
}
