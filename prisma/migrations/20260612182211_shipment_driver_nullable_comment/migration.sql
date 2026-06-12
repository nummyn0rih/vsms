-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "comment" TEXT,
ALTER COLUMN "driver_id" DROP NOT NULL;
