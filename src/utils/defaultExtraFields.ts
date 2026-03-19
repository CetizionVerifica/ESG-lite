import { ExtraFieldDefinition } from "../entities/ColumnConfig";

/**
 * Returns default supplementary (extra) fields for a given category.
 * These fields don't affect emission calculation — they are stored in emission.extra_data.
 * Derived from the calculation sheet templates.
 *
 * Uses category_name (case-insensitive) so it works across environments with different IDs.
 */

const categoryFieldsMap: Record<string, ExtraFieldDefinition[]> = {
  // Stationary Combustion (Scope 1)
  "stationary combustion": [
    { key: "equipment", label: "Equipment", type: "select", required: false, options: ["Boiler", "DG Set", "Furnace", "Heater", "Kiln", "Other"] },
  ],

  // Purchased Goods and Services (Scope 3)
  "purchased goods and services": [
    { key: "received_date", label: "Received Date", type: "date", required: false },
    { key: "po_number", label: "PO", type: "text", required: false },
    { key: "description", label: "Description of Material/Service", type: "textarea", required: false },
    { key: "quantity", label: "Quantity", type: "number", required: false },
    { key: "spent_value", label: "Spent Value", type: "number", required: false },
    { key: "currency", label: "Currency (INR/USD)", type: "select", required: false, options: ["INR", "USD", "EUR", "GBP", "BHD", "SAR", "AED"] },
    { key: "supplier_name", label: "Name of Supplier", type: "text", required: false },
  ],

  // Purchased Electricity (Scope 2)
  "purchased electricity": [
    { key: "billing_month", label: "Billing Month", type: "text", required: false },
  ],

  // Fugitive Emissions (Scope 1)
  "fugitive emissions": [
    { key: "equipment", label: "Equipment", type: "text", required: false },
  ],

  // Waste Generated in Operations (Scope 3)
  "waste generated in operations": [
    { key: "period", label: "Period", type: "text", required: false },
    { key: "waste_date", label: "Date", type: "date", required: false },
    { key: "waste_category", label: "Waste Category", type: "text", required: false },
  ],

  // FERA Stationary (Scope 3)
  "fera stationary combustion": [
    { key: "month", label: "Month", type: "text", required: false },
  ],

  // Capital Goods (Scope 3) — same as Purchased Goods
  "capital goods": [
    { key: "received_date", label: "Received Date", type: "date", required: false },
    { key: "po_number", label: "PO", type: "text", required: false },
    { key: "description", label: "Description of Material/Service", type: "textarea", required: false },
    { key: "quantity", label: "Quantity", type: "number", required: false },
    { key: "spent_value", label: "Spent Value", type: "number", required: false },
    { key: "currency", label: "Currency (INR/USD)", type: "select", required: false, options: ["INR", "USD", "EUR", "GBP", "BHD", "SAR", "AED"] },
    { key: "supplier_name", label: "Name of Supplier", type: "text", required: false },
  ],

  // Upstream Transportation (Scope 3)
  "upstream transportation and distribution": [
    { key: "transport_date", label: "Date", type: "date", required: false },
    { key: "po_number", label: "PO", type: "text", required: false },
    { key: "material_name", label: "Name of Material", type: "text", required: false },
    { key: "vehicle_type", label: "Type of Vehicle", type: "text", required: false, show_for: ["Road"] },
    { key: "quantity", label: "Quantity", type: "number", required: false },
    { key: "departure", label: "Departure", type: "text", required: false },
    { key: "destination", label: "Destination", type: "text", required: false },
  ],

  // Business Travel (Scope 3)
  "business travel": [
    { key: "vehicle_type", label: "Type of Vehicle", type: "text", required: false, show_for: ["Land"] },
    { key: "no_of_passengers", label: "No of Passengers", type: "number", required: false },
    { key: "boarding_point", label: "Boarding/Departure Point", type: "text", required: false },
    { key: "dropping_point", label: "Dropping/Destination Point", type: "text", required: false },
    { key: "remarks", label: "Remarks", type: "textarea", required: false },
  ],

  // Employee Commuting (Scope 3)
  "employee commuting": [
    { key: "vehicle_type", label: "Type of Vehicle", type: "text", required: false },
    { key: "no_of_employees", label: "No. of Employee", type: "number", required: false },
    { key: "total_vehicles", label: "Total Number of Vehicles", type: "number", required: false },
    { key: "departure", label: "Departure", type: "text", required: false },
    { key: "destination", label: "Destination", type: "text", required: false },
  ],

  // Downstream Transportation (Scope 3) — same as Upstream
  "downstream transportation and distribution": [
    { key: "transport_date", label: "Date", type: "date", required: false },
    { key: "po_number", label: "PO", type: "text", required: false },
    { key: "material_name", label: "Name of Material", type: "text", required: false },
    { key: "vehicle_type", label: "Type of Vehicle", type: "text", required: false, show_for: ["Road"] },
    { key: "quantity", label: "Quantity", type: "number", required: false },
    { key: "departure", label: "Departure", type: "text", required: false },
    { key: "destination", label: "Destination", type: "text", required: false },
  ],

  // End of Life Treatment of Sold Products (Scope 3)
  "end-of-life treatment of sold products": [
    { key: "period", label: "Period", type: "text", required: false },
    { key: "month", label: "Month", type: "text", required: false },
  ],

  // FERA Mobile (Scope 3)
  "fera mobile combustion": [
    { key: "month", label: "Month", type: "text", required: false },
  ],

  // FERA Electricity (Scope 3)
  "fera purchased electricity": [
    { key: "month", label: "Month", type: "text", required: false },
  ],
};

export function getDefaultExtraFieldsByName(categoryName: string): ExtraFieldDefinition[] {
  const normalized = categoryName.trim().toLowerCase();
  // Exact match first
  if (categoryFieldsMap[normalized]) return categoryFieldsMap[normalized];
  // Partial match — check if any key is contained in the name or vice versa
  for (const [key, fields] of Object.entries(categoryFieldsMap)) {
    if (normalized.includes(key) || key.includes(normalized)) return fields;
  }
  return [];
}

/** @deprecated Use getDefaultExtraFieldsByName instead — IDs differ across environments */
export function getDefaultExtraFields(categoryId: number): ExtraFieldDefinition[] {
  const idToNameMap: Record<number, string> = {
    1: "stationary combustion",
    3: "purchased goods and services",
    4: "purchased electricity",
    5: "fugitive emissions",
    6: "waste generated in operations",
    8: "fera stationary combustion",
    12: "capital goods",
    13: "upstream transportation and distribution",
    15: "business travel",
    16: "employee commuting",
    18: "downstream transportation and distribution",
    21: "end-of-life treatment of sold products",
    25: "fera mobile combustion",
    26: "fera purchased electricity",
  };
  const name = idToNameMap[categoryId];
  if (!name) return [];
  return categoryFieldsMap[name] || [];
}
