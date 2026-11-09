-- Price list items now hold the price of one unit of the product. Rows priced before this change hold the cost of the
-- costing's whole quantity, so they keep the default (false) and are shown as out of date until the list is repriced.
ALTER TABLE "PriceListItem" ADD COLUMN "pricedPerUnit" BOOLEAN NOT NULL DEFAULT false;
