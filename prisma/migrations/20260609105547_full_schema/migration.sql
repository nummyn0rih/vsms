-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('planned', 'sent', 'arrived', 'accepted');

-- CreateEnum
CREATE TYPE "AcceptanceType" AS ENUM ('simple', 'calibre');

-- CreateEnum
CREATE TYPE "PackagingKind" AS ENUM ('box', 'barrel');

-- CreateEnum
CREATE TYPE "IngredientUnit" AS ENUM ('kg', 'l');

-- CreateEnum
CREATE TYPE "ItemKind" AS ENUM ('packaging', 'ingredient');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('return', 'delivery', 'transfer', 'scrap', 'disposal', 'adjustment');

-- CreateEnum
CREATE TYPE "StockState" AS ENUM ('good', 'scrap');

-- CreateEnum
CREATE TYPE "SourceDocType" AS ENUM ('shipment', 'material_shipment', 'manual');

-- CreateTable
CREATE TABLE "Farmer" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "contacts" JSONB,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Farmer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Culture" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "acceptance_type" "AcceptanceType" NOT NULL,
    "packaging_type_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Culture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportCompany" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TransportCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" SERIAL NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "transport_company_id" INTEGER NOT NULL,
    "info" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagingType" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PackagingKind" NOT NULL,
    "capacity_kg" DECIMAL(12,3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PackagingType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "IngredientUnit" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagingNorm" (
    "id" SERIAL NOT NULL,
    "farmer_id" INTEGER NOT NULL,
    "culture_id" INTEGER NOT NULL,
    "avg_unit_weight_kg" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "PackagingNorm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripWeightNorm" (
    "id" SERIAL NOT NULL,
    "farmer_id" INTEGER NOT NULL,
    "culture_id" INTEGER NOT NULL,
    "planned_trip_weight_kg" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "TripWeightNorm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientRecipe" (
    "id" SERIAL NOT NULL,
    "culture_id" INTEGER NOT NULL,
    "ingredient_id" INTEGER NOT NULL,
    "qty_per_kg_product" DECIMAL(12,6) NOT NULL,

    CONSTRAINT "IngredientRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalibreScheme" (
    "id" SERIAL NOT NULL,
    "culture_id" INTEGER NOT NULL,

    CONSTRAINT "CalibreScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalibreRange" (
    "id" SERIAL NOT NULL,
    "scheme_id" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "min_cm" DECIMAL(5,2),
    "max_cm" DECIMAL(5,2),
    "is_accepted" BOOLEAN NOT NULL,

    CONSTRAINT "CalibreRange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonConfig" (
    "id" SERIAL NOT NULL,
    "season_year" INTEGER NOT NULL,
    "summer_start" TIMESTAMP(3) NOT NULL,
    "summer_end" TIMESTAMP(3) NOT NULL,
    "summer_workdays" INTEGER NOT NULL,
    "winter_workdays" INTEGER NOT NULL,

    CONSTRAINT "SeasonConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" SERIAL NOT NULL,
    "item_kind" "ItemKind" NOT NULL,
    "item_id" INTEGER NOT NULL,
    "location_scope" INTEGER,
    "threshold" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" SERIAL NOT NULL,
    "farmer_id" INTEGER NOT NULL,
    "season_year" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractLine" (
    "id" SERIAL NOT NULL,
    "contract_id" INTEGER NOT NULL,
    "culture_id" INTEGER NOT NULL,
    "volume_tons" DECIMAL(12,3) NOT NULL,
    "price_per_kg" DECIMAL(12,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "departure_date" TIMESTAMP(3),
    "arrival_date" TIMESTAMP(3),
    "status" "ShipmentStatus" NOT NULL DEFAULT 'planned',
    "driver_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" SERIAL NOT NULL,
    "shipment_id" INTEGER NOT NULL,
    "farmer_id" INTEGER NOT NULL,
    "culture_id" INTEGER NOT NULL,
    "planned_weight_kg" DECIMAL(12,3) NOT NULL,
    "actual_weight_kg" DECIMAL(12,3),
    "contract_line_id" INTEGER,
    "accepted_weight_kg" DECIMAL(12,3),

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcceptanceAct" (
    "id" SERIAL NOT NULL,
    "shipment_item_id" INTEGER NOT NULL,
    "brak_percent" DECIMAL(5,2),
    "accepted_percent" DECIMAL(5,2),
    "brak_weight_kg" DECIMAL(12,3),
    "comment" TEXT,
    "act_number" TEXT NOT NULL,
    "weighed_at" TIMESTAMP(3),

    CONSTRAINT "AcceptanceAct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalibreResult" (
    "id" SERIAL NOT NULL,
    "acceptance_act_id" INTEGER NOT NULL,
    "calibre_range_id" INTEGER NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "CalibreResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialShipment" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "departure_date" TIMESTAMP(3),
    "arrival_date" TIMESTAMP(3),
    "status" "ShipmentStatus" NOT NULL DEFAULT 'planned',
    "driver_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialShipmentItem" (
    "id" SERIAL NOT NULL,
    "material_shipment_id" INTEGER NOT NULL,
    "farmer_id" INTEGER NOT NULL,
    "item_kind" "ItemKind" NOT NULL,
    "packaging_type_id" INTEGER,
    "ingredient_id" INTEGER,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "MaterialShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyPlan" (
    "id" SERIAL NOT NULL,
    "iso_year" INTEGER NOT NULL,
    "iso_week" INTEGER NOT NULL,
    "culture_id" INTEGER NOT NULL,
    "target_tons" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "WeeklyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "ItemKind" NOT NULL,
    "packaging_type_id" INTEGER,
    "ingredient_id" INTEGER,
    "quantity" DECIMAL(12,3) NOT NULL,
    "from_location_id" INTEGER,
    "to_location_id" INTEGER,
    "from_state" "StockState",
    "to_state" "StockState",
    "movement_type" "MovementType" NOT NULL,
    "source_doc_type" "SourceDocType",
    "source_doc_id" INTEGER,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PackagingNorm_farmer_id_culture_id_key" ON "PackagingNorm"("farmer_id", "culture_id");

-- CreateIndex
CREATE UNIQUE INDEX "TripWeightNorm_farmer_id_culture_id_key" ON "TripWeightNorm"("farmer_id", "culture_id");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientRecipe_culture_id_ingredient_id_key" ON "IngredientRecipe"("culture_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "CalibreScheme_culture_id_key" ON "CalibreScheme"("culture_id");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonConfig_season_year_key" ON "SeasonConfig"("season_year");

-- CreateIndex
CREATE UNIQUE INDEX "AcceptanceAct_shipment_item_id_key" ON "AcceptanceAct"("shipment_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "AcceptanceAct_act_number_key" ON "AcceptanceAct"("act_number");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyPlan_iso_year_iso_week_culture_id_key" ON "WeeklyPlan"("iso_year", "iso_week", "culture_id");

-- CreateIndex
CREATE INDEX "StockMovement_kind_packaging_type_id_idx" ON "StockMovement"("kind", "packaging_type_id");

-- CreateIndex
CREATE INDEX "StockMovement_kind_ingredient_id_idx" ON "StockMovement"("kind", "ingredient_id");

-- CreateIndex
CREATE INDEX "StockMovement_from_location_id_idx" ON "StockMovement"("from_location_id");

-- CreateIndex
CREATE INDEX "StockMovement_to_location_id_idx" ON "StockMovement"("to_location_id");

-- AddForeignKey
ALTER TABLE "Culture" ADD CONSTRAINT "Culture_packaging_type_id_fkey" FOREIGN KEY ("packaging_type_id") REFERENCES "PackagingType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_transport_company_id_fkey" FOREIGN KEY ("transport_company_id") REFERENCES "TransportCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagingNorm" ADD CONSTRAINT "PackagingNorm_farmer_id_fkey" FOREIGN KEY ("farmer_id") REFERENCES "Farmer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagingNorm" ADD CONSTRAINT "PackagingNorm_culture_id_fkey" FOREIGN KEY ("culture_id") REFERENCES "Culture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripWeightNorm" ADD CONSTRAINT "TripWeightNorm_farmer_id_fkey" FOREIGN KEY ("farmer_id") REFERENCES "Farmer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripWeightNorm" ADD CONSTRAINT "TripWeightNorm_culture_id_fkey" FOREIGN KEY ("culture_id") REFERENCES "Culture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientRecipe" ADD CONSTRAINT "IngredientRecipe_culture_id_fkey" FOREIGN KEY ("culture_id") REFERENCES "Culture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientRecipe" ADD CONSTRAINT "IngredientRecipe_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibreScheme" ADD CONSTRAINT "CalibreScheme_culture_id_fkey" FOREIGN KEY ("culture_id") REFERENCES "Culture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibreRange" ADD CONSTRAINT "CalibreRange_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "CalibreScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_farmer_id_fkey" FOREIGN KEY ("farmer_id") REFERENCES "Farmer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractLine" ADD CONSTRAINT "ContractLine_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractLine" ADD CONSTRAINT "ContractLine_culture_id_fkey" FOREIGN KEY ("culture_id") REFERENCES "Culture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_farmer_id_fkey" FOREIGN KEY ("farmer_id") REFERENCES "Farmer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_culture_id_fkey" FOREIGN KEY ("culture_id") REFERENCES "Culture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_contract_line_id_fkey" FOREIGN KEY ("contract_line_id") REFERENCES "ContractLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceAct" ADD CONSTRAINT "AcceptanceAct_shipment_item_id_fkey" FOREIGN KEY ("shipment_item_id") REFERENCES "ShipmentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibreResult" ADD CONSTRAINT "CalibreResult_acceptance_act_id_fkey" FOREIGN KEY ("acceptance_act_id") REFERENCES "AcceptanceAct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibreResult" ADD CONSTRAINT "CalibreResult_calibre_range_id_fkey" FOREIGN KEY ("calibre_range_id") REFERENCES "CalibreRange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialShipment" ADD CONSTRAINT "MaterialShipment_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialShipmentItem" ADD CONSTRAINT "MaterialShipmentItem_material_shipment_id_fkey" FOREIGN KEY ("material_shipment_id") REFERENCES "MaterialShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialShipmentItem" ADD CONSTRAINT "MaterialShipmentItem_farmer_id_fkey" FOREIGN KEY ("farmer_id") REFERENCES "Farmer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialShipmentItem" ADD CONSTRAINT "MaterialShipmentItem_packaging_type_id_fkey" FOREIGN KEY ("packaging_type_id") REFERENCES "PackagingType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialShipmentItem" ADD CONSTRAINT "MaterialShipmentItem_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPlan" ADD CONSTRAINT "WeeklyPlan_culture_id_fkey" FOREIGN KEY ("culture_id") REFERENCES "Culture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_packaging_type_id_fkey" FOREIGN KEY ("packaging_type_id") REFERENCES "PackagingType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Полиморфизм: ровно один FK заполнен и согласован с дискриминатором (DOMAIN.md разд. 3).
ALTER TABLE "StockMovement" ADD CONSTRAINT "stockmovement_poly_chk" CHECK (
    ("kind" = 'packaging'  AND "packaging_type_id" IS NOT NULL AND "ingredient_id" IS NULL) OR
    ("kind" = 'ingredient' AND "ingredient_id"     IS NOT NULL AND "packaging_type_id" IS NULL)
);

ALTER TABLE "MaterialShipmentItem" ADD CONSTRAINT "msitem_poly_chk" CHECK (
    ("item_kind" = 'packaging'  AND "packaging_type_id" IS NOT NULL AND "ingredient_id" IS NULL) OR
    ("item_kind" = 'ingredient' AND "ingredient_id"     IS NOT NULL AND "packaging_type_id" IS NULL)
);
