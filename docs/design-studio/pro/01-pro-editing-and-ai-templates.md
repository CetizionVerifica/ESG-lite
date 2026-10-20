# Pro editing and AI template suggestion (focus, 2026-10-20)

The owner asked for **Canva Pro's editing features** and **template suggestion from the AI assistant**. This file narrows `README.md` to those two things. It is planning only. Mockups: Design canvas "Studio Premium Mockups" (rows 1–2).

## 1. Gap check: Canva Pro editing vs the Design Studio editor (`wt/ds-fe` `features/studio/editor`)

| Canva Pro editing feature | Design Studio today | Plan |
|---|---|---|
| Magic Resize | ✅ DS-10 resize and convert | none |
| Brand Kit and Styles (one-click restyle) | ✅ DS-3; AI action `suggest_style` | PE-4: "Apply style to the whole report" |
| Crop, frame masks, corner radius, flip | ✅ (`toolbars.tsx`) | none |
| Copy style (paint format), undo | ✅ | none |
| **Background remover** | ❌ | **PE-1** |
| **Photo adjustments and filters** (brightness, contrast, saturation, blur, presets, duotone) | ❌ | **PE-1**, with duotone in brand colours |
| Transparency per element | 🟡 shapes only | PE-1: images and text too |
| **Text effects** (shadow, outline, highlight, lift, curve) | ❌ (shadows on shapes only) | **PE-2** |
| **Custom font upload** | 🟡 brand kit fonts are a fixed list | **PE-2**: upload WOFF2/TTF with a "we hold the licence" tick; the PDF embeds the subset |
| **Find and replace across the report** | ❌ | **PE-2**: text frames only; data chips are never replaced |
| **Version history panel** (named versions, restore, compare) | 🟡 autosaves exist, no panel | **PE-3** |
| Grab Text (image → editable text) | ❌ | PE-5 (later): OCR in the browser |
| Magic Eraser / Magic Expand / Magic Edit (AI image) | ❌ | PE-5 (later): needs an image model; out of scope for v1 |
| Magic Animate, video, Content Planner | ❌ | Skip (reports are print and PDF) |

## 2. AI template suggestion

There are two places to get it.

**A. When starting a report (`/studio/new`, step 1 "Template"): a "Help me choose" panel**

1. **The brief.** The user answers a short form:
   - Purpose: annual sustainability report / GHG inventory / board brief / site fact sheet
   - Frameworks: preset from what the company has switched on (GRI, BRSR, ESRS, ISO 14064-1)
   - Audience: board / investors / public / regulator
   - Length: about 2 / 12 / 40 pages
   - Tone

   An optional free-text line is fenced as untrusted text.
2. **Rule shortlist (deterministic, BE).** The server keeps only the templates that match the kind, the frameworks and the format. It then scores **data readiness** against the company's approved data: approved months per scope, Scope 3 categories with data, and KPI coverage per framework. Templates whose required sections would mostly print "Not reported" drop down the list.
3. **AI explains and re-orders (DS-9 guard).** It sees the shortlist plus counts (never raw figures). It returns the **top 3 template ids from the shortlist**, two or three reasons each, and the pages to drop or add. The server rejects any id not in the shortlist and any literal number not taken from the counts, retries once, and otherwise falls back to the rule order with no reasons.
4. **Cards.** Each card shows a thumbnail rendered with the company's brand kit, the reasons and readiness badges, for example "Scope 3: 9 of 15 categories have data → 6 category pages show 'Not reported'". It has two buttons: **Preview with my data** (opens a paged preview from `/resolve`) and **Use this**.

**B. Inside the editor (AI drawer)**

- **Suggest layouts** (`suggest_layouts`; the action is listed but not built): three layouts for the selected page, built only from library blocks and the page's current content and data chips. They are shown as ghost previews (`GhostPreview.tsx` exists) and applied as one undo step.
- **Try another template:** restyles the whole report with another template while keeping text, chips and charts. The result is shown side by side before it's applied.

## 3. Modules

| Module | Scope | BE | FE |
|---|---|---|---|
| **AT-1 Template suggestions (new report)** | `POST /studio/templates/suggest` {brief} → shortlist + readiness + AI reasons; Help me choose panel; preview with my data | 3 | 3 |
| **AT-2 Suggest layouts + try another template (editor)** | Build `suggest_layouts`; template swap that keeps content; ghost previews; one undo step | 2 | 3 |
| **PE-1 Photo edit** | Background remover (server: ONNX segmentation model in a job, result stored as a new asset; the original is kept); adjustments, filters, brand duotone, transparency; the renderer applies them as SVG/CSS filters so the PDF matches | 3 | 3 |
| **PE-2 Text effects, fonts, find and replace** | Shadow, outline, highlight, lift, curve; font upload with licence tick and PDF embedding; find and replace (skips chips) | 2 | 3 |
| **PE-3 Version history** | Named versions, restore as a new draft, compare two versions (page thumbnails + text diff + figures changed) | 1.5 | 2.5 |
| **PE-4 Apply style to the whole report** | Palette and font pairs from the brand kit and `suggest_style`, one click, one undo step | 0.5 | 1.5 |
| PE-5 (later) Grab text, AI eraser and expand | OCR in the browser; image model later | — | — |

Total ≈ 31 dev-days (BE 12, FE 19). Order: **AT-1 → AT-2 → PE-1 → PE-2 → PE-3 → PE-4.** The AI ones come first because those are what the owner asked for and they reuse DS-9's guard.

## 4. Rules each module keeps

- Figures stay data chips. Find and replace, translation, AI text and template swaps never type a number.
- Image edits are non-destructive: the original asset stays, and the edit is stored as parameters or as a derived asset.
- The PDF renderer must show every effect exactly as the editor does. Each effect gets a golden render test.
- Finals stay immutable; restore creates a new draft.
- Plan gating (README DS-15) can be added later. These features work for every company with the studio switched on until plans exist.

## 5. Decisions needed

- **E1 Background remover engine:**
  - a server ONNX model (MIT-licensed weights, runs in our job queue), or
  - a browser WASM library (no server load; check its licence: some are AGPL).

  Proposal: the server model.
- **E2:** May the AI suggestion see template names *and* the company's free-text brief? Proposal: yes, fenced, with no PII.
- **E3:** Custom fonts: Managers only? Proposal: yes, the brand kit is already Manager-only.
