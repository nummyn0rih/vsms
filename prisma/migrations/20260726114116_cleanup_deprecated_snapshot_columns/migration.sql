/*
  Warnings:

  - You are about to drop the column `brak_weight_kg` on the `AcceptanceAct` table. All the data in the column will be lost.
  - You are about to drop the column `accepted_weight_kg` on the `ShipmentItem` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "AcceptanceAct" DROP COLUMN "brak_weight_kg";

-- AlterTable
ALTER TABLE "ShipmentItem" DROP COLUMN "accepted_weight_kg";
