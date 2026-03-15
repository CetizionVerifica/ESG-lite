import { ExtraFieldDefinition } from "../entities/ColumnConfig";

/**
 * Returns default supplementary (extra) fields for a given category.
 * These fields don't affect emission calculation — they are stored in emission.extra_data.
 * Derived from the calculation sheet templates.
 */
export function getDefaultExtraFields(categoryId: number): ExtraFieldDefinition[] {
  const map: Record<number, ExtraFieldDefinition[]> = {
    // Stationary Combustion (Scope 1)
    1: [
      { key: "equipment", label: "Equipment", type: "select", required: false, options: ["Boiler", "DG Set", "Furnace", "Heater", "Kiln", "Other"] },
    ],

    // Mobile Combustion (Scope 1) — covered by dynamic columns
    // 2: [],

    // Purchased Goods and Services (Scope 3)
    3: [
      { key: "received_date", label: "Received Date", type: "date", required: false },
      { key: "po_number", label: "PO", type: "text", required: false },
      { key: "description", label: "Description of Material/Service", type: "textarea", required: false },
      { key: "quantity", label: "Quantity", type: "number", required: false },
      { key: "spent_value", label: "Spent Value", type: "number", required: false },
      { key: "currency", label: "Currency (INR/USD)", type: "select", required: false, options: ["INR", "USD", "EUR", "GBP", "BHD", "SAR", "AED"] },
      { key: "supplier_name", label: "Name of Supplier", type: "text", required: false },
    ],

    // Purchased Electricity (Scope 2)
    4: [
      { key: "billing_month", label: "Billing Month", type: "text", required: false },
    ],

    // Fugitive Emissions (Scope 1)
    5: [
      { key: "equipment", label: "Equipment", type: "text", required: false },
    ],

    // Waste Generated in Operations (Scope 3)
    6: [
      { key: "period", label: "Period", type: "text", required: false },
      { key: "waste_date", label: "Date", type: "date", required: false },
      { key: "waste_category", label: "Waste Category", type: "text", required: false },
    ],

    // Fera Stationary (Scope 3)
    8: [
      { key: "month", label: "Month", type: "text", required: false },
    ],

    // Capital Goods (Scope 3) — same as Purchased Goods
    12: [
      { key: "received_date", label: "Received Date", type: "date", required: false },
      { key: "po_number", label: "PO", type: "text", required: false },
      { key: "description", label: "Description of Material/Service", type: "textarea", required: false },
      { key: "quantity", label: "Quantity", type: "number", required: false },
      { key: "spent_value", label: "Spent Value", type: "number", required: false },
      { key: "currency", label: "Currency (INR/USD)", type: "select", required: false, options: ["INR", "USD", "EUR", "GBP", "BHD", "SAR", "AED"] },
      { key: "supplier_name", label: "Name of Supplier", type: "text", required: false },
    ],

    // Upstream Transportation (Scope 3)
    13: [
      { key: "transport_date", label: "Date", type: "date", required: false },
      { key: "po_number", label: "PO", type: "text", required: false },
      { key: "material_name", label: "Name of Material", type: "text", required: false },
      { key: "vehicle_type", label: "Type of Vehicle", type: "text", required: false, show_for: ["Road"] },
      { key: "quantity", label: "Quantity", type: "number", required: false },
      { key: "departure", label: "Departure", type: "text", required: false },
      { key: "destination", label: "Destination", type: "text", required: false },
    ],

    // Business Travel (Scope 3)
    15: [
      { key: "vehicle_type", label: "Type of Vehicle", type: "text", required: false, show_for: ["Land"] },
      { key: "no_of_passengers", label: "No of Passengers", type: "number", required: false },
      { key: "boarding_point", label: "Boarding/Departure Point", type: "text", required: false },
      { key: "dropping_point", label: "Dropping/Destination Point", type: "text", required: false },
      { key: "remarks", label: "Remarks", type: "textarea", required: false },
    ],

    // Employee Commuting (Scope 3)
    16: [
      { key: "vehicle_type", label: "Type of Vehicle", type: "text", required: false },
      { key: "no_of_employees", label: "No. of Employee", type: "number", required: false },
      { key: "total_vehicles", label: "Total Number of Vehicles", type: "number", required: false },
      { key: "departure", label: "Departure", type: "text", required: false },
      { key: "destination", label: "Destination", type: "text", required: false },
    ],

    // Downstream Transportation (Scope 3) — same as Upstream
    18: [
      { key: "transport_date", label: "Date", type: "date", required: false },
      { key: "po_number", label: "PO", type: "text", required: false },
      { key: "material_name", label: "Name of Material", type: "text", required: false },
      { key: "vehicle_type", label: "Type of Vehicle", type: "text", required: false, show_for: ["Road"] },
      { key: "quantity", label: "Quantity", type: "number", required: false },
      { key: "departure", label: "Departure", type: "text", required: false },
      { key: "destination", label: "Destination", type: "text", required: false },
    ],

    // End of Life Treatment of Sold Products (Scope 3)
    21: [
      { key: "period", label: "Period", type: "text", required: false },
      { key: "month", label: "Month", type: "text", required: false },
    ],

    // Fera Mobile (Scope 3)
    25: [
      { key: "month", label: "Month", type: "text", required: false },
    ],

    // Fera Electricity (Scope 3)
    26: [
      { key: "month", label: "Month", type: "text", required: false },
    ],
  };

  return map[categoryId] || [];
}
