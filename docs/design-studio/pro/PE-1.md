# PE-1 · Photo edit (background remover, adjustments, filters, duotone, transparency)

> Plan: `01-pro-editing-and-ai-templates.md` (decision **E1**). Contracts: `PRO-0.md` (`proProps.ts` image props, `pro.ts` `ImageJob`, `BG_*`, `RemoveBackgroundBodySchema`). Mockup: `canvas/project/PhotoEdit.dc.html`.

## What it does
- **Photo edits on image and frame elements**, all non-destructive element props: `adjust` (brightness, contrast, saturation, warmth -100..100, blur 0..100), `filter` preset (`vivid | mono | warm | cool | fade`), brand `duotone {dark, light}`, and transparency through the existing element `opacity`. The shared renderer draws them, so editor, Page view, Present, PNG and PDF match.
- **Background remover** on the server: `POST /studio/assets/:id/remove-background` (R = Admin, Manager, Superadmin naming `company_id`) answers **202 `ImageJob`**. A one-at-a-time in-process runner cuts the subject out and stores the result as a **new** PNG asset with `derivedFrom = {assetId, op: 'remove_background'}`. The source asset is never changed or deleted. The FE keeps it on the element as `originalAssetId` ("Restore original"). `GET /studio/image-jobs/:id` returns the job (`resultAssetId` once it is `done`).

## As built
### Renderer (commit 1/5)
- `src/reporting/studio/render/imageFx.ts`: the preset and the brightness, contrast, saturation and blur sliders become CSS filter functions on the `<img>`. Warmth and duotone use an inline SVG `<filter>` (warmth is an `feColorMatrix` channel scale; duotone is Rec. 709 luminance followed by an `feComponentTransfer` table from dark to light). The mapping is documented in the file header. Images without edits render byte for byte as before.
- `render/elements/media.ts` passes the element's props to `picture()` for image and frame (grid cells have no edits). `render/types.ts` carries `ImageEditProps`. `RENDER_HASH` was bumped.
- DS golden group `photo` has 21 effects (`ci/golden/ds/photo/effect/*.json`), with the same HTML in sheet, paged, present and print, plus a Chromium pixel comparison of the editor sheet, the paged PNG and the screen PDF.

### Background remover (WIP commit da17ccd, finished in 2/5 and 3/5)
- **Engine** (`src/studio/images/bgRemove/`):
  - `engine.ts` `bgEngine()` decides which engine runs:
    - `STUDIO_BG_MODEL_PATH` names a readable file **and** `onnxruntime-node` can be required → the onnx engine.
    - A model path is set but the file or the package is missing → `null`, so the endpoint answers 503 `DS_BG_UNAVAILABLE`. A configured model never falls back to the stub.
    - No model path under `NODE_ENV=test` → the deterministic stub.
    - Otherwise → `null`.
  - `onnx.ts` requires `onnxruntime-node` lazily, inside a try/catch, at use time (`loadOrt`). It uses a minimal local type for the parts it calls, so `tsc` builds without the package. The model is u2net / u2netp / ISNet style: NCHW float32 input and a single-channel saliency output, min–max scaled.
  - Options: `STUDIO_BG_MODEL_SIZE` (64..2048, default 320 = `BG_MODEL_INPUT_PX`) and `STUDIO_BG_MODEL_NORM` (`imagenet` by default, or `half`). The job stores the engine as `onnx:<file name>` (never the path) or `stub`.
  - `stub.ts` keeps the pixels that are far from the mean colour of the image's border.
- **Processing** (`src/studio/images/process.ts`, sharp only):
  - Applies EXIF orientation, caps the longest side at 4000 px, resizes to the engine's square and gets the mask.
  - Resizes the mask back to the image and multiplies it with the source's own alpha.
  - Writes a PNG. If the PNG is over `ASSET_MAX_BYTES` it is scaled down again, at most 3 times.
  - Failure reasons are `image`, `model` and `timeout` (60 s).
- **Jobs** (`src/studio/images/jobs.ts`, table `report_image_job`):
  - Starting a job checks the tenant on the source asset, then checks the mime (`BG_INPUT_MIMES`; SVG → 415 `DS_ASSET_TYPE`), then checks that an engine exists (503 `DS_BG_UNAVAILABLE`).
  - If the same asset already has a queued or running job, that job is returned. A company may have at most 3 queued or running jobs (`DS_JOB_RUNNING` 409).
  - `processImageJob` claims a queued row. It ends `done`, with `result_asset_id` set, or `failed` with `DS_JOB_FAILED` and a reason: `model`, `image`, `timeout` or `storage`.
  - A job left `running` for more than 10 minutes fails with reason `timeout` when it is next read. A job left `queued` by a stopped process is run again when it is read.
  - The source bytes come from local storage, or from R2 through its public URL (20 s timeout, 25 MB cap).
- **Derived asset** (`src/studio/library/assets.ts`): `storeDerivedAsset` stores the result as a new `report_asset` row with `derived_from` and `derived_op`. `toAsset` adds `derivedFrom`.
  - An original that a draft still names, through `originalAssetId`, can't be deleted (`ASSET_IN_USE`, the same draft text search as `assetId`).
- **Router** (`src/studio/images/router.ts`) replaces the PRO-0 501 stub. Under `NODE_ENV=test` only, the `x-studio-test-bg: off | fail` header swaps the engine for one request: `off` stands for a server without an engine (503) and `fail` for an engine that fails.
- **Migration** `migrate:ds-pro-pe-1-photo` (`src/scripts/migrateDsProPe1Photo.ts`) is idempotent and uses `IF NOT EXISTS` only:
  - creates `report_image_job` and its two indexes;
  - adds `report_asset.derived_from` (uuid) and `report_asset.derived_op` (varchar 30).

  `scripts/migrate-all.cjs` picks up every `migrate:*` entry from `package.json` itself, so it needed no change. The entity `StudioImageJob` is registered in `data-source.ts`.
- **Probes**: the `image-jobs` row in `ID_SOURCES` and a `SEED` step (a company-1 job row) in `audit/harness/ds-probes.cjs`.
- **Dependencies**: `onnxruntime-node` 1.30.0 is declared in `package.json` and `package-lock.json`. `.npmrc` sets `onnxruntime-node-install=skip` so that an install never fetches the optional CUDA/TensorRT binaries. No model weights are committed or downloaded. An operator puts the `.onnx` file on the server and sets `STUDIO_BG_MODEL_PATH`.

## Deviations
1. **Test hook by header, not env.** The API server runs once for the whole suite, so the "engine unavailable" and "engine fails" paths are chosen per request with `x-studio-test-bg`. The header is honoured only under `NODE_ENV=test`. The env-based choice (model path set, file or package missing → unavailable) is covered by the unit tests.
2. **In-process runner**, not the DS-11 `report_job` queue (PRO-0 deviation 5: a background removal belongs to an asset, not a doc). Jobs left behind by a restart are resumed when they are read.
3. **The onnx engine is tested against a stand-in module** (`setOrtModuleForTest`) because `onnxruntime-node` isn't installed in this environment. The real-runtime test, a tiny ReduceMean model encoded by the test itself, runs only when the package is installed and is skipped otherwise.

## Not done
- FE: the Photo edit panel, the job polling, "Restore original" and the FE renderer sync for `imageFx.ts` / `RENDER_HASH` (the FE repo isn't present here).
- A real segmentation model run. That needs an operator-supplied model and an installed `onnxruntime-node`.
- No API test covers the per-company limit of 3 concurrent jobs, because the stub finishes too fast to hold three jobs open.

## Tests run (2026-10-21, NODE_ENV=test)
- `npm run build`: ok, without `onnxruntime-node` installed.
- Unit `npm run test:unit`: 647 tests, 633 pass, 0 fail, 14 skipped. Of these, `ds-pro-pe-1-bg` has 6 pass and 1 skipped (the real onnxruntime run), and `ds-pro-pe-1-photo` comes from commit 1/5.
- API `npm run test:api`: 789 tests: 782 pass, 0 fail, 7 skipped (baseline 775 pass). `ds-pro-pe-1-photo` has 7 pass and covers:
  - the migration twice;
  - switch-off for every role and Users getting `DS_ROLE`;
  - stub success, with a new derived PNG and the original's bytes unchanged;
  - Admin and Superadmin;
  - tenant 404 for another company's asset and job;
  - 503 `DS_BG_UNAVAILABLE`, 415 for SVG and a failed job;
  - an original still in use can't be deleted.

  `ds-pro-0-contracts` still has 3 pass.
- DS golden `npm run test:ds-golden`: 444 run, 444 matched, 0 failed, 2 skipped. The 2 skips are the Chromium pixel checks, including PE-1's editor/PNG/PDF comparison, because Chromium isn't installed in this environment.
