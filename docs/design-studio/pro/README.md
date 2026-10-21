# Canva premium features: teardown for ESGLite Design Studio

Research only, written 2026-10-20. This looks at how Canva's paid tiers (Pro, Teams, Enterprise) behave from the user's side, using public help pages and reviews. It then checks each feature against what Design Studio (`ds/local`, PRs BE #177 / FE #227) already does, and proposes premium modules for ESGLite.

**What "reverse engineer" means here:** we work out what each feature does, how it is gated and what it would take to build our own. We do not copy Canva's code, assets or templates, and we do not get around its paywall. canva.com refuses automated fetches (HTTP 403), so Canva facts come from search extracts of its help centre and from third-party 2026 reviews. Items marked **[unverified]** have only third-party sources.

## 1. How Canva gates premium

| Tier | Price (2026; sources disagree) | What the tier adds |
|---|---|---|
| Free | 0 | 1 brand kit (colours only) **[unverified]**, 5 GB storage, about 50 AI credits a month **[unverified]** |
| Pro | about $15 a month or $120 a year | Premium content, Magic Resize, background remover, multiple brand kits, Bulk Create, full Magic Studio, version history, transparent PNG and SVG export |
| Teams / Business | about $10 per seat a month, 3-seat minimum | Shared brand kits with admin controls, **brand templates with locks**, **design approvals (single reviewer)**, team folders, central billing |
| Enterprise | Custom | SSO and SCIM, **multiple and group approvers**, approval scope (all designs / all except some templates / only some templates), audit logs, Brand Controls tab |

**The gating pattern.** Premium items stay visible to Free users, with a crown badge. Using one opens the upgrade sheet; in some cases the item works in the editor but download is blocked. Users see what they're missing at the moment they want it. AI is metered by credits rather than switched off.

## 2. Premium features, how they behave, and where ESGLite stands

Status: ✅ built on `ds/local` · 🟡 partly built · ❌ not built.

| # | Canva premium feature | Behaviour (from the user's side) | ESGLite today | Verdict |
|---|---|---|---|---|
| 1 | **Brand Kit** (several kits; logos, colours, fonts, brand voice) | Kits per brand; the editor's colour and font pickers put the kit first; the AI uses the brand voice | ✅ DS-3: one kit per company, contrast checks, brand voice passed to the AI | **Extend:** several kits per company (group brand plus subsidiaries), Enterprise-only |
| 2 | **Brand templates + locks** | Admin publishes a template; locked elements can't be moved or edited; locks also stop the AI from changing them | 🟡 DS-4/DS-6: element and page locks, template locks (from RS-10) | **Extend:** "publish as company template" with per-element lock roles; archiving is open decision L3 |
| 3 | **Design approvals** | Per-template "require approval"; download and publish blocked until approved; Enterprise adds several approvers or a group | ✅ DS-13: approval bar, withdraw, Manager approval before a final | **Extend:** require approval per template; several approvers in order (preparer → sustainability lead → CFO) |
| 4 | **Magic Resize / Magic Switch** | One design copied into several formats, laid out again | ✅ DS-10: resize and convert (full report ↔ one-page ↔ board brief) | Done; keep it premium |
| 5 | **Translate (Magic Switch)** | Translates a whole design and keeps the layout | ❌ | **Adopt:** translate a report's narrative (Hindi, Arabic, others). Figures stay server tokens and are never translated or retyped |
| 6 | **Bulk Create / Autofill** | CSV to many designs; Autofill API (Pro since 2026-09) fills templates from data, including charts | ❌ (DS-2 data binding is one design at a time) | **Adopt, high value:** one template rendered for every site or subsidiary ("site fact sheets"), queued as jobs |
| 7 | **Magic Write** (with brand voice) | Short copy drafted in the brand voice; weak beyond about 150 words | 🟡 DS-9: AI suggestions, with the rule that numbers must come from the data | Keep the number guard; add "rewrite in brand voice" and "shorten to fit the frame" |
| 8 | **Magic Design / suggest layouts** | Several layouts suggested from a brief | ❌ (DS-9 `suggest_layouts` not built) | **Adopt:** three layouts per section, built only from the library's elements |
| 9 | **Magic Charts / Sheets insights** | Charts from live data, plus AI-written insights | ✅ DS-8 charts from approved data; 🟡 AI findings are number-checked | Done; insights stay checked against the data |
| 10 | **Version history** | Named and automatic versions, restore | ✅ autosaves and immutable finals | **Extend:** compare two versions, restore a draft from a final |
| 11 | **Premium content library** | Licensed stock, icons and templates | 🟡 DS-4 small in-house library | **Adapt:** a curated ESG icon and illustration set; no stock licensing |
| 12 | **Background remover / photo tools** | One click | ❌ | **Skip:** not central to a report; users upload images that are already prepared |
| 13 | **Transparent PNG / SVG / print PDF** | Pro export options | 🟡 DS-11: PDF with bleed, plus share links | **Extend:** export charts as PNG/SVG for slides; PDF/A for filing |
| 14 | **Audit log** (Enterprise) | Who created, edited, shared or downloaded what | 🟡 approvals and the switch are audited | **Extend:** a studio audit log covering download, share, final and approve events (assurance providers ask for this) |
| 15 | **SSO / SCIM** | Enterprise identity | ❌ (handled outside the studio) | Out of scope here; belongs to the platform plan |
| 16 | **Team folders and shared drafts** | Folders, sharing within the team | 🟡 DS-5 home and list, company scope, site rules | **Extend:** folders by reporting year and framework |
| 17 | **Content Planner / scheduling** | Schedule social posts | ❌ | **Skip** |

## 3. What Canva's model teaches us

1. **Show premium, gate the outcome.** Let Free and Starter companies design with premium looks, but put the gate on the **final and download** (and on bulk runs). The final gate (DS-12) is already a natural chokepoint.
2. **Meter AI, don't switch it off.** A monthly AI action allowance per company, with a counter in the AI drawer.
3. **Governance is what Enterprise buys.** Locks, approvals, audit trails and several brands sell the top tier. For ESG this matters more than for Canva: assurance and board sign-off are the reason the report exists.
4. **Data-driven bulk output** is Canva's newest premium push (Autofill opened to Pro in September 2026). ESGLite already owns the approved data, so bulk site and subsidiary reports are where we beat Canva rather than copy it.

## 4. Proposed premium modules (planning only; to become DS-15 onwards)

| Module | Scope | Tier | Rough effort |
|---|---|---|---|
| **DS-15 Plans and entitlements** | `studio_plan` per company (free / pro / enterprise); `requireEntitlement(feature)` on the BE; crown badge and upgrade sheet on the FE; AI allowance counter | All | BE 2, FE 2 |
| **DS-16 Bulk reports** | One template × N sites or subsidiaries; one job per output; zip download; each output is its own final, with approvals | Pro | BE 4, FE 3 |
| **DS-17 Translate narrative** | Machine translation of text frames only; tokens kept; side-by-side check; right-to-left layout for Arabic | Pro | BE 2, FE 3 |
| **DS-18 Suggest layouts** | DS-9 `suggest_layouts`: three choices per section from library blocks, run through `ElementSchema` and the checks | Pro | BE 2, FE 2 |
| **DS-19 Governance pack** | Several brand kits, require approval per template, approvers in order, studio audit log with CSV export | Enterprise | BE 4, FE 4 |
| **DS-20 Exports+** | Chart PNG/SVG, PDF/A-2b, version compare | Pro | BE 2, FE 2 |

Total ≈ 32 dev-days (BE 16, FE 16). Suggested order: DS-15 first (everything else is gated by it), then DS-16 (biggest win), DS-19, then the rest.

## 5. Decisions the owner needs to make

- **P1:** Which tiers and names? (Proposal: Free, Pro, Enterprise, matching Canva's mental model.)
- **P2:** What is gated: download/final only, or the editor too? (Proposal: gate the outcome.)
- **P3:** AI allowance size per tier.
- **P4:** Does an existing customer with the studio switched on keep Pro features free during a grace period?
- **P5:** Is translation done with machine output only, or flagged "needs human review" before a final? (Proposal: flagged, and blocking the final.)

## Sources
- Canva approvals: https://www.canva.com/help/design-approval/ · https://www.canva.com/help/design-approval-for-enterprise/ · https://www.canva.com/help/manage-approval-settings-for-teams/ · https://www.canva.com/en_in/help/publish-team-template/
- Canva brand tools: https://canva.com/for-teams/brand-management-tools/ · https://www.canva.com/newsroom/news/introducing-canva-for-teams/
- Autofill changelog: https://www.canva.dev/docs/connect/changelog/
- Tiers and pricing (third-party, conflicting): https://creatorstoolbox.com/blog/canva-pro-vs-free · https://subfree.io/guides/canva-pro-2026 · https://www.usecarly.com/blog/canva-free-plan-limits/ · https://theottdeals.com/articles/canva-pro-guide-faster-design-workflows-for-creators-and-small-brands.html · https://www.toolsurf.com/canva-pro-for-teams-2026/ · https://www.selecthub.com/p/photo-editing-software/canva-enterprise/
- Magic Studio (third-party): https://fast.io/resources/canva-ai-review-2026/ · https://www.allable.ai/blog/canva-ai-review/ · https://pasqualepillitteri.it/en/news/601/canva-ai-magic-studio-guide
- Sheets and Magic Charts: https://www.businesstoday.in/amp/technology/news/story/canva-unveils-visual-suite-20-adds-sheets-ai-powered-tools-and-one-stop-design-workflows-471602-2025-04-11
- Earlier Canva research: `plans/design-studio/research.md`
