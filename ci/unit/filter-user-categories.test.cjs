// Unit tests for the session user's category filter (login and /auth/me).
// Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { filterUserSiteCategories } = require(path.resolve("dist/utils/filterUserCategories.js"));

const cat = (category_id, category_name) => ({ category_id, category_name });
const site = (site_id, categories) => ({ site_id, categories });

test("keeps only the granted categories, and every site's FERA category id even when FERA isn't granted (D6a)", () => {
  const user = {
    categories: [cat(6, "Business Travel")],
    sites: [site(3, [cat(6, "Business Travel"), cat(9, "FERA"), cat(1, "Fuel")]), site(4, [cat(1, "Fuel")])],
    site: site(3, [cat(6, "Business Travel"), cat(9, "fera")]),
    password: "hash",
  };
  filterUserSiteCategories(user);
  assert.deepEqual(user.sites[0].categories, [cat(6, "Business Travel")]);
  assert.equal(user.sites[0].fera_category_id, 9);
  assert.deepEqual(user.sites[1].categories, []);
  assert.equal(user.sites[1].fera_category_id, null);
  assert.deepEqual(user.site.categories, [cat(6, "Business Travel")]);
  assert.equal(user.site.fera_category_id, 9);
  assert.equal("categories" in user, false);
  assert.equal("password" in user, false);
});

test("with no grants every category stays, and the FERA id is set too", () => {
  const user = { categories: [], sites: [site(3, [cat(6, "Business Travel"), cat(9, "FERA")])], site: null };
  filterUserSiteCategories(user);
  assert.deepEqual(user.sites[0].categories, [cat(6, "Business Travel"), cat(9, "FERA")]);
  assert.equal(user.sites[0].fera_category_id, 9);
});
