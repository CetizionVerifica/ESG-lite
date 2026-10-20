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
