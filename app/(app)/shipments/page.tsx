import { getShipments, listShipmentOptions } from "@/server/shipments/actions";
import { RoleGate } from "@/components/auth/RoleGate";
import { ShipmentFormDialog } from "./_components/ShipmentFormDialog";
import { ShipmentsTable } from "./_components/ShipmentsTable";

export default async function ShipmentsPage() {
  const [rows, options] = await Promise.all([
    getShipments(),
    listShipmentOptions(),
  ]);

  return (
    <div>
      <div className="mb-4 flex items-center">
        <h1 className="text-2xl font-semibold tracking-tight">Отгрузки</h1>
        <div className="ml-auto">
          <RoleGate allow={["admin"]}>
            <ShipmentFormDialog mode="create" options={options} />
          </RoleGate>
        </div>
      </div>

      <ShipmentsTable rows={rows} options={options} />
    </div>
  );
}
