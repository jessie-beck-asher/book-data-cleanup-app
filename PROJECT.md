# Book Data Cleanup App

## Purpose

Clean up book item data in a Square catalog using ISBNdb as a reference source.

Intended flow:

1. **Pull** item data from Square (read-only).
2. **Extract** only the items that have an ISBN, keeping each one attached to its Square identifier (the catalog object ID, plus its `version`), which is what Square needs to update the right item later.
3. **Fetch** ISBNdb responses for all of those items and save them to a local JSON file, linked back to the original Square items (keyed by Square object ID). **Nothing is sent to Square in this step.**
4. **Dashboard:** a list of every book/ISBN, shown by its Square title.
5. **Item detail page** (opened by clicking a dashboard row): shows the original Square values for specific fields (to be specified later) alongside the ISBNdb data. Merge steps to be specified later, e.g.:
   - optimized image
   - proposed updated title
   - proposed details/description section
6. **Edit:** the user can edit anything that looks off before approving.
7. **Update button** per detail page: "Looks good, let's update in Square". Only when pressed is **that one item** updated in Square. Only the agreed fields are changed. No item is deleted or replaced, and no other items are touched.

## Working Principles

- **The owner makes all decisions.** Claude proposes options and a recommendation; nothing is chosen or built until approved.
- **Slow and conservative.** Small steps, each reviewed before the next.
- **No writes to Square without explicit per-item user confirmation.** Nothing is ever batch-updated. Steps 1-3 are strictly read-only with respect to Square.
- **Never changed, under any circumstances:** price (including variation pricing) and custom attributes. Square's catalog update replaces the whole item, variations included, so these values are sent back **exactly as pulled**, never edited. The diff shows them as "unchanged", and the version check blocks the update if the item changed in Square since the pull.
- **Variations (owner-decided):** every book has one variation. If it is not already a plain "Regular" (122 of 1,051 are named after Language/Format item options), the proposal renames it to "Regular" and removes those item options from the variation and the item, keeping the same variation ID so SKU/GTIN, price, on-hand counts, vendor info, unit cost, location settings, channels and images stay. To be tested on the sandbox before production.
- **Updates are partial, never destructive:** items are never deleted, there is no full-object replacement, and only the specified fields change. The one owner-approved exception is images: the owner can remove images from an item on its detail page (see "Images").
- **No secrets in chat, code, logs, or git.** See below.

## Secrets & Security Rules

- API keys / tokens (Square, ISBNdb) live **only** in a local, git-ignored environment file (e.g. `.env`), created and filled in by the owner by hand.
- Claude must never ask for, read, print, echo, or paste secret values. Claude will not open the `.env` file.
- A `.env.example` with variable *names only* (no values) may be committed.
- `.gitignore` must exclude `.env` and similar **before** any other code is written.
- Secrets are used server-side only; never shipped to browser code.
- `.env.example` lists variable names only (e.g. Square access token, Square environment, ISBNdb key).
- Code reads the environment from the env var and has no other environment-specific logic.
- Logs and error messages must not include auth headers or tokens.
- Verify no secret is staged before every commit.
- Because changing an env var can point the same code at production, the UI shows the active Square environment at all times, and the write path stays per-item, diff-confirmed, and version-checked in every environment.

## Safety Guardrails (proposed, pending approval)

- Read-only Square access first; the write path is built last.
- Update only the specific fields the user approved, for the single item shown.
- Show a before/after diff before the "Yes!" button applies anything.
- Use Square's item `version` for optimistic concurrency so a stale edit cannot overwrite newer changes.
- Respect ISBNdb rate limits and plan quota; cache responses locally to avoid repeat calls.
- Consider a dry-run mode and a local log of what was changed (no secrets in it).

## Open Decisions (all owner's call)

| # | Question | Notes |
|---|----------|-------|
| 1 | Tech stack | **Decided: Nuxt.** Nitro server routes keep Square/ISBNdb calls and keys server-side. **TypeScript: yes.** Version: latest stable release; the exact version is confirmed against the official source at setup time and pinned (not assumed), and runs on the current Node LTS |
| 2 | Square environment | **Decided: driven by env variables;** owner switches environments. See safety note below |
| 3 | Which Square field holds the ISBN | **Decided: GTIN usually, SKU sometimes** (often when an unusual variant is attached). Still open: see "ISBN extraction" below |
| 4 | Which fields are shown, and which may be updated | **Decided for Square: title, description, categories** (editable/updatable). **Shipping weight is NOT updatable via API (Square's Catalog API doesn't expose it, per forum/staff posts, still to confirm on a real item). Instead it is shown on the interface as read-only ISBNdb reference data, converted to pounds, for the owner to copy and paste into Square by hand.** **Excluded for good: price, custom attributes.** **Image: now in scope (see "Images").** ISBNdb: what to store in the JSON and what to show/use is decided later, as we go |
| 5 | Handling items with no ISBN or no ISBNdb match | **Decided for no-ISBN items: ignore** (scope is books only). **Decided for ISBN with no ISBNdb match:** stays on the dashboard, labeled "No match"; untouched in Square unless edited by hand and approved |
| 6 | ISBNdb plan and rate limits | **Decided: Basic plan**, starting with the 7-day free trial. Limits: 5,000 searches/day, 1 request/second, $14.99/month after trial. Design implications below |
| 7 | Progress tracking and storage | **Decided: three local JSON files** (see "Local data files" below). Still open: file location/names and whether they are git-ignored |
| 10 | Image handling | **Decided in principle: images are in scope.** images are chosen, cropped/fitted and optimized to JPEG in the app before they go to Square (see "Images"). Details under "Images" below |
| 8 | Hosting / how the app runs | **Decided: local only, single user (owner).** Data files stored locally. Backups: see note under "Local data files" |
| 9 | Where the project lives in git | **Decided: its own repo** (`git init` in this folder; it was not inside a parent repo). Data files and images are git-ignored (`data/`) |

## ISBN extraction (proposed details, pending approval)

- In Square, GTIN and SKU live on an item's **variations**, not on the item itself. So for each match we keep the parent item's catalog object ID and `version` plus the matching variation's ID, and record which field (GTIN or SKU) the ISBN came from.
- Check GTIN first, then SKU. Open: what to do if both are present and differ, or if an item has several variations with different ISBNs (flag for manual review rather than guess).
- Normalize before lookup (strip hyphens/spaces); accept ISBN-10 and ISBN-13 and validate check digits. Items with no ISBN are out of scope and ignored; the app only handles books.
- Phase 1 should first report counts only (items with GTIN ISBN, SKU ISBN, both, ambiguous, plus a total of ignored non-ISBN items) so you can sanity-check before any ISBNdb calls are spent.
- **Archived items are included** (owner decision, so updated data is ready if she re-activates them) and are marked "archived" in the app.
- Production check (counts only): 0 items have conflicting valid ISBNs across variations, so one ISBN per book item holds. Checking the SKU only when the GTIN is empty lost no ISBNs. Non-book items are simply not shown; nothing is stored for them.

## Updatable fields: things to verify in Phase 1 (read-only)

- Title and description live on the item; check whether description is stored as plain text, HTML, or both so we write the right one.
- Categories may live on a different Square object (separate category objects). Inspect real data to confirm before designing the update call. Shipping weight is not read from or written to Square; it comes from ISBNdb (if present) and is displayed in pounds only.
- The write path is a strict allowlist of these four fields; anything else (including price and custom attributes) is carried over unchanged.

## Local data files (owner-decided design; details proposed)

Three local JSON files, so no API is hit more than necessary:

1. **Square snapshot** — pulled **once** (full catalog pull; only ISBN-bearing books are worked on, other items kept just for the shared-image check). Holds the ISBN-bearing books with their Square IDs (item ID, variation ID, `version`) and the current values of the fields we care about. A "re-pull from Square" button may be added later; it is not part of the first version.
2. **ISBNdb data** — the full raw response per book, saved locally and keyed by ISBN, linked back to the Square items. Fetched once per ISBN and kept (including "No match" results), so it never needs to be re-fetched.
3. **Merged data** — created per item when the user clicks into it and the app attempts to merge (Square + ISBNdb, using merge logic to be written together). Holds the merged/proposed values and the user's edits, plus a **`wasUpdated`** boolean that flips to `true` once the data has been sent to Square.

Proposed safeguards (pending approval):
- `wasUpdated` is set only after Square confirms the update succeeded, never before. A failed write leaves it `false`.
- Files are written atomically (write to temp file, then rename) so a crash cannot corrupt them; user edits are saved as they are made.
- The merged file never overwrites the user's edits when merge logic is re-run.
- Because the Square snapshot goes stale, the update step uses the item's `version` and fails safely if the item changed in Square since the pull.
- Local-only means a single copy on one disk. The ISBNdb data cost quota and the merged file holds hours of edits, so keep them backed up (e.g. Time Machine, or a periodic copy to a private location) even if git-ignored.
- The data files contain business data, not secrets; whether they are git-ignored is the owner's call (proposal: ignore them).

## Images (owner-decided requirements; details proposed)

Requirements:
- After the merge on the item page, the owner picks which images to use, can crop/zoom each one in the app (or upload their own), and presses an **Optimize** button.
- Optimize produces a **JPEG** and shows a preview with its dimensions and file size. Any later change to the crop makes the preview out of date; sending is blocked until Optimize is run again.
- The owner's own uploads go through the same optimizer.
- Optimization must happen **before** anything reaches Square. It can run at send time rather than ahead of time.

Proposed design (pending approval):
- Original ISBNdb image, optimized version, and any owner-uploaded version are kept in a local images folder (git-ignored, covered by backups), referenced from the merged JSON. The original is never overwritten.
- One shared optimize step (e.g. the `sharp` library on the Nuxt server) used for both the ISBNdb image and the owner's re-upload. The page shows a preview of exactly what will be sent.
- **Decided (owner, replaces the earlier 2000x2000 PNG decision):** the image that goes to Square is a **square JPEG at about 85-90% quality**, **longest side between 1200 and 2000 px**, **file size 150-500 KB** (never megabytes). Non-square covers are placed on a **white** background to make them square (JPEG has no transparency); the owner chose white because it is more performant. The owner can crop/zoom in the app; the app never crops on its own.
- Square's own guidance (from docs pasted by the owner): aspect ratio 1:1, JPG/PNG/GIF supported, up to 15 MB. The output above meets it.
- Optimize (server side, `sharp`, run on the original image, not a preview): square canvas sized to the cover's own height (capped at 2000, at least 1200, so nothing is enlarged), JPEG quality starting around 90 and lowered toward 85 and then the canvas toward 1200 only if the file is over 500 KB. Metadata stripped. The app flags results it cannot get under 500 KB, and results under 150 KB (possible low-quality source, such as ISBNdb's 334x500 thumbnail).
- The image URL arrives as part of the ISBNdb batch response, so there is no separate ISBNdb API call to get it.
- ISBNdb image URLs **expire after about 2 hours**. So the app downloads and saves the image files to the local images folder **immediately after each ISBNdb batch response**, and the JSON records the local file path alongside the (expiring) URL. After that, nothing depends on the URL. Which image version(s) to save depends on what the response actually contains (to confirm in Phase 2). Download failures are recorded per book and retried right away; if the URL has already expired, a fresh URL requires re-fetching that ISBN from ISBNdb (which costs quota). To verify: whether fetching the image URL has its own limits.
- Images change the item's image reference in Square, so image becomes one more allowlisted field in the single-item update, alongside title, description, and categories (not weight; see row 4).

Decided: image set is managed by the owner on the detail page.
- The detail page shows **all** images: the item's current Square images and the ISBNdb candidate.
- The owner manually removes any image and can add/upload others. **The final set shown on the page is exactly what is saved to Square**, including removals, and it appears in the before/after diff before the update button is pressed.
- Nothing is removed or added automatically.

Open questions:
- **Decided: removing an image deletes the image object from Square entirely** (owner: there is no reason for it to exist). This is irreversible in Square.
- Proposed safeguards (pending approval):
  - Before the update, check whether any other Square item uses that image and show a warning in the diff. **Decided: the one-time Square pull is a full pull** (all items' image references, not only books); non-book items are used for this check only and are otherwise ignored and never modified.
  - Save a local copy of every image before deleting it, so it can be re-uploaded if needed.
  - The delete is part of the same explicit single-item update; it is never run on its own or in bulk.
  - Order of operations (add/upload first, then item update, then delete) so a failure midway never leaves the book without an image.
- Whether Square's image upload can overwrite an existing image in place or needs a new image object attached to the item (to verify in docs).
- Whether the image upload and the item update are two separate Square calls; if one succeeds and the other fails, `wasUpdated` must stay `false` and the state must be shown clearly.

## ISBNdb usage design (proposed, pending approval)

- Source: ISBNdb's batch endpoint (from the docs the owner pasted). Basic plan allows up to **100 ISBNs per request**; over the limit returns a 400.
- **Quota is charged per ISBN, not per request**: a 100-ISBN request deducts 100 from the 5,000 daily limit. Batching saves requests and rate-limit time, not quota. Duplicates are collapsed and unusable ISBNs discarded before charging; the response's `requested` field is the amount actually deducted.
- So the practical cap is **5,000 ISBNs/day**; at 100 per batch that is ~50 requests, far under the 1/sec limit. Still throttle to stay under 1 request/second.
- **Not-found ISBNs are silently omitted** from the response. "No match" is therefore computed by us: a requested ISBN with no corresponding book in the response. Matching must compare normalized ISBNs (a request by ISBN-10 may come back with an ISBN-13), so the Square-to-response link needs care.
- Pricing is not returned by this endpoint (fine; price is never touched).
- The fetch is resumable: each batch's response is saved to the JSON as it arrives, and already-fetched ISBNs (including confirmed "No match" ones) are never requested again, so a crash or daily-cap stop loses nothing.
- Cache by ISBN so re-runs and reviews cost zero quota.
- If the catalog has more than ~5,000 ISBN items, the fetch spans multiple days; the 7-day trial gives a window to do the bulk of it.
- Response fields do not appear to vary by plan per the docs (owner checked). Which fields a book object contains (e.g. image, synopsis, weight/dimensions) is still to be confirmed from a real response in Phase 2, and may vary per book.
- Free trial and billing are the owner's to manage; the app never handles billing.

## Proposed Phases (pending approval)

0. **Setup** — project skeleton, `.gitignore`, `.env.example`, decide stack.
1. **Square read-only** — fetch items, inspect shape of the data.
2. **ISBNdb lookup** — query by ISBN for a handful of items, inspect responses, then run all and save to local JSON linked to Square IDs.
3. **Dashboard + detail UI** — list of books by Square title; detail page with original vs. ISBNdb data, merge helpers, and editing (no writes yet).
4. **Square write** — single-item update behind the "Yes!" button, with diff and version check.
5. **Hardening** — error handling, rate limits, logging, progress tracking.

## Status

- [x] Project folder created
- [x] This document drafted
- [x] Stack decided: Nuxt + TypeScript (latest stable, version to confirm at setup)
- [ ] Owner reviews and answers open decisions
- [x] Phase 0 setup built (git init, .gitignore, .env.example, Nuxt 4.6.2 + TS, pnpm 12.15.0, env banner placeholder); awaiting owner review. Open: pnpm blocked esbuild's build script (dev server runs fine without it)
