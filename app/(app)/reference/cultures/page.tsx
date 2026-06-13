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
    packagingTypes: c.packagingTypes.map((pt) => ({
      id: pt.packaging_type_id,
      name: pt.packagingType.name,
      is_default: pt.is_default,
      active: pt.packagingType.active,
    })),
    // Decimal не сериализуется в Client Component → строкой; "" = открытый верх.
    ranges:
      c.calibreScheme?.ranges.map((r) => ({
        label: r.label,
        min_cm: r.min_cm?.toString() ?? "",
        max_cm: r.max_cm?.toString() ?? "",
        is_accepted: r.is_accepted,
      })) ?? [],
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
