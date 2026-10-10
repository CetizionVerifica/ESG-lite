# PCF-0 claim

Module: PCF-0 (PCF track, phase 0 · method sign-off). Spec: ESG-lite_FE `docs/pcf/00-pcf-plan.md` (§2 method defaults, §6 phase 0 exit check, §7 open decisions) and `docs/pcf/foundation/E1-data-and-engine/CLAUDE.md` (computePcf steps 1–7).

Plan (docs only, no code):
- `docs/pcf/phase0/method-note.md`: every §2 default with a sign-off line for Shyam; §7 open decisions as questions; pilot = Midal EC-grade aluminium wire rod 9.5 mm, Bahrain, declared unit 1 kg.
- `docs/pcf/phase0/pilot-golden.xlsx`: golden spreadsheet computing the pilot exactly as `computePcf` will (A1 with recycled split, A2 tonne.km, A3 energy allocated from plant S1+S2 by mass, packaging, waste, cut-off, primary data share, DQR). All numbers are clearly marked placeholders, not Midal data.
- `docs/pcf/phase0/pilot-golden.json`: the same inputs and expected outputs in machine-readable form, for the E1 golden test (±0.5%).
- Copy saved to `/mnt/project-files/pcf/phase0/`.
