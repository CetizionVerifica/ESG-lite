// A form keeps its fields in the order the Superadmin puts them
// (column_config.column_order, src/forms/columnOrder.ts): the builder's ↑/↓ and
// the order fields are sent in survive a save, and every read returns them in
// that order. Before, the form ↔ field join had no position and a form read its
// fields back in whatever order the database gave.
//
// Adds one category on company 1's site 1 and removes everything it created.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const SITE = 1;
const CAT = 170;
const COLS = { group: 9971, item: 9972, quantity: 9973, note: 9974 };
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const names = (config) => config.columns.map((c) => c.column_name);
let formId;

const read = async () => {
  const r = await call("GET", `/admin/column-configs/${formId}`, "superadmin");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.columnConfig ?? r.json;
};

test.before(async () => {
  await q(`INSERT INTO category (category_id, category_name, scope) VALUES (${CAT}, 'Field order', 'Scope 1')`);
  await q(`INSERT INTO site_categories (site_id, category_id) VALUES (${SITE}, ${CAT})`);
  await q(
    `INSERT INTO column_entity (pk_id, column_name, column_type) VALUES (${COLS.group}, 'Order group', 'select'), (${COLS.item}, 'Order item', 'select'),
       (${COLS.quantity}, 'Order quantity', 'number'), (${COLS.note}, 'Order note', 'text')`,
  );
});

test.after(async () => {
  const configs = (await q(`SELECT pk_id FROM column_config WHERE category_id = ${CAT}`)).map((r) => r.pk_id);
  if (configs.length) {
    await q(`DELETE FROM column_config_columns WHERE column_config_id = ANY($1::int[])`, [configs]);
    await q(`DELETE FROM column_config WHERE pk_id = ANY($1::int[])`, [configs]);
  }
  await q(`DELETE FROM column_entity WHERE pk_id = ANY($1::int[])`, [Object.values(COLS)]);
  await q(`DELETE FROM site_categories WHERE category_id = ${CAT}`);
  await q(`DELETE FROM category WHERE category_id = ${CAT}`);
});

test("migrate:form-field-order added column_config.column_order (CI runs every migration twice)", async () => {
  const cols = await q(`SELECT data_type FROM information_schema.columns WHERE table_name = 'column_config' AND column_name = 'column_order'`);
  assert.deepEqual(cols, [{ data_type: "ARRAY" }]);
});

test("a new form keeps the order its fields were sent in, not the ids' order", async () => {
  const r = await call("POST", "/admin/column-configs", "superadmin", {
    config_name: "Field order",
    site_id: SITE,
    category_id: CAT,
    column_ids: [COLS.quantity, COLS.item, COLS.group],
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  formId = r.json.columnConfig.pk_id;
  assert.deepEqual(names(await read()), ["Order quantity", "Order item", "Order group"]);
});

test("a save with the fields moved keeps the new order, on the Superadmin's and the User's reads", async () => {
  const r = await call("PUT", `/admin/column-configs/${formId}`, "superadmin", { column_ids: [COLS.group, COLS.item, COLS.quantity] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(names(await read()), ["Order group", "Order item", "Order quantity"]);
  const site = await call("GET", `/admin/column-configs/site/${SITE}/category/${CAT}`, "superadmin");
  assert.equal(site.status, 200);
  const list = site.json.columnConfigs ?? site.json.data ?? site.json;
  assert.deepEqual(names(list.find((c) => c.pk_id === formId)), ["Order group", "Order item", "Order quantity"]);
  const user = await call("GET", `/user/column-configs/site/${SITE}/category/${CAT}`, "user");
  assert.equal(user.status, 200, JSON.stringify(user.json));
  const userList = user.json.columnConfigs ?? user.json.data ?? user.json;
  assert.deepEqual(names(Array.isArray(userList) ? userList[0] : userList), ["Order group", "Order item", "Order quantity"]);
});

test("a save that doesn't send the fields keeps their order", async () => {
  const r = await call("PUT", `/admin/column-configs/${formId}`, "superadmin", { config_name: "Field order (renamed)" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(names(await read()), ["Order group", "Order item", "Order quantity"]);
});

test("an added field goes last and a removed one leaves the rest in order", async () => {
  const add = await call("POST", `/admin/column-configs/${formId}/columns`, "superadmin", { column_ids: [COLS.note] });
  assert.equal(add.status, 200, JSON.stringify(add.json));
  assert.deepEqual(names(add.json.columnConfig), ["Order group", "Order item", "Order quantity", "Order note"]);
  const remove = await call("DELETE", `/admin/column-configs/${formId}/columns`, "superadmin", { column_ids: [COLS.item] });
  assert.equal(remove.status, 200, JSON.stringify(remove.json));
  assert.deepEqual(names(await read()), ["Order group", "Order quantity", "Order note"]);
});

test("a form saved before the order existed reads its fields as before", async () => {
  await q(`UPDATE column_config SET column_order = NULL WHERE pk_id = $1`, [formId]);
  const fields = names(await read()).sort();
  assert.deepEqual(fields, ["Order group", "Order note", "Order quantity"]);
});
