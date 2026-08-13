# HANDOFF — ComputeX

Last updated: 2026-08-13

---

## 1. The goal

Ship **ComputeX** — a pay-per-compute GPU marketplace where a workload is priced per job and
paid in USDC on Algorand Testnet via the x402 protocol — as a working hackathon demo.
GPU execution is simulated; **payment is real and verifiable on-chain**.

---

## 2. Current state

**The payment path is proven, on both the script path and the browser path.** Full re-verification
run on 2026-08-13 after restarting the server with fresh env.

```
test:flow          tx JMPNYDYAT2FQGBRMJXLSFAJZZJ7QHFBEESVGVAWFZQUJCVZSCDEA  round 66265613
pay-and-compute    tx GY4XDLWU4Y5P5CADEHRWDDHUDRS2J3KOHTLUMGKFISGOEJHFS55A
both: 0.06 USDC (ASA 10458941) -> payee, settled; test:flow's confirmed via the indexer
explorer: https://lora.algokit.io/testnet/transaction/JMPNYDYAT2FQGBRMJXLSFAJZZJ7QHFBEESVGVAWFZQUJCVZSCDEA
```

### Verified working (this session)

| Area | Status |
|---|---|
| 402 → sign → verify → settle → tx id → indexer confirm (`test:flow`) | All checks passed |
| `/api/pay-and-compute` NDJSON stream (the path the UI uses) | Settled, all 4 stages emitted |
| `typecheck` (server + client) | Clean, exit 0 |
| `scenarios`, `simulate` (offline suites) | Passing |
| `check:payer` | READY |
| Free endpoints: health, catalog, providers, stats, jobs, quote, recommend, agent/parse | All 200 / `success: true` |
| Spend guard at the new limit | $33.60 job refused, message names the `$5.00` ceiling |
| `vite build` | 25 modules, 233 KB JS / 32.9 KB CSS, ~240 ms |
| Server serves the built UI on `/` (single-service mode) | 200 text/html |
| Vite dev on 5173 + `/api` proxy to 4021 | Both 200 |
| Job history / stats / provider revenue accumulate across jobs | 3 completed, 3 settled, $0.288 total |
| Live GPU availability (new this session) | RTX 4090 6/8 → 5/8 during a job → 6/8 after; 4 concurrent jobs flip the L40S to `0/4 busy`, then back |
| Both Testnet accounts funded + opted into USDC | Done |
| Repo in sync | `main` @ `beb6b0a`, only `HANDOFF.md` untracked |

### Accounts (Algorand Testnet)

```
PAYER  R43BDWY7Q34Y7FJ2QGHNRC2ZBYARO5NEZZTUOB6EE7NKUXKLZ4QVQOF3DU   0.499 ALGO / 19.652 USDC
PAYEE  45PDOOTC7OWODAPBYUF46XS3AN7HY7AO3BCSATCZWZF64AJQQRQUQ365TQ   0.499 ALGO /  0.348 USDC
```

At demo prices (~$0.06/job) the payer balance is good for hundreds of runs.

### Open

- **Job history resets on restart** — the store is in-memory ([server/src/compute.ts](server/src/compute.ts) line 66).
  Restarting the server empties Jobs, Stats and session revenue. Run one job to repopulate before demoing.
- **`.env` is gitignored**, so the guard overrides below exist *only on this machine*. A fresh clone
  gets the code defaults (`0.50` / `10`) and will hit the refusal trap again.
- **The demo depends on a third-party facilitator** (`facilitator.goplausible.xyz`) and AlgoNode.
  There is no offline mode — capture a fallback screenshot/tx id before demo day.
- Stale duplicate of the project at `C:\Users\Soham\computex` — 5+ commits behind, should be deleted.
- Nothing built yet from the "stand out" ideas (autonomous agent loop, payee balance ticker,
  402 protocol inspector, wallet signing).
- Not verified by machine: the React UI actually *rendering* (no browser driver here). Everything it
  calls is verified at the HTTP level, and the bundle typechecks and builds. Click through it once by hand.

---

## 3. Active files

| File | Why it matters |
|---|---|
| [.env](.env) | Secrets + guard overrides. Gitignored. Not in the repo. |
| [server/src/env.ts](server/src/env.ts) | All config defaults, testnet constants, USDC ASA id, explorer URLs |
| [server/src/x402-server.ts](server/src/x402-server.ts) | The real payment path — dynamic 402 pricing, facilitator discovery, settlement injection |
| [server/src/pricing.ts](server/src/pricing.ts) | `cost = basePrice × priceFactor × units`. Drives both the 402 and the recommendation |
| [server/src/providers.ts](server/src/providers.ts) | The mock GPU catalog (3 GPUs, invented operators/revenue) |
| [server/src/compute.ts](server/src/compute.ts) | Simulated execution + in-memory job store |
| [server/src/guard.ts](server/src/guard.ts) | Shared-payer spend cap and rate limit |
| [server/scripts/check-payer.ts](server/scripts/check-payer.ts) | READY/NOT READY gate — run this first when anything looks wrong |
| [server/scripts/test-flow.ts](server/scripts/test-flow.ts) | The end-to-end proof, verifies tx against the indexer |
| [README.md](README.md) | Full setup/run/deploy docs |

---

## 4. De-hardcoding: what changed and what is left

**Done — GPU availability is now live.** It used to be a frozen constant: `PROVIDERS` in
[server/src/providers.ts](server/src/providers.ts) was a `const`, nothing mutated it, so `idleUnits: 6`
stayed 6 no matter how many jobs ran. Worse, availability is a **weighted scoring dimension** in
[server/src/recommend.ts](server/src/recommend.ts) (0.10–0.15 by priority), so one of the four ranking
signals could never affect a recommendation.

Now an `inUse` map tracks units held by running jobs; `listProviders()`/`getProvider()` return the
baseline minus that. [server/src/compute.ts](server/src/compute.ts) takes a unit via `reserveUnit()`
and releases it in a `finally`, so a throw mid-job cannot leak capacity. Reservation is deliberately
**not** a gate — the caller has already paid, and refusing work over fictional capacity would cancel a
verified payment. Occupancy past the baseline is allowed and the display clamps at `0 idle / busy`.

Every consumer (marketplace, stats, recommendation, quote snapshot) reads through those two functions,
so nothing else needed changing.

### Still hardcoded, deliberately

- **Protocol constants** — testnet CAIP-2 id, USDC ASA `10458941`, explorer URLs in
  [server/src/env.ts](server/src/env.ts). Network facts, not config.
- **The rate card** — `basePriceUsd`, `priceFactor`, `secondsPerUnit` in
  [server/src/pricing.ts](server/src/pricing.ts). A product decision; every marketplace posts prices.
- **The Agent Mode regex parser** ([server/src/agent.ts](server/src/agent.ts)). Keep it. On stage,
  deterministic beats smart: no API key, no latency, no nondeterminism, and it is what produces the
  per-field provenance trail the UI shows. An LLM would lose that.

### Still hardcoded, worth fixing

- **`baselineJobsCompleted: 1284` / `baselineRevenueUsd: 142.37`** are invented, and
  [server/src/index.ts](server/src/index.ts) adds *real* session revenue on top — so the Providers page
  blends fabricated history with genuine settlement. Either label the split in the UI or drop the baselines.
- **In-memory job store** — see Open, above.

---

## 5. Changes made in the earlier session

1. **Moved the project.** Copied `C:\Users\Soham\computex` → `D:\SOHAM ALL\hackathons\Algoverse`
   (144 files, `node_modules` excluded). The original was left in place and is now stale.
2. **Joined git histories.** The destination had an empty repo; the GitHub remote had an
   auto-generated initial commit. Merged with `--allow-unrelated-histories` (commit `cf6dc16`)
   and pushed. The remote's stub commit was preserved, not overwritten.
3. **README** restored to the full 10 KB version and extended (commit `fdac0d7`) with: prerequisites,
   root `npm run setup`, strict funding order, the payee-opt-in warning, and how to read
   `check:payer` output.
4. **Installed dependencies** — `npm run setup` (both packages).
5. **Opted both accounts into USDC** — `npm run optin`:
   - payer `L5AV7W5WBWP2QO7UDFTFEYHAEREJ3QWBYVLB6IFKSSBSNPRNPVLQ`
   - payee `UQ5AU74JUYR2VDTU6PIVUBZYAU2D3P43YFKKULTYIXGCLIRWREFA`
6. **Ran `test:flow`** — passed, producing the settlement above.
7. **Raised the spend guard in `.env`** (appended; the keys were absent, so code defaults applied):
   ```
   MAX_JOB_PRICE_USDC=5.00      # was defaulting to 0.50
   RATE_LIMIT_MAX_JOBS=100      # was defaulting to 10
   ```
   **Why:** at `0.50`, five of six realistic demo prompts were refused — video upscale 30s ($0.84),
   fine-tune 10 blocks ($0.96), fine-tune 3 blocks on A100 ($0.5040), 50 images on A100 ($1.05),
   1000 tokens on A100 ($0.56). Only the README's 5-SDXL-image demo ($0.06) fit under the cap.
   **Restore `0.50` / `10` before deploying publicly** — on a public URL the shared payer is an
   open faucet on the wallet.
8. **Pulled `beb6b0a`** (client UI/styling only, 6 files). Typecheck and build verified after.

---

## 6. Failed attempts — do not repeat

1. **`git push --force` was blocked by the permission classifier.** Do not retry it. The working
   approach was `git merge origin/main --allow-unrelated-histories`, which needs no force and
   discards nothing.
2. **`git show <ref>:README.md > README.md` in PowerShell corrupts the file** — redirection
   re-encodes it (8020 bytes instead of 10425). Use `git checkout <ref> -- README.md` instead,
   which writes through git and preserves bytes exactly.
3. **`ad55b13` is the *first* commit, not the latest.** Its README is the short 8 KB version.
   The full 10 KB README is at `c1f2126`.
4. **`git checkout --ours/--theirs <file>` is a no-op after `git add <file>`** — staging collapses
   the conflict stages and the command reports "Updated 0 paths". Resolve *before* staging, or
   pull the version explicitly with `git checkout <ref> -- <file>`.
5. **The original UI failure** — `402 — asset 10458941 missing from R43BDW…` — meant the payer was
   not opted into USDC, not that payment was broken. `npm run check:payer` diagnoses this class of
   error instantly; run it before debugging anything else.
6. **Background dev servers do not survive between sessions.** A run that worked earlier will fail
   with "Unable to connect" later. Restart with `npm --prefix server run dev` and re-check.
7. **The Circle faucet must come *after* the opt-in** — an Algorand account cannot receive an ASA
   before opting in. Opt-in also requires ALGO first, since it is itself a transaction.
8. **API field names, when hand-testing with curl.** `/api/agent/parse` takes `input`, not `prompt`
   (`prompt` returns "`input` must be a non-empty string"). Workload unit fields come from
   `/api/catalog` → `unitField`: `images`, `tokens`, `seconds`, `steps` — fine-tune is **`steps`**,
   not `blocks`. An unrecognised key silently falls back to 1 unit, so the job quotes and *pays* far
   less than intended instead of erroring.

---

## 7. Next steps

**Immediately:**
1. ~~Restart the server so the new guard limits take effect.~~ Done — old process killed, restarted
   with `npm --prefix server run start`, `$5.00` ceiling confirmed live.
2. ~~Confirm the browser payment path settles.~~ Done — `/api/pay-and-compute` settled tx
   `GY4XDLWU4Y5P5CADEHRWDDHUDRS2J3KOHTLUMGKFISGOEJHFS55A`. Still worth one manual click-through of
   Agent Mode to see the state machine animate.
3. Save a successful tx id + explorer screenshot as a **demo-day fallback** — the facilitator is a
   third party with no offline mode.

**Before the hackathon:**
- Rehearse the exact demo prompt end-to-end.
- Decide whether to build any differentiator. Highest impact for the effort: an **autonomous agent
  loop** (agent reads the price out of the 402 body, decides against a budget, pays, repeats — this
  is the whole point of x402), plus a **live payee balance ticker**.

**Before any public deploy:**
- Restore `MAX_JOB_PRICE_USDC=0.50` and `RATE_LIMIT_MAX_JOBS=10`.
- Move secrets to host env vars; `.env` never ships.
- Must run as a long-lived server, **not serverless** — job store, event bus and progress stream
  are all in-process.
