// DS-14 golden group "status" (DS-0): GET /studio/status for every role of the API fixture's
// company 1 (and company 2's Manager), in all four states of the studio and KPI tracking
// switches, plus what the guard answers on a gated route in that state for those whose
// answer can't depend on which modules have landed: everyone while the studio is off
// (DS_STUDIO_OFF) and the Users while it is on (DS_ROLE). Restores both switches after.
const WHO = ["user", "multiSiteUser", "manager", "admin", "superadmin", "otherManager"];

module.exports = async function status(ctx) {
  const { q, call } = ctx;
  const set = (studio, kpi) => q(`UPDATE company SET design_studio_enabled = $1, kpi_tracking_enabled = $2 WHERE company_id = 1`, [studio, kpi]);
  const [before] = await q(`SELECT design_studio_enabled AS s, kpi_tracking_enabled AS k FROM company WHERE company_id = 1`);
  const out = {};
  try {
    for (const [studio, kpi] of [[false, false], [false, true], [true, false], [true, true]]) {
      await set(studio, kpi);
      const state = {};
      for (const who of WHO) {
        const r = await call("GET", who === "superadmin" ? "/studio/status?company_id=1" : "/studio/status", who);
        const row = { status: r.status, body: r.json };
        if (!studio || who === "user" || who === "multiSiteUser") {
          const g = await call("GET", who === "superadmin" ? "/studio/docs?company_id=1" : "/studio/docs", who);
          row.guard = `${g.status} ${g.code}`;
        }
        state[who] = row;
      }
      out[`studio ${studio ? "on" : "off"}, kpi ${kpi ? "on" : "off"}`] = state;
    }
  } finally {
    await set(before.s, before.k);
  }
  return out;
};
