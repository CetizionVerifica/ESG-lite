// Unit tests for an entry's quantity (the My entries and approvals "Quantity"
// column, and the Breakdown panel's consumption). Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { quantityOf, consumptionOf } = require(path.resolve("dist/services/emissionBreakdown.js"));

test("a canonical key wins, then the form's number fields, then a spend amount", () => {
  assert.equal(quantityOf({ activity_value: "1600", Litres: "5" }, ["Litres"]), 1600);
  // Fugitive: the form's "Amount of gas", never the refrigerant select's option id.
  assert.equal(quantityOf({ Refrigerant: "6", "Amount of gas": "1000" }, ["Amount of gas"]), 1000);
  assert.equal(quantityOf({ "@method": "spend_based", spent_value: "1,000", currency: "USD" }, []), 1000);
});

test("form fields match whatever the case of the saved key", () => {
  assert.equal(quantityOf({ "amount of gas": "12.5" }, ["Amount of gas"]), 12.5);
});

test("an entry with no number has no quantity; the breakdown still counts it as 0", () => {
  assert.equal(quantityOf({ Refrigerant: "R-32" }, ["Amount of gas"]), null);
  assert.equal(quantityOf({ Refrigerant: "R-32", "Amount of gas": "" }, ["Amount of gas"]), null);
  assert.equal(consumptionOf({ Refrigerant: "R-32" }, ["Amount of gas"]), 0);
});
