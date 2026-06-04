# CHANGELOG — Threads of Continuity Digital Tracker

## v0.8.0 - 2026-06-04
### Formula
- Changed when/how the app references the current total and total usage of resources so that coefficients are updated correctly based on correct data.

## UI Improvements
- Adjusted the left-side panel to be wider to better accomodate the player cards.
- Made player cards easier to navigate and read.
- Removed the coefficient dropdown in the upper-right in favor of a smaller list of all coefficients that are always visible, but small enough to not clutter the page.

---

## v0.7.1 — 2026-06-03
### Balance & Formula
- **Base drag** in weaving: `baseDrag = 0.5 + (RC / 100)` — no free weaves at 0 DR + 0 QR
- **wr1** "Reduce RC by 5" cost: 10 SN → **15 ToC**
- **PN upgrade costs**: creation cost minus 1 of each resource
- **Coefficients persist** from previous round (no reset to base on 0 usage)
- **RC formula**: R^1.5 per round

### Gameplay
- **Actions + Weave** in same Weaving Phase
- **PN resources auto-collect** on entering Resource Collection
- **Monopoly streak auto-computes** at round start — manual button removed

### Fixes
- **Usage % now correct**: Possible usage baseline set at round start from starting resources, then freshly snapshot at each round boundary for the next round. Initial baseline set in startGame from starting resources (5 ToC, 2 DR, 1 SN, 0 TB, 2 QR per player). This eliminates both the >100% bug AND the "everything shows 100%" bug.
- **Action affordability**: Cumulative cost check (costs only, no projected gains)
- **Sabotage UI**: "Pay With" section replaced with flat "Cost: 3 DR"
- **Usage display**: Capped at 100%
- **Coefficient explanations**: Neutral directional language
- **Coefficient arrows**: DR/QR inverted display (green ▲ = penalty weakening)

---

## v0.7.0 — 2026-06-03
### Resource Identity Rework
- **ToC** = flexible conversion currency (2→DR, 3→SN, 5→TB, 1→QR)
- **SN** = primary PN building currency
  - ToC: 2 SN + 3 ToC | DR: 3 SN + 4 DR | TB: 3 SN + 2 TB | SN: 6 SN | QR: 2 SN + 4 QR
- **DR** = exclusive aggression currency
- **QR Node** added | **SN Node** retained (6 SN)
- **TB** = rare premium weaving resource

### Actions Overhaul
- Removed Resource Gain actions; added 4 ToC conversions
- "Protect SN" → "Insure PNs 2 rounds" (15 ToC)
- pi1: 5 DR | sa2: 10 DR | wr2: 50% WS reduction (persistent)

### Coefficients & Inflation
- TB (α) 1.4 | SN (β) 1.1 | QR (ε) 1.15
- Thresholds: ToC 30, TB 20, QR 45, DR 25, SN 20

### Bug Fixes (from v0.6.x)
- Actual spend tracking, coefficient fallback, RC ≥100 game over
- Single skip button, reconciliation lockout, applyActions crash fix

### Removed
- AI Rules Arbiter + AI Chronicle + "discard hand" language

---

## v0.6.1 — 2026-06-03
- Accounting fixes, crash fix

## v0.6.0 — 2026-06-02
- Phase 1 rewrite: turn engine, skip turns, round intro, GRCP sandbox
