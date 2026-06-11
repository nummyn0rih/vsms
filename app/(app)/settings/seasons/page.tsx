import { listSeasons } from "@/server/seasons/actions";
import { RoleGate } from "@/components/auth/RoleGate";
import { SeasonFormDialog } from "./_components/SeasonFormDialog";
import { SeasonsTable } from "./_components/SeasonsTable";

// Сезонов мало (один на год) — без поиска/фильтров, простой тулбар с кнопкой.
export default async function SeasonsPage() {
  const rows = await listSeasons();

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <RoleGate allow={["admin"]}>
          <SeasonFormDialog mode="create" />
        </RoleGate>
      </div>

      <SeasonsTable rows={rows} />
    </div>
  );
}
