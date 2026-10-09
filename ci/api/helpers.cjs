// Shared helpers for ci/api/tests: signed tokens for the fixture users, an
// HTTP caller and a direct database client.
const jwt = require("jsonwebtoken");
const { Client } = require("pg");

const BASE = process.env.API_BASE;
const SECRET = process.env.JWT_SECRET;

// Users in ci/api/fixture.sql
const USERS = {
  user: { userId: 1, role: "User" }, // company 1, site 1
  manager: { userId: 2, role: "Manager" }, // company 1, sites 1 + 2
  admin: { userId: 3, role: "Admin" }, // company 1
  otherUser: { userId: 4, role: "User" }, // company 2, site 3
  superadmin: { userId: 5, role: "Superadmin" }, // no company
  otherManager: { userId: 6, role: "Manager" }, // company 2, site 3
  multiSiteUser: { userId: 7, role: "User" }, // company 1, sites 1 + 2 via user_sites, granted categories 1 + 2
};

const token = (who) => jwt.sign(USERS[who], SECRET);

async function call(method, route, who, body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (who) headers.Authorization = `Bearer ${token(who)}`;
  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${route}`, { method, headers, body: payload });
  const type = res.headers.get("content-type") || "";
  let json = null;
  let buffer = null;
  if (type.includes("application/json")) json = await res.json();
  else buffer = Buffer.from(await res.arrayBuffer());
  return { status: res.status, json, buffer, headers: res.headers };
}

async function withDb(fn) {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

module.exports = { call, withDb, USERS };
