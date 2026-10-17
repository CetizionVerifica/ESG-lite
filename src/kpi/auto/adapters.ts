/**
 * KPI-5 · one adapter per `AutoSourceKey` (01-contracts §1; the Scope 3
 * category template expands to ghg_scope3_category_1 … _15).
 */
import { AUTO_SOURCE_KEYS } from "../contracts/enums";
import { energyNonRenewable, energyRenewable, energyTotal } from "./energy";
import { ghgScope1, ghgScope2Location, ghgScope2Market, ghgScope3Category, ghgScope3Total } from "./ghg";
import { productionOutput } from "./production";
import type { Adapter } from "./types";
import { wasteTotal } from "./waste";

export const ADAPTERS: Record<string, Adapter> = {
  ghg_scope1: ghgScope1,
  ghg_scope2_location: ghgScope2Location,
  ghg_scope2_market: ghgScope2Market,
  ghg_scope3_total: ghgScope3Total,
  ...Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`ghg_scope3_category_${i + 1}`, ghgScope3Category(i + 1)])),
  energy_total: energyTotal,
  energy_renewable: energyRenewable,
  energy_non_renewable: energyNonRenewable,
  production_output: productionOutput,
  waste_total: wasteTotal,
};

/** Every key of the contract has an adapter (checked by ci/unit/kpi-auto.test.cjs). */
export const missingAdapters = (): string[] => AUTO_SOURCE_KEYS.filter((k) => !ADAPTERS[k]);
