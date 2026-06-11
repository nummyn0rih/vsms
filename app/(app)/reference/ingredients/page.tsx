import { listIngredients } from "@/server/ingredients/actions";
import type { IngredientRow } from "@/server/ingredients/schema";
import { RoleGate } from "@/components/auth/RoleGate";
import { ReferenceToolbar } from "@/components/reference/ReferenceToolbar";
import { IngredientFormDialog } from "./_components/IngredientFormDialog";
import { IngredientsTable } from "./_components/IngredientsTable";

// searchParams в Next 16 — асинхронный. Фильтры живут в URL, страница
// перезапрашивает данные на сервере при их изменении.
export default async function IngredientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string }>;
}) {
  const { q, inactive } = await searchParams;
  const list = await listIngredients({
    q,
    includeInactive: inactive === "1",
  });

  const rows: IngredientRow[] = list;

  return (
    <div>
      <ReferenceToolbar searchPlaceholder="Поиск по названию…">
        <RoleGate allow={["admin"]}>
          <IngredientFormDialog mode="create" />
        </RoleGate>
      </ReferenceToolbar>

      <IngredientsTable rows={rows} />
    </div>
  );
}
