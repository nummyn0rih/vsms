-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'consumption';

-- AlterEnum
ALTER TYPE "SourceDocType" ADD VALUE 'acceptance_act';

-- AlterTable
ALTER TABLE "StockMovement" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(15,6);
