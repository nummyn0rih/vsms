-- AlterTable
ALTER TABLE "MaterialShipmentItem" ADD COLUMN     "arrived_at" TIMESTAMP(3);

-- Backfill (D3-2a): рейсы со status='arrived' прибыли целиком → проставить всем их
-- позициям arrived_at = дата прибытия рейса (или now() если дата не задана).
UPDATE "MaterialShipmentItem" i
SET "arrived_at" = COALESCE(s."arrival_date", now())
FROM "MaterialShipment" s
WHERE i."material_shipment_id" = s."id" AND s."status" = 'arrived';
