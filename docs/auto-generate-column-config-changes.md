# Auto-Generate Column Config — Bug Fixes & Changes

## What This Feature Does

The auto-generate column config feature takes emission factor names for a site+category, splits them by `" - "` to detect dimensions, and builds a column configuration (dropdown options, dependencies, mappings) for the data entry form.

**Example:** The emission factor name `"Road - Van - Diesel [tonne.km]"` gets split into 3 dimensions:
- Dimension 0: `Road` (Travel Mode)
- Dimension 1: `Van` (Vehicle Type)
- Dimension 2: `Diesel [tonne.km]` (Fuel Type/Class)

---

## Files Modified

| File | Location |
|------|----------|
| `Backend/src/services/columnConfigGenerator.ts` | Backend TypeScript service |
| `python-ai-service/app/api/column_config.py` | Python AI/LLM service |

---

## Bug Fix 1: Duplicate Unit Groups (km vs Km)

**File:** `columnConfigGenerator.ts` — lines 277, 316

**Problem:**
The database had emission factors with `denominator_unit` stored as both `"km"` and `"Km"`. Since the grouping key was case-sensitive, these created **two separate config groups** in the output — one with 11 entries and another with 2 entries, even though they're the same unit.

**Before (broken):**
```
Unit group "km"  → 11 emission factors → Config group 1
Unit group "Km"  → 2 emission factors  → Config group 2  (duplicate!)
```

**After (fixed):**
```
Unit group "km"  → 13 emission factors → Single config group
```

**What changed:**
Added `.toLowerCase()` when creating the unit grouping key.

```typescript
// ECM path (line 277)
const unit = (row.denominator_unit || "unknown").trim().toLowerCase();

// EF path (line 316)
const unit = (row.denominator_unit || "unknown").trim().toLowerCase();
```

**Impact:** Minimal. Only adds `.toLowerCase()` to the grouping key. All downstream logic works the same — it just receives more entries per group instead of splitting them.

---

## Bug Fix 2: Wrong Dimension Detection (2-dim instead of 3-dim)

**File:** `columnConfigGenerator.ts` — `detectPattern()` function (lines 484-521)

**Problem:**
For the "Downstream transportation" category with `tonne.km` unit, the database has emission factors with **two naming conventions**:

| EF Name | Parts when split by " - " |
|---------|--------------------------|
| `Van - CNG` | 2 parts (abbreviated, no mode prefix) |
| `Road - Van - CNG [tonne.km]` | 3 parts (full, with mode prefix) |

There were 14 two-part names and 12 three-part names. The old `detectPattern()` picked the **most frequent** count → `TWO_DIM`. But ALL entries actually have 3 real dimensions (Mode > Vehicle > Fuel). The 2-part names just have the mode omitted.

**Before (broken):**
```
detectPattern() → TWO_DIM (because 14 > 12)
Result: "Road" appeared as a Vehicle Type option (wrong!)
```

**After (fixed):**
```
detectPattern() → THREE_DIM (because 12 three-part entries = 46% of 26 total, well above 25% threshold)
Result: "Road" correctly appears as a Travel Mode option
```

**What changed:**
Instead of picking the most frequent dimension count, the function now picks the **highest** dimension count that has **significant representation** (at least 25% of entries, minimum 2).

```
Logic:  total = 26 entries
        minSignificant = max(2, ceil(26 * 0.25)) = max(2, 7) = 7
        2-dim has 14 entries → 14 >= 7 → significant
        3-dim has 12 entries → 12 >= 7 → significant
        Pick the HIGHEST → 3-dim
```

**Edge case protection:**
- If only 2 out of 50 entries are 3-dim → threshold = max(2, 13) = 13 → only 2-dim passes → picks TWO_DIM correctly (3-dim is just noise)
- If all entries are 2-dim → only 2-dim exists → picks TWO_DIM correctly

**Impact:** Only changes which pattern is selected as dominant. The `column_names_by_dim` structure still provides all available dim counts for the frontend toggle.

---

## Bug Fix 3: Missing Entries When 3-dim Selected (Rail disappeared)

**File:** `columnConfigGenerator.ts` — `promoteToThreeDim()` function (lines 523-611) + line 349

**Problem:**
When `THREE_DIM` was the dominant pattern, the code filtered entries with: `parsed.filter(p => p.parts.length === 3)`. This **dropped all 2-part entries**. The "Rail" vehicle type only existed in 2-part EF names (`"Road - Rail"` and `"Rail - Rail Fuel"`) with no 3-part equivalent — so Rail vanished entirely.

**Before (broken):**
```
3-dim selected → filter to parts.length === 3
"Road - Rail" (2 parts) → DROPPED
"Rail - Rail Fuel" (2 parts) → DROPPED
Result: Rail missing from Vehicle Type options
```

**After (fixed):**
```
3-dim selected → promoteToThreeDim(parsed)
Step 1: Keep all 3-part entries as-is
Step 2: Learn vehicle→mode mappings:
        From 3-dim: Van→Road, flight→Air, Cargo ship→Sea
        From 2-dim: "Road - Rail" → Rail→Road
Step 3: Promote 2-dim entries:
        "Rail - Rail Fuel" → mode=Road (from step 2) → ["Road", "Rail", "Rail Fuel"] ✓
        "Van - CNG" → mode=Road → ["Road", "Van", "CNG"] → DEDUP against "Road - Van - CNG [tonne.km]" → SKIP ✓
        "Road - Rail" → mode=Road, vehicle=Rail → already covered by "Rail - Rail Fuel" promotion → SKIP ✓
Result: Rail appears under Vehicle Type with "Rail Fuel" as its Fuel Type/Class
```

**What changed:**

1. New function `promoteToThreeDim(parsed)` that:
   - Keeps all existing 3-part entries
   - Learns which mode each vehicle belongs to (from 3-dim entries AND from 2-dim entries like `"Road - Rail"`)
   - Promotes 2-part entries by prepending the inferred mode
   - Deduplicates: if a promoted entry matches an existing 3-dim entry (case-insensitive, ignoring unit suffixes like `[tonne.km]`), it's skipped

2. Line 349 changed from:
   ```typescript
   const filteredParsed = parsed.filter((p) => p.parts.length === expectedDimCount);
   ```
   To:
   ```typescript
   const filteredParsed = pattern === "THREE_DIM"
     ? promoteToThreeDim(parsed)
     : parsed.filter((p) => p.parts.length === expectedDimCount);
   ```

**Impact:** Only affects the THREE_DIM code path. FLAT and TWO_DIM patterns are completely untouched — they still use the original `filter()` logic.

**Deduplication examples:**

| 2-part EF Name | Promoted to 3-part | Existing 3-part match? | Action |
|---|---|---|---|
| `Van - CNG` | `Road - Van - CNG` | `Road - Van - CNG [tonne.km]` (match after stripping `[tonne.km]`) | SKIP |
| `Rail - Rail Fuel` | `Road - Rail - Rail Fuel` | No match | ADD |
| `Cargo Ship - General Cargo` | `Sea - Cargo Ship - General Cargo` | `Sea - Cargo ship - General Cargo` (case-insensitive match) | SKIP |
| `Flight - Domestic` | `Air - Flight - Domestic` | `Air - flight - Domestic` (case-insensitive match) | SKIP |

---

## Bug Fix 4: LLM Naming Columns Incorrectly

**File:** `python-ai-service/app/api/column_config.py` — `_build_inference_prompt()` and `_build_multi_group_prompt()`

**Problem:**
The LLM received dimension sample values like `[Bus, Car, Domestic flight, International flight, Train, Sea, Taxis]` and named this column **"Travel Mode"** instead of **"Vehicle Type"**. It also inconsistently named columns across different unit groups (passenger.km got "Travel Mode + Vehicle Type", km got "Travel Mode + Fuel Type/Class").

**Before (broken):**
```
passenger.km → dim0: "Travel Mode", dim1: "Vehicle Type"
km           → dim0: "Travel Mode", dim1: "Fuel Type/Class"
Merged UI showed 3 dropdown groups instead of 2 — confusing!
```

**After (fixed):**
```
passenger.km → dim0: "Vehicle Type", dim1: "Fuel Type/Class"
km           → dim0: "Vehicle Type", dim1: "Fuel Type/Class"
Merged UI shows 2 consistent dropdown groups
```

**What changed:**
Added an **ESG Column Naming Conventions** section to both LLM prompts:

```
ESG Column Naming Conventions:
- "Travel Mode" = ONLY broad transport modes: Road, Air, Sea, Rail
- "Vehicle Type" = specific types: Car, Van, Bus, Train, Flight, etc.
- "Fuel Type/Class" = fuel types OR travel classes OR sub-types
- 2-dim transport: dim 0 = "Vehicle Type", dim 1 = "Fuel Type/Class"
- 3-dim transport: dim 0 = "Travel Mode", dim 1 = "Vehicle Type", dim 2 = "Fuel Type/Class"
```

**Impact:** Only affects the system prompt sent to the LLM. No code logic changes. The LLM now has clear rules for ESG-specific column naming instead of guessing.

---

## Summary of All Changes

| # | What | Where | Risk |
|---|------|-------|------|
| 1 | Unit case normalization (`.toLowerCase()`) | `columnConfigGenerator.ts:277,316` | Very low — additive |
| 2 | `detectPattern()` prefers highest significant dim | `columnConfigGenerator.ts:484-521` | Low — only changes which dim is default |
| 3 | `promoteToThreeDim()` new function | `columnConfigGenerator.ts:523-611` | Low — isolated function, only called for THREE_DIM |
| 4 | Wire promotion at filter line | `columnConfigGenerator.ts:349-351` | Low — only THREE_DIM path, FLAT/TWO_DIM unchanged |
| 5 | LLM prompt conventions | `column_config.py:187-192,220-225` | Very low — prompt text only |
