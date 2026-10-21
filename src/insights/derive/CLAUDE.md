# IN-5 · Emissions bridge (D): driver decomposition

> **Module spec**, lane L2. Copy to `ESG-lite/src/insights/derive/CLAUDE.md`.
> **PR titles:** `[IN-5 k/m]`, two PRs: 1. BE `derive/lmdi.ts` + `/insights/bridge`; 2. FE `Bridge`, `CalcDrawer`, Pathway ⇄ Bridge toggle.
>
> **Depends on:** IN-1, IN-4 (Pathway panel for the toggle) · **Owns:** `derive/lmdi.ts`, `panels/bridge.ts`, FE `panels/Bridge.tsx`, `components/CalcDrawer.tsx`
> **Touches:** —

## Job to be done
Answer the board's question "why did emissions change?" with drivers that add up exactly and can be explained in one drawer.

## Build
### Backend
1. **`derive/lmdi.ts`** (pure): `lmdiAdditive(components, factors, y0, yT)` per `research.md` §4. Returns effects per factor that sum to Eᵀ − E⁰ within 1e-6; small-value substitution flagged.
2. **`/insights/bridge?compare=prior|base`** → `Bridge` (I8):
   - components: Scope 1 = Q × I₁; Scope 2 = Q × (kWh/Q) × (tCO₂e/kWh); Scope 3 as a block (its change is its own driver).
   - Q = output from `sources/production` (combined index weights from I7 when units differ); kWh from the Scope 2 electricity data; emissions approved, from `sources/emissions`.
   - Steps in order: activity, intensity_s1, energy_intensity_s2, grid_and_renewables_s2, scope3, other (only when a scope lacks inputs: that scope's whole change goes to `other` with a note).
   - `inputs` per step for the drawer (Q₀, Qᵀ, I₀, Iᵀ, L, ln ratio).
   - `no_data` when either year lacks approved emissions; when production is missing, return only scope3 and `other` with a note "Add production data to split by driver".

### Frontend (`05-ux` §4 D)
1. **Bridge:** waterfall built from a transparent helper stack + value bars; colours from status tokens; labels with sign; plain-word driver labels from `05-ux`.
2. **Toggle:** Pathway ⇄ Bridge in the Pathway panel header with `motion.morph` (`universalTransition`).
3. **CalcDrawer:** "How this is calculated": formula in words, a table of each driver's inputs, and the notes.

## Golden cases (`ci/golden/in/bridge/`)
- hand-worked two-year example (the artifact's numbers: 52,100 → 49,700) with each driver;
- sum equals change exactly; production missing → scope3 + other only; a zero kWh year flagged.

## Tests
- **Unit:** LMDI identity on random inputs (property test, 500 cases), L(a,a) = a, small-value path.
- **API:** roles, scope, switch-off, `no_data`.
- **Playwright:** toggle morphs and back; drawer opens; table view.

## Done when
Drivers always sum to the change, the fixture matches by hand, and the drawer explains every bar.

## IN-5 as built (backend)
- **`derive/lmdi.ts`** (pure): `logMean(a, b)` (L(a,a) = a), `lmdiAdditive(components)` (components = products of named factors; effects summed by factor name across components; zero/negative values → `SMALL` 1e-9, listed in `substituted`), `bridgeSteps(from, to, {unit, outputIndex})`, `stepLabel`, `NO_PRODUCTION_NOTE`, `RESIDUE_MAX`.
  - Scope 1 = Q × I₁, Scope 2 = Q × kWh/Q × tCO₂e/kWh (the activity effect is the sum over both); Scope 3 = its change; Other = −Δ saved (no-scope rows, net = gross − saved) plus the whole change of a scope without inputs.
  - Steps in contract order; `energy_intensity_s2` / `grid_and_renewables_s2` only when both years have kWh and Scope 2 exists; `other` only when ≠ 0; production missing → `scope3` + `other` only, note "Add production data to split by driver."
  - The waterfall closes exactly: the leftover (float residue of the logs, and Overview's 3-decimal rounding of each figure, ≤ `RESIDUE_MAX` 0.005 t) is added to the largest step; anything larger throws.
  - Labels by sign: "More/Less output", "Better/Worse process efficiency", "Less/More electricity per <unit>", "Cleaner electricity" / "More carbon-intensive electricity", "Supply chain (Scope 3)", "Other".
  - `inputs` per step: activity {q_from, q_to, ln_ratio, l_scope1, l_scope2}; intensity_s1 {i_from, i_to, l, ln_ratio, scope1_from, scope1_to}; energy_intensity_s2 {kwh_per_q_from/to, kwh_from/to, l, ln_ratio}; grid {tco2e_per_kwh_from/to, scope2_from/to, l, ln_ratio, renewable_pct_from/to}; scope3 {scope3_from/to}; other {saved_from/to, scope1_change?, scope2_change?}.
- **`GET /insights/bridge?compare=prior|base`** (`panels/bridge.ts`, `buildBridge`; one router line `// IN-5`): from/to = Overview's approved net (sources/emissions). `compare=base` = the SBTi base year (`sbtiSetup`) when earlier than the period year, else the first reporting year with an approved row on the scope's sites (`sources/bridge.ts firstApprovedYear`, new); nothing earlier → `no_data`. Either year without an approved entry → `no_data`.
  - Q: Σ approved production when every site uses one unit; when units differ, a combined output index (from = 100; each site indexed in its own unit, weighted by its from-year emissions — derive `combinedOutputIndex`, I7) and a note.
  - kWh: sources/energy (Scope 2 + renewable electricity rows); a year whose rows can't be read as energy (e.g. 0 kWh) has none → Scope 2 folded into Other with a note naming the year.
  - Notes also list up to 3 events (IN-4 `eventsInRange`) between the two years.
- **Tests:** `ci/unit/in-5-lmdi.test.cjs` (L, 500-case identity property test, small values, the 52,100 → 49,700 example, folding, rounding residue, labels); `ci/api/tests/in-5-bridge.test.cjs` (production missing, LMDI by hand with a 0 kWh year, compare=base with and without a base year, no_data, roles, site scope, tenant, switch-off); golden suite `bridge` runs (`ci/golden/in/bridge/fixture.json`: 2024 → 2025 all sites as an output index, the Manager's one-unit sites, base 2021 → 2025 on site 902, no_data, events in notes).
