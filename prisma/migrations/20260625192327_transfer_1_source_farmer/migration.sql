-- AlterTable
ALTER TABLE "MaterialShipment" ADD COLUMN     "source_farmer_id" INTEGER;

-- AddForeignKey
ALTER TABLE "MaterialShipment" ADD CONSTRAINT "MaterialShipment_source_farmer_id_fkey" FOREIGN KEY ("source_farmer_id") REFERENCES "Farmer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
