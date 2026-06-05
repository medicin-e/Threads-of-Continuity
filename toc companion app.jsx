import { useState, useCallback, useEffect } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const RESOURCE_COLORS = {
  ToC: "#4ade80",
  DR: "#f87171",
  TB: "#a78bfa",
  SN: "#60a5fa",
  QR: "#fbbf24",
};

const PN_TYPES = ["ToC", "DR", "TB", "SN", "QR"];

const PN_CREATION_COST = {
  ToC: { SN: 2, ToC: 3 },
  DR: { SN: 3, DR: 4 },
  TB: { SN: 3, TB: 2 },
  SN: { SN: 6 },
  QR: { SN: 2, QR: 4 },
};

const PN_UPGRADE_COSTS = {
  ToC: [null, { SN: 1, ToC: 2 }, { SN: 1, ToC: 2 }, { SN: 1, ToC: 2 }],
  DR:  [null, { SN: 2, DR: 3 },  { SN: 2, DR: 3 },  { SN: 2, DR: 3 }],
  TB:  [null, { SN: 2, TB: 1 },  { SN: 2, TB: 1 },  { SN: 2, TB: 1 }],
  SN:  [null, { SN: 5 },         { SN: 5 },          { SN: 5 }],
  QR:  [null, { SN: 1, QR: 3 },  { SN: 1, QR: 3 },  { SN: 1, QR: 3 }],
};
function getUpgradeCost(type, currentLevel) {
  const idx = currentLevel; // cost to go from level N to N+1 is at index N
  const costs = PN_UPGRADE_COSTS[type];
  return costs && idx < costs.length ? costs[idx] : null;
}

const INFLATION_THRESHOLDS = { ToC: 30, TB: 20, QR: 45, DR: 25, SN: 20 };

const PHASES = [
  "Preliminary",
  "Resource Collection",
  "Merging",
  "Weaving",
  "Reconciliation",
  "Ending",
];

const PHASE_DESCRIPTIONS = {
  Preliminary: "Calculate Reality Constant and Weaving Coefficients for this round.",
  "Resource Collection": "Collect PN resources, then roll 2d6 for additional resources.",
  Merging: "Buy PNs, trade, form alliances, exchange resources.",
  Weaving: "Choose 3 actions. Attempt to weave a Tapestry of Reality.",
  Reconciliation: "Resolve penalties: DR→QR conversion, unstable timeline checks.",
  Ending: "Verify resources and update inflation tracker.",
};

// Each action: cost = resources deducted from self, effect = applied to self
const WEAVING_ACTIONS = [
  { id: "rm1", label: "Lower QR by 1", desc: "Spend 3 ToC (or alt: 2 SN)", category: "Resource Manipulation",
    cost: { ToC: 3 }, altCost: { SN: 2 }, effect: { QR: -1 } },
  { id: "rm2", label: "Lower DR by 1", desc: "Spend 2 ToC (or alt: 1 SN)", category: "Resource Manipulation",
    cost: { ToC: 2 }, altCost: { SN: 1 }, effect: { DR: -1 } },
  { id: "cv1", label: "Convert 2 ToC → 1 DR", desc: "Spend 2 ToC", category: "Conversions",
    cost: { ToC: 2 }, effect: { DR: 1 } },
  { id: "cv2", label: "Convert 3 ToC → 1 SN", desc: "Spend 3 ToC", category: "Conversions",
    cost: { ToC: 3 }, effect: { SN: 1 } },
  { id: "cv3", label: "Convert 5 ToC → 1 TB", desc: "Spend 5 ToC", category: "Conversions",
    cost: { ToC: 5 }, effect: { TB: 1 } },
  { id: "cv4", label: "Convert 1 ToC → 1 QR", desc: "Spend 1 ToC", category: "Conversions",
    cost: { ToC: 1 }, effect: { QR: 1 } },
  { id: "pi1", label: "Force opponent to lose 1 SN", desc: "Spend 5 DR", category: "Player Interaction",
    cost: { DR: 5 }, effect: {}, social: "Apply -1 SN to chosen opponent manually." },
  { id: "pi2", label: "Insure your PNs for 2 rounds", desc: "Spend 15 ToC", category: "Player Interaction",
    cost: { ToC: 15 }, effect: {}, social: "Your PNs are protected from sabotage for 2 rounds. Track manually." },
  { id: "pi3", label: "Force opponent to lose 1 PN", desc: "Spend 10 DR", category: "Player Interaction",
    cost: { DR: 10 }, effect: {}, social: "Remove 1 PN from chosen opponent manually." },
  { id: "pi4", label: "Force opponent to discard 2 resources", desc: "Spend 7 DR", category: "Player Interaction",
    cost: { DR: 7 }, effect: {}, social: "Chosen opponent discards 2 resources of their choice." },
  { id: "sa1", label: "Trigger Ethereal Chaos Event", desc: "Spend 15 QR (skip next turn)", category: "Special Actions",
    cost: { QR: 15 }, effect: { skipNextTurn: true }, social: "ECE triggered — resolve during Reconciliation." },
  { id: "sa2", label: "Force RC +3", desc: "Spend 10 DR", category: "Special Actions",
    cost: { DR: 10 }, effect: {}, rcDelta: 3 },
  { id: "wr1", label: "Reduce RC by 5", desc: "Spend 15 ToC", category: "Weaving-Related",
    cost: { ToC: 15 }, effect: {}, rcDelta: -5 },
  { id: "wr2", label: "Halve opponent’s next Weaving Score", desc: "Spend 10 DR", category: "Weaving-Related",
    cost: { DR: 10 }, effect: {}, social: "Choose target — their WS will be halved (50%) on their next weave attempt. Persists across rounds. Apply manually." },
];

// ─── UTILS ────────────────────────────────────────────────────────────────────
const rollDie = (sides) => Math.floor(Math.random() * sides) + 1;
const roll2d6 = () => ({ d1: rollDie(6), d2: rollDie(6) });
const rollD100 = () => rollDie(100);

function calcRC(baseRC, round) {
  return baseRC + Math.pow(round, 1.5);
}

function calcToRST(rc) {
  return 1.5 * Math.log(rc + 1);
}

function calcWS(resources, coefficients, rc) {
  const { ToC, TB, SN, DR, QR } = resources;
  const { alpha, beta, gamma, delta, epsilon } = coefficients;
  const baseDrag = 0.5 + ((rc || 0) / 100);
  const denom = delta * DR + epsilon * QR + baseDrag;
  return (alpha * TB + beta * SN + gamma * ToC) / denom;
}

function calcPT(ws, torst) {
  return Math.min(100, Math.ceil(1.5 * (ws / torst) * 100));
}

function getInflationTier(resource, totalProduction) {
  const threshold = INFLATION_THRESHOLDS[resource] || 30;
  if (totalProduction <= threshold) return "Stable";
  if (totalProduction <= threshold * 1.5) return "Moderate";
  if (totalProduction <= threshold * 2) return "High";
  return "Severe";
}

function getInflationEfficiency(tier) {
  return { Stable: 1, Moderate: 0.9, High: 0.75, Severe: 0.5 }[tier] || 1;
}

// ─── INITIAL STATE ────────────────────────────────────────────────────────────
function createPlayer(name, id) {
  return {
    id,
    name,
    ToC: 5,
    DR: 2,
    SN: 1,
    QR: 2,
    TB: 0,
    tor: 0,
    pns: [],
    skipNextTurn: false,
    wsDebuff: 0,
    monopolyRounds: 0,
  };
}

function initialState() {
  return {
    players: [],
    numPlayers: 0,
    setup: false,
    gameMode: "Standard",
    round: 1,
    baseRC: 10,
    rc: 10,
    currentPlayerIdx: 0,
    currentPhase: 0,
    gameLog: [],
    coefficients: { alpha: 1.4, beta: 1.1, gamma: 1.0, delta: 1.1, epsilon: 1.15 },
    prevResourceUsage: {},
    prevCoefficients: null,
    prevUsagePct: {},
    prevPossibleUsage: {},
    inflationData: {},
    diceResult: null,
    weavingCalc: null,
    ecePending: false,
    winner: null,
    winType: null,
    view: "setup",
  };
}

// ─── COMPONENTS ───────────────────────────────────────────────────────────────

function Tag({ children, color }) {
  return (
    <span style={{
      background: color + "22",
      border: `1px solid ${color}44`,
      color,
      borderRadius: 4,
      padding: "1px 7px",
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 1,
      textTransform: "uppercase",
    }}>{children}</span>
  );
}

function ResourcePip({ type, value, onChange, mini }) {
  const color = RESOURCE_COLORS[type] || "#aaa";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: mini ? 6 : 8 }}>
      <span style={{ color, fontWeight: 700, fontSize: mini ? 11 : 13, minWidth: 28 }}>{type}</span>
      {onChange ? (
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <button onClick={() => onChange(type, -1)} style={btnSmStyle("#333", "#666")}>−</button>
          <span style={{ color: "#eee", fontWeight: 700, minWidth: 30, textAlign: "center", fontSize: mini ? 13 : 16 }}>{value}</span>
          <button onClick={() => onChange(type, 1)} style={btnSmStyle("#333", "#666")}>+</button>
        </div>
      ) : (
        <span style={{ color: "#eee", fontWeight: 700, fontSize: mini ? 13 : 16 }}>{value}</span>
      )}
    </div>
  );
}

const btnSmStyle = (bg, border) => ({
  background: bg,
  border: `1px solid ${border}`,
  color: "#ccc",
  borderRadius: 3,
  width: 28,
  height: 28,
  cursor: "pointer",
  fontSize: 14,
  lineHeight: "20px",
  padding: 0,
});

function LogEntry({ entry }) {
  const icons = { info: "◈", roll: "⬡", weave: "✦", event: "⚠", win: "★" };
  const colors = { info: "#60a5fa", roll: "#fbbf24", weave: "#a78bfa", event: "#f87171", win: "#4ade80" };
  const type = entry.type || "info";
  return (
    <div style={{
      display: "flex", gap: 8, alignItems: "flex-start",
      padding: "5px 0", borderBottom: "1px solid #1e2535",
    }}>
      <span style={{ color: colors[type], fontSize: 12, marginTop: 2 }}>{icons[type]}</span>
      <span style={{ color: "#94a3b8", fontSize: 12 }}>{entry.msg}</span>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [state, setState] = useState(initialState());
  const [setupNames, setSetupNames] = useState(["", "", "", "", ""]);
  const [setupCount, setSetupCount] = useState(3);
  const [setupMode, setSetupMode] = useState("Standard");
  const [weavingInputs, setWeavingInputs] = useState({ ToC: 0, TB: 0, SN: 0 });
  const [weavingMode, setWeavingMode] = useState(null); // null | "actions" | "weave"
  const [actionsSelected, setActionsSelected] = useState([]);
  const [actionsApplied, setActionsApplied] = useState(false);
  const [pnBuyType, setPnBuyType] = useState("ToC");
  const [rcAdjust, setRcAdjust] = useState(0);

  const log = useCallback((msg, type = "info") => {
    setState(s => ({ ...s, gameLog: [{ msg, type, id: Date.now() + Math.random() }, ...s.gameLog].slice(0, 60) }));
  }, []);

  // ── SETUP ──
  function startGame() {
    const names = setupNames.slice(0, setupCount).map((n, i) => n.trim() || `Player ${i + 1}`);
    const players = names.map((n, i) => createPlayer(n, i));
    const baseRC = { Casual: 5, Standard: 10, Hardcore: 15 }[setupMode];
    setState(s => ({
      ...initialState(),
      players,
      numPlayers: setupCount,
      setup: true,
      gameMode: setupMode,
      baseRC,
      rc: baseRC,
      view: "game",
      gameLog: [{ msg: "Game started! Determine turn order (see rules §1.2.1), then begin Round 1.", type: "info", id: 0 }],
      grcp: [], // list of {id, rule, change, reason, round}
      monopolyRoundsInControl: 0, // consecutive rounds at >=50% production
      monopolyLoggedThisRound: false,
      prevPossibleUsage: { ToC: setupCount * 5, DR: setupCount * 2, SN: setupCount * 1, TB: 0, QR: setupCount * 2 },
      pnCollected: false,
      diceRolled: false,
      reconciliationDone: false,
      coefficients: { alpha: 1.4, beta: 1.1, gamma: 1.0, delta: 1.1, epsilon: 1.15 },
    }));
  }

  // ── PLAYER RESOURCE CHANGE ──
  function changeResource(pid, res, delta) {
    // Track spending (negative delta) for coefficient and inflation calculations
    if (delta < 0) {
      setState(s => {
        const player = s.players.find(p => p.id === pid);
        const actualSpent = Math.min(Math.abs(delta), player?.[res] ?? 0);
        const prev = s.prevResourceUsage || {};
        return {
          ...s,
          prevResourceUsage: { ...prev, [res]: (prev[res]||0) + actualSpent },
          players: s.players.map(p =>
            p.id === pid ? { ...p, [res]: Math.max(0, (p[res] ?? 0) + delta) } : p
          ),
        };
      });
    } else {
      setState(s => ({
        ...s,
        players: s.players.map(p =>
          p.id === pid ? { ...p, [res]: Math.max(0, (p[res] ?? 0) + delta) } : p
        ),
      }));
    }
  }

  // ── ROLL 2D6 ──
  function doRoll2d6() {
    if (state.diceRolled) return;
    const { d1, d2 } = roll2d6();
    const sum = d1 + d2;
    let gain = "";
    if (sum <= 5) gain = "Gain 3 ToC";
    else if (sum <= 8) gain = "Gain 2 DR";
    else if (sum <= 10) gain = "Gain 2 SN";
    else gain = "Gain 1 TB";
    setState(s => ({ ...s, diceResult: { d1, d2, sum, gain, applied: false }, diceRolled: true }));
    log(`Rolled ${d1}+${d2}=${sum} → ${gain}`, "roll");
  }

  function applyRollToPlayer(pid) {
    if (!state.diceResult || state.diceResult.applied) return;
    const { sum } = state.diceResult;
    let res, amt;
    if (sum <= 5) { res = "ToC"; amt = 3; }
    else if (sum <= 8) { res = "DR"; amt = 2; }
    else if (sum <= 10) { res = "SN"; amt = 2; }
    else { res = "TB"; amt = 1; }
    changeResource(pid, res, amt);
    setState(s => ({ ...s, diceResult: { ...s.diceResult, applied: true } }));
    log(`${state.players.find(p => p.id === pid)?.name} gained ${amt} ${res} from dice roll.`, "roll");
  }

  // ── RECONCILIATION ──
  function doReconciliation(pid) {
    if (state.reconciliationDone) return;
    const p = state.players.find(x => x.id === pid);
    if (!p) return;
    let msgs = [];
    let patch = {};

    // DR → QR penalty (divisor can be changed by GRCP)
    const drQrDivisor = resolveRuleValue("reconcile:dr_qr_divisor", 5);
    const qrGain = Math.floor(p.DR / drQrDivisor);
    if (qrGain > 0) {
      patch.QR = p.QR + qrGain;
      msgs.push(`+${qrGain} QR (from ${p.DR} DR)`);
    }

    const newQR = (patch.QR ?? p.QR);
    const newDR = p.DR;

    // Unstable timeline
    const unstableThreshold = resolveRuleValue('reconcile:unstable_qr', 20);
    if (newQR >= unstableThreshold) {
      patch.QR = newQR - 5;
      patch.ToC = Math.max(0, p.ToC - 5);
      patch.skipNextTurn = true;
      msgs.push("⚠ UNSTABLE TIMELINE: Skip next turn, lose 5 QR, lose 5 ToC.");
    }

    // DR chaos rolls (automatic) — separate from voluntary QR ECE action
    const ece15Threshold = resolveRuleValue('reconcile:ece_dr_high', 15);
    const ece10Threshold = resolveRuleValue('reconcile:ece_dr_low', 10);
    if (newDR >= ece15Threshold) {
      const r = rollDie(6);
      msgs.push(`DR≥${ece15Threshold} → rolled d6: ${r}`);
      if (r === 1 || r === 5) {
        msgs.push("⚠ ETHEREAL CHAOS EVENT triggered by DR!");
        patch.ecePending = true;
      }
    } else if (newDR >= ece10Threshold) {
      const r = rollDie(6);
      msgs.push(`DR≥${ece10Threshold} → rolled d6: ${r}`);
      if (r === 5) {
        msgs.push("⚠ ETHEREAL CHAOS EVENT triggered by DR!");
        patch.ecePending = true;
      }
    } else if (newDR >= 10) {
      msgs.push(`DR is ${newDR} — watch out for chaos rolls above ${ece10Threshold}.`);
    }

    // QR graduated weaving penalty notification
    const playerQRFinal = (patch.QR ?? p.QR);
    let qrPenaltyNote = "";
    if (playerQRFinal >= 19) qrPenaltyNote = "QR 19+ → −20% weave penalty active";
    else if (playerQRFinal >= 16) qrPenaltyNote = `QR ${playerQRFinal} → −15% weave penalty active`;
    else if (playerQRFinal >= 13) qrPenaltyNote = `QR ${playerQRFinal} → −10% weave penalty active`;
    else if (playerQRFinal >= 10) qrPenaltyNote = `QR ${playerQRFinal} → −6% weave penalty active`;
    else if (playerQRFinal >= 7) qrPenaltyNote = `QR ${playerQRFinal} → −3% weave penalty active`;
    if (qrPenaltyNote) msgs.push("⚠ " + qrPenaltyNote);

    setState(s => ({
      ...s,
      reconciliationDone: true,
      players: s.players.map(p2 => p2.id === pid ? { ...p2, ...patch } : p2),
      ecePending: patch.ecePending || s.ecePending,
    }));
    log(`[${p.name}] Reconciliation: ${msgs.join(" | ") || "No penalties."}`, msgs.some(m => m.includes("⚠")) ? "event" : "info");
  }

  // ── WEAVING CALC ──
  function doWeavingCalc() {
    const p = state.players[state.currentPlayerIdx];
    // DR and QR come from the player's actual totals — not chosen inputs
    const fullInputs = { ...weavingInputs, DR: p?.DR ?? 0, QR: p?.QR ?? 0 };
    // Check player has enough of the boost resources
    const insufficient = ["ToC", "TB", "SN"].filter(
      res => weavingInputs[res] > (p?.[res] || 0)
    );
    if (insufficient.length > 0) {
      log(`Not enough resources to weave: insufficient ${insufficient.join(", ")}.`, "event");
      return;
    }
    const ws = calcWS(fullInputs, state.coefficients, state.rc);
    const torst = calcToRST(state.rc);
    let pt = calcPT(ws, torst);
    // QR graduated weave penalty (your design rule)
    const playerQR = p?.QR ?? 0;
    let qrPenalty = 0;
    let qrPenaltyLabel = "";
    if (playerQR >= 19)      { qrPenalty = 20; qrPenaltyLabel = "QR 19 (−20%)"; }
    else if (playerQR >= 16) { qrPenalty = 15; qrPenaltyLabel = `QR ${playerQR} (−15%)`; }
    else if (playerQR >= 13) { qrPenalty = 10; qrPenaltyLabel = `QR ${playerQR} (−10%)`; }
    else if (playerQR >= 10) { qrPenalty =  6; qrPenaltyLabel = `QR ${playerQR} (−6%)`; }
    else if (playerQR >= 7)  { qrPenalty =  3; qrPenaltyLabel = `QR ${playerQR} (−3%)`; }
    if (qrPenalty > 0) pt = Math.max(1, pt - qrPenalty);
    setState(s => ({ ...s, weavingCalc: { ws, torst, pt, inputs: { ...weavingInputs }, playerDR: p?.DR ?? 0, playerQR, qrPenalty, qrPenaltyLabel } }));
    log(`Weaving Calc: WS=${ws.toFixed(2)}, Threshold=${torst.toFixed(2)}, Success Chance=${pt.toFixed(1)}%`, "weave");
  }

  // ── GRCP COST RESOLVER ──
  // Reads structured GRCP overrides (grcp entries with a .overrides array).
  // Each override: { target: "action:sa1" | "pn:DR" | "reconcile:dr_qr_divisor", res: "DR", value: 1 }
  function resolveActionCost(action) {
    const overrides = state.grcp
      .filter(g => g.overrides)
      .flatMap(g => g.overrides)
      .filter(o => o.target === `action:${action.id}`);
    if (overrides.length === 0) return action.cost;
    // Build new cost from overrides; unspecified resources stay as original
    const newCost = { ...action.cost };
    overrides.forEach(o => {
      if (o.value === 0) delete newCost[o.res];
      else newCost[o.res] = o.value;
    });
    log(`⚑ GRCP override on "${action.label}": ${Object.entries(newCost).map(([r,v])=>`${v} ${r}`).join("+")}`, "event");
    return newCost;
  }

  // Resolve a numeric rule value (e.g. reconciliation DR threshold, PN creation costs)
  function resolveRuleValue(target, defaultValue) {
    const overrides = state.grcp
      .filter(g => g.overrides)
      .flatMap(g => g.overrides)
      .filter(o => o.target === target);
    if (overrides.length === 0) return defaultValue;
    return overrides[overrides.length - 1].value;
  }

  // ── APPLY ACTIONS ──
  function applyActions(pid) {
    const p = state.players.find(x => x.id === pid);
    if (!p || actionsSelected.length === 0) return;
    const actions = WEAVING_ACTIONS.filter(a => actionsSelected.includes(a.id));

    // Check affordability, respecting any GRCP cost overrides
    for (const a of actions) {
      const effectiveCost = resolveActionCost(a);
      for (const [res, amt] of Object.entries(effectiveCost)) {
        if ((p[res] || 0) < amt) {
          log(`Cannot afford "${a.label}" — need ${amt} ${res}, have ${p[res] || 0}.`, "event");
          return;
        }
      }
    }

    let rcDelta = 0;
    let patch = {};
    let msgs = [];
    let socialNotes = [];
    let eceTriggered = false;
    let totalSpent = {};

    for (const a of actions) {
      const effectiveCost = resolveActionCost(a);
      Object.entries(effectiveCost).forEach(([r, amt]) => { totalSpent[r] = (totalSpent[r] || 0) + amt; });
      // Deduct costs (using GRCP-resolved cost)
      for (const [res, amt] of Object.entries(effectiveCost)) {
        patch[res] = Math.max(0, (patch[res] ?? p[res] ?? 0) - amt);
      }
      // Apply effects
      for (const [res, amt] of Object.entries(a.effect || {})) {
        if (res === "skipNextTurn") { patch.skipNextTurn = true; }
        else {
          const cur = patch[res] ?? p[res] ?? 0;
          patch[res] = amt < 0 ? Math.max(0, cur + amt) : cur + amt;
        }
      }
      // Roll for extra on rg2
      if (a.rollForExtra) {
        const r = rollDie(6);
        if (r >= a.rollForExtra.threshold) {
          patch[a.rollForExtra.res] = (patch[a.rollForExtra.res] ?? p[a.rollForExtra.res] ?? 0) + 1;
          msgs.push(`${a.label}: rolled ${r} → bonus +1 ${a.rollForExtra.res}!`);
        } else {
          msgs.push(`${a.label}: rolled ${r} → no bonus.`);
        }
      }
      if (a.rcDelta) rcDelta += a.rcDelta;
      if (a.id === "sa1") eceTriggered = true;
      if (a.social) socialNotes.push(`⚑ ${a.label}: ${a.social}`);
      if (!a.rollForExtra) msgs.push(a.label);
    }

    setState(s => {
      const prev = s.prevResourceUsage || {};
      const updatedUsage = { ...prev };
      Object.entries(totalSpent).forEach(([r, a]) => { updatedUsage[r] = (updatedUsage[r] || 0) + a; });
      return {
        ...s,
        prevResourceUsage: updatedUsage,
        players: s.players.map(px => px.id === pid ? { ...px, ...patch } : px),
        rc: Math.max(0, s.rc + rcDelta),
        ecePending: s.ecePending || eceTriggered,
      };
    });
    setActionsApplied(true);
    if (eceTriggered) {
      log("⚠ ECE triggered via action! Go to the Reconciliation phase to resolve it.", "event");
    }
    log(`[${p.name}] Actions applied: ${msgs.join("; ")}${rcDelta !== 0 ? ` | RC ${rcDelta > 0 ? "+" : ""}${rcDelta}` : ""}`, "info");
    if (socialNotes.length > 0) {
      socialNotes.forEach(n => log(n, "event"));
    }
  }

  function rollWeave(pid) {
    if (!state.weavingCalc) return;
    const { pt, inputs } = state.weavingCalc;
    const roll = rollD100();
    const success = roll <= pt;
    const p = state.players.find(x => x.id === pid);
    if (!p) return;

    if (success) {
      const newTor = p.tor + 1;
      setState(s => {
        const prev = s.prevResourceUsage || {};
        const updatedUsage = { ...prev };
        ["ToC","TB","SN"].forEach(r => { if (inputs[r]) updatedUsage[r] = (updatedUsage[r] || 0) + inputs[r]; });
        const players = s.players.map(px =>
          px.id === pid ? {
            ...px,
            tor: newTor,
            ToC: Math.max(0, px.ToC - (inputs.ToC ?? 0)),
            TB: Math.max(0, px.TB - (inputs.TB ?? 0)),
            SN: Math.max(0, px.SN - (inputs.SN ?? 0)),
          } : px
        );
        const winner = newTor >= 3 ? pid : null;
        return { ...s, prevResourceUsage: updatedUsage, players, rc: s.rc - 2, winner, winType: winner ? 'tor' : s.winType };
      });
      log(`✦ ${p.name} rolled ${roll} ≤ ${pt.toFixed(0)}% — WEAVE SUCCEEDED! ToR: ${p.tor + 1}/3. RC -2.`, "win");
    } else {
      setState(s => {
        const prev = s.prevResourceUsage || {};
        const updatedUsage = { ...prev };
        ["ToC","TB","SN"].forEach(r => { if (inputs[r]) updatedUsage[r] = (updatedUsage[r] || 0) + inputs[r]; });
        return {
          ...s,
          prevResourceUsage: updatedUsage,
          players: s.players.map(px =>
            px.id === pid ? {
              ...px,
              ToC: Math.max(0, px.ToC - (inputs.ToC ?? 0)),
              TB: Math.max(0, px.TB - (inputs.TB ?? 0)),
              SN: Math.max(0, px.SN - (inputs.SN ?? 0)),
            } : px
          ),
          rc: s.rc + 1,
        };
      });
      log(`${p.name} rolled ${roll} > ${pt.toFixed(0)}% — weave FAILED. Resources lost. RC +1.`, "weave");
    }
    setState(s => ({ ...s, weavingCalc: null }));
  }

  // ── BUY PN ──
  function buyPN(pid) {
    const p = state.players.find(x => x.id === pid);
    if (!p) return;
    // PN creation cost can be overridden by GRCP
    const baseCost = PN_CREATION_COST[pnBuyType];
    const cost = Object.fromEntries(
      Object.entries(baseCost).map(([res, amt]) => [
        res,
        resolveRuleValue(`pn_create:${pnBuyType}:${res}`, amt)
      ])
    );
    let canAfford = true;
    for (const [res, amt] of Object.entries(cost)) {
      if ((p[res] || 0) < amt) { canAfford = false; break; }
    }
    if (!canAfford) { log(`${p.name} cannot afford a ${pnBuyType} Node.`, "event"); return; }
    setState(s => {
      const prev = s.prevResourceUsage || {};
      const updatedUsage = { ...prev };
      Object.entries(cost).forEach(([r, a]) => { updatedUsage[r] = (updatedUsage[r] || 0) + a; });
      return {
        ...s,
        prevResourceUsage: updatedUsage,
        players: s.players.map(px => {
          if (px.id !== pid) return px;
          let updated = { ...px, pns: [...px.pns, { type: pnBuyType, level: 1 }] };
          for (const [res, amt] of Object.entries(cost)) updated[res] = Math.max(0, updated[res] - amt);
          return updated;
        }),
      };
    });
    log(`${p.name} purchased a ${pnBuyType} Production Node.`, "info");
  }

  // ── SKIP TURN FOR QR REDUCTION ──
  
function resetTransientTurnUi() {
    setActionsSelected([]);
    setActionsApplied(false);
    setWeavingMode(null);
    setRcAdjust(0);
    setWeavingInputs({ ToC: 0, TB: 0, SN: 0 });
  }

  function buildRoundStartState(s) {
    const newRound = s.round + 1;
    const newRC = s.rc + Math.pow(newRound, 1.5) + rcAdjust;
    const baseCoeffsAuto = { alpha: 1.4, beta: 1.1, gamma: 1.0, delta: 1.1, epsilon: 1.15 };
    const coeffMap = [["alpha","TB"],["beta","SN"],["gamma","ToC"],["delta","DR"],["epsilon","QR"]];
    const autoUsage = s.prevResourceUsage || {};
    let autoPossible = s.prevPossibleUsage || {};
    // Fallback: if no Merging snapshots were accumulated (e.g. all skipped), compute from current resources
    const possibleHasData = Object.values(autoPossible).some(v => v > 0);
    if (!possibleHasData) {
      autoPossible = {};
      s.players.forEach(p => {
        ["ToC","DR","SN","TB","QR"].forEach(r => {
          autoPossible[r] = (autoPossible[r] || 0) + (p[r] || 0);
        });
      });
    }
    const newCoeffs = {};
    coeffMap.forEach(([coeff, res]) => {
      const used = autoUsage[res] || 0;
      const possible = autoPossible[res] || 0;
      const prevCoeff = s.coefficients?.[coeff] || baseCoeffsAuto[coeff];
      if (possible === 0) { newCoeffs[coeff] = prevCoeff; return; }
      const pct = used / possible;
      const sf = Math.pow(pct - 0.6, 2);
      newCoeffs[coeff] = pct > 0.5 ? Math.max(0.1, prevCoeff * (1 - sf)) : prevCoeff * (1 + sf);
    });
    // Snapshot current resources for next round possible usage
    const newPossible = {};
    s.players.forEach(p => {
      ["ToC","DR","SN","TB","QR"].forEach(r => {
        newPossible[r] = (newPossible[r] || 0) + (p[r] || 0);
      });
    });

    // Auto-compute monopoly streak
    const globalPNProd = s.players.reduce((sum, p) =>
      sum + (p.pns || []).reduce((s2, pn) => s2 + pn.level, 0), 0);
    let newMonopolyRounds = s.monopolyRoundsInControl || 0;
    if (globalPNProd > 0) {
      const shares = s.players.map(p => ({
        id: p.id,
        share: (p.pns || []).reduce((s2, pn) => s2 + pn.level, 0) / globalPNProd * 100,
      }));
      const sorted = [...shares].sort((a, b) => b.share - a.share);
      const leader = sorted[0] || {};
      const runnerUp = sorted[1] || {};
      newMonopolyRounds = (leader.share > 50 && leader.share > runnerUp.share) ? newMonopolyRounds + 1 : 0;
    } else {
      newMonopolyRounds = 0;
    }

    return {
      ...s,
      round: newRound,
      rc: newRC,
      prevPossibleUsage: newPossible,
      monopolyRoundsInControl: newMonopolyRounds,
      monopolyLoggedThisRound: true,
      coefficients: newCoeffs,
      prevCoefficients: s.coefficients,
      prevUsagePct: Object.fromEntries(coeffMap.map(([, res]) => {
        const used = autoUsage[res] || 0;
        const possible = autoPossible[res] || 0;
        return [res, possible > 0 ? Math.min(100, Math.round((used / possible) * 100)) : null];
      })),
      currentPhase: 0,
      diceResult: null,
      weavingCalc: null,
      monopolyLoggedThisRound: false,
      pnCollected: false,
      diceRolled: false,
      reconciliationDone: false,
      roundIntroSeen: false,
      prevResourceUsage: {},
    };
  }

  function advanceToNextTurnState(s) {
    let working = s;
    let idx = (s.currentPlayerIdx + 1) % s.numPlayers;
    if (idx === 0) {
      working = buildRoundStartState(working);
    }
    let guard = 0;
    while (guard < (working.numPlayers * 2)) {
      const candidate = working.players[idx];
      if (!candidate?.skipNextTurn) {
        return {
          ...working,
          currentPlayerIdx: idx,
          currentPhase: 0,
          diceResult: null,
          weavingCalc: null,
          pnCollected: false,
          diceRolled: false,
          reconciliationDone: false,
        };
      }
      working = {
        ...working,
        players: working.players.map((p, i) => i === idx ? { ...p, skipNextTurn: false } : p),
      };
      idx = (idx + 1) % working.numPlayers;
      if (idx === 0) {
        working = buildRoundStartState(working);
      }
      guard += 1;
    }
    return working;
  }

  function skipTurnForQR(pid) {
    const name = state.players.find(p => p.id === pid)?.name || "Player";
    setState(s => {
      const player = s.players.find(p => p.id === pid);
      const actualSpent = Math.min(player?.QR || 0, 10);
      const updatedPlayers = s.players.map(p =>
        p.id === pid ? { ...p, QR: Math.max(0, p.QR - 10) } : p
      );
      const usage = { ...(s.prevResourceUsage || {}), QR: (s.prevResourceUsage?.QR || 0) + actualSpent };
      return advanceToNextTurnState({ ...s, players: updatedPlayers, prevResourceUsage: usage });
    });
    resetTransientTurnUi();
    log(`${name} skipped their entire turn and reduced QR by 10.`, "info");
  }

  // ── UPGRADE PN ──
  // ── UPGRADE PN ──
  function upgradePN(pid, pnIdx) {
    const p = state.players.find(x => x.id === pid);
    if (!p) return;
    const pn = p.pns[pnIdx];
    if (!pn) return;
    const cost = getUpgradeCost(pn.type, pn.level);
    if (!cost) { log("Already at max upgrade level.", "event"); return; }
    for (const [res, amt] of Object.entries(cost)) {
      if ((p[res] || 0) < amt) { log(`Cannot afford upgrade: need ${amt} ${res}.`, "event"); return; }
    }
    setState(s => {
      const prev = s.prevResourceUsage || {};
      const updatedUsage = { ...prev };
      Object.entries(cost).forEach(([r, a]) => { updatedUsage[r] = (updatedUsage[r] || 0) + a; });
      return {
        ...s,
        prevResourceUsage: updatedUsage,
        players: s.players.map(px => {
          if (px.id !== pid) return px;
          let updated = {
            ...px,
            pns: px.pns.map((n, i) => i === pnIdx ? { ...n, level: n.level + 1 } : n),
          };
          for (const [res, amt] of Object.entries(cost)) updated[res] = Math.max(0, updated[res] - amt);
          return updated;
        }),
      };
    });
    log(`${p.name} upgraded ${pn.type} Node to Level ${pn.level + 1}.`, "info");
  }

  // ── SABOTAGE PN ──
  function sabotagePNRoll(attackerId, targetId, method) {
    const attacker = state.players.find(x => x.id === attackerId);
    const target = state.players.find(x => x.id === targetId);
    if (!attacker || !target) return;
    const cost = { DR: 3 }; // DR only
    for (const [res, amt] of Object.entries(cost)) {
      if ((attacker[res] || 0) < amt) { log(`Cannot afford sabotage: need ${amt} ${res}.`, "event"); return; }
    }
    const roll = rollDie(6);
    const success = roll % 2 === 0;
    setState(s => {
      const prev = s.prevResourceUsage || {};
      const updatedUsage = { ...prev };
      Object.entries(cost).forEach(([r, a]) => { updatedUsage[r] = (updatedUsage[r] || 0) + a; });
      return {
        ...s,
        prevResourceUsage: updatedUsage,
        players: s.players.map(px => {
          if (px.id === attackerId) {
            let u = { ...px };
            for (const [res, amt] of Object.entries(cost)) u[res] = Math.max(0, u[res] - amt);
            return u;
          }
          return px;
        }),
      };
    });
    log(`${attacker.name} sabotage roll: ${roll} → ${success ? "SUCCESS! Target PN halved for 1 round. Apply manually." : "FAILED. Cost still paid."}`, success ? "event" : "info");
  }

  // ── COLLECT PN RESOURCES ──
  function collectPNs(pid) {
    if (state.pnCollected) { log("Already collected PN resources this turn.", "event"); return; }
    const p = state.players.find(x => x.id === pid);
    if (!p || p.pns.length === 0) { log("No PNs to collect from."); return; }
    let totals = {};
    for (const pn of p.pns) {
      const base = pn.level;
      // Apply inflation
      const infl = getInflationTier(pn.type, state.inflationData?.[pn.type]?.total || 0);
      const eff = getInflationEfficiency(infl);
      const amount = Math.floor(base * eff);
      totals[pn.type] = (totals[pn.type] || 0) + amount;
    }
    setState(s => ({
      ...s,
      pnCollected: true,
      players: s.players.map(px => {
        if (px.id !== pid) return px;
        let updated = { ...px };
        for (const [res, amt] of Object.entries(totals)) updated[res] = (updated[res] ?? 0) + amt;
        return updated;
      }),
    }));
    log(`${p.name} collected PN resources: ${Object.entries(totals).map(([k, v]) => `+${v} ${k}`).join(", ")}`, "info");
  }

  // ── AUTO-COLLECT PN RESOURCES ──
  useEffect(() => {
    if (state.setup && PHASES[state.currentPhase] === "Resource Collection" && !state.pnCollected) {
      const cp = state.players[state.currentPlayerIdx];
      if (cp && cp.pns && cp.pns.length > 0) {
        collectPNs(cp.id);
      }
    }
  }, [state.currentPhase, state.currentPlayerIdx]);

  // ── ECE HANDLER ──
  // All ECEs: initiator forfeits next turn (your rule override, applies to all options)
  function resolveECE(pid, choice) {
    const p = state.players.find(x => x.id === pid);
    if (!p) return;

    if (choice === "flush") {
      // Rulebook: initiator loses all TB, SN, ToC; others +5 QR and -2 DR; RC+2 next round
      setState(s => ({
        ...s,
        players: s.players.map(px => {
          if (px.id === pid) return { ...px, TB: 0, SN: 0, ToC: 0, skipNextTurn: true };
          return { ...px, QR: px.QR + 5, DR: Math.max(0, px.DR - 2) };
        }),
        rc: s.rc + 2,
        ecePending: false,
      anrpPending: false,
      eceMitigated: false,
      fracture: null,
      roundIntroSeen: false,
      conflagrationRound: null,
      }));
      setState(s => ({ ...s, eceMitigated: false }));
      log(`${p.name}: Nebula Flush. Lost all TB/SN/ToC. Others +5 QR, -2 DR. RC +2. ${p.name} skips next turn.`, "event");

    } else if (choice === "reset") {
      // Your override: ALL players (including initiator) go to 0. RC +10. Initiator skips next turn.
      setState(s => ({
        ...s,
        players: s.players.map(px => ({
          ...px, ToC: 0, DR: 0, SN: 0, QR: 0, TB: 0, pns: [],
          skipNextTurn: px.id === pid ? true : px.skipNextTurn,
        })),
        rc: s.rc + 10,
        ecePending: false,
      }));
      log(`${p.name}: Nebula Reset. ALL players reset to 0. RC +10. ${p.name} skips next turn. Mutually assured destruction.`, "event");

    } else if (choice === "collapse") {
      // Rulebook: all players +15 QR, +10 DR, lose 50% TB (round down), lose all SN over 5; RC+5
      setState(s => ({
        ...s,
        players: s.players.map(px => ({
          ...px,
          QR: px.QR + 15,
          DR: px.DR + 10,
          TB: Math.floor(px.TB * 0.5),
          SN: Math.min(px.SN, 5),
          skipNextTurn: px.id === pid ? true : px.skipNextTurn,
        })),
        rc: s.rc + 5,
        ecePending: false,
      }));
      log(`${p.name}: Nebula Collapse. All +15 QR, +10 DR, -50% TB, SN capped at 5. RC +5. ${p.name} skips next turn.`, "event");

    } else if (choice === "fracture") {
      // Social mechanic — log it, set a fracture state for tracking
      setState(s => ({
        ...s,
        fracture: { active: true, roundsLeft: 2, initiator: pid },
        rc: s.rc + 1,
        ecePending: false,
        players: s.players.map(px => ({
          ...px, skipNextTurn: px.id === pid ? true : px.skipNextTurn,
        })),
      }));
      log(`${p.name}: Nebula Fracture. Players split into Fissure A/B for 2 rounds (assign physically). RC +1/round for 2 rounds. ${p.name} skips next turn.`, "event");

    } else if (choice === "conflagration") {
      // All PNs inactive 1 round; players with 4+ PNs lose one of choice; RC+4
      setState(s => ({
        ...s,
        conflagrationRound: s.round,
        players: s.players.map(px => ({
          ...px, skipNextTurn: px.id === pid ? true : px.skipNextTurn,
        })),
        rc: s.rc + 4,
        ecePending: false,
      }));
      log(`${p.name}: Nebula Conflagration. All PNs inactive this round. Players with 4+ PNs must discard one (apply manually). RC +4. ${p.name} skips next turn.`, "event");

    } else if (choice === "anrp") {
      // Kick off the ANRP flow — sets a flag for the UI to show the ANRP panel
      setState(s => ({ ...s, anrpPending: true, ecePending: false }));
      log(`${p.name} initiates the Advanced Nebula Rescue Procedure.`, "event");
    }
  }

  // ── ANRP HANDLER ──
  // ANRP: costly attempt to stop or mitigate an ECE before it resolves.
  // Cost: 8 DR + 3 TB upfront. Cannot afford = fail immediately, ECE proceeds, RC+3.
  // Roll 2d6:
  //   2-4   : Failure — ECE proceeds normally. Resources still lost.
  //   5-7   : Partial Mitigation — ECE effects halved (RC increase halved, resource losses halved).
  //   8-11  : Full Cancel — ECE is cancelled entirely. RC +2 (cost of the rescue).
  //   12 (double 6): Ultimate Chaos Surge — ECE cancelled BUT RC+5 and all players lose 25% of all resources.
  function resolveANRP(pid, chosenECE) {
    const p = state.players.find(x => x.id === pid);
    if (!p) return;
    const cost = { DR: 8, TB: 3 };
    if ((p.DR||0) < cost.DR || (p.TB||0) < cost.TB) {
      // Can't afford — ECE proceeds, RC+3
      setState(s => ({ ...s, rc: s.rc + 3, anrpPending: false, ecePending: true }));
      log(`${p.name} cannot afford ANRP (need 8 DR + 3 TB). Resources lost attempt. RC +3. ECE still pending.`, "event");
      return;
    }
    // Pay cost
    setState(s => ({
      ...s,
      players: s.players.map(px => px.id === pid
        ? { ...px, DR: Math.max(0, px.DR - cost.DR), TB: Math.max(0, px.TB - cost.TB) }
        : px
      ),
    }));
    const { d1, d2 } = roll2d6();
    const roll = d1 + d2;
    const isDoubleMax = d1 === 6 && d2 === 6;
    log(`${p.name} ANRP roll: ${d1}+${d2}=${roll}${isDoubleMax ? " — DOUBLE 6!" : ""}`, "roll");
    if (isDoubleMax) {
      // Ultimate Chaos Surge — ECE cancelled, RC+5, all lose 25%
      setState(s => ({
        ...s,
        rc: s.rc + 5,
        anrpPending: false,
        ecePending: false,
        players: s.players.map(px => ({
          ...px,
          ToC: Math.floor((px.ToC||0) * 0.75),
          DR:  Math.floor((px.DR||0)  * 0.75),
          TB:  Math.floor((px.TB||0)  * 0.75),
          SN:  Math.floor((px.SN||0)  * 0.75),
          QR:  Math.floor((px.QR||0)  * 0.75),
        })),
      }));
      log(`ULTIMATE CHAOS SURGE! ECE cancelled. RC +5. All players lose 25% of every resource.`, "event");
    } else if (roll <= 4) {
      // Failure — ECE proceeds, resources already lost
      setState(s => ({ ...s, anrpPending: false, ecePending: true }));
      log(`ANRP FAILED (roll ${roll} ≤ 4). Resources lost. ECE proceeds — resolve it now.`, "event");
    } else if (roll <= 7) {
      // Partial — ECE effects halved, mark as mitigated
      setState(s => ({ ...s, anrpPending: false, ecePending: true, eceMitigated: true }));
      log(`ANRP PARTIAL MITIGATION (roll ${roll}, 5-7). ECE proceeds but all effects are halved. Resolve it now.`, "event");
    } else {
      // Full cancel
      setState(s => ({ ...s, rc: s.rc + 2, anrpPending: false, ecePending: false }));
      log(`ANRP SUCCESS (roll ${roll} ≥ 8)! ECE fully cancelled. RC +2 (cost of rescue).`, "event");
    }
  }

  // ── ADVANCE PHASE / TURN ──
  
function nextPhase() {
    setState(s => {
      if (s.currentPhase < PHASES.length - 1) {
        return { ...s, currentPhase: s.currentPhase + 1, diceResult: null, weavingCalc: null };
      }
      return advanceToNextTurnState(s);
    });
    resetTransientTurnUi();
  }

  // ── RECALCULATE COEFFICIENTS ──
  // ── RECALCULATE COEFFICIENTS ──
  // Rulebook: Scaling Factor = ((Usage / Possible Usage) - 0.6)^2
  // Coefficient Adjustment = Base Coefficient × (1 ± Scaling Factor)
  // If usage > 50%: subtract (overuse penalty). If < 50%: add (neglect bonus).
  // "Usage" = resources spent last round. "Possible Usage" = resources at end of Merging last round.
  function recalcCoefficients() {
    setState(s => {
      // Sum usage across all players
      const allUsage = s.prevResourceUsage || {};
      const allPossible = s.prevPossibleUsage || {};
      const baseCoeffs = { alpha: 1.4, beta: 1.1, gamma: 1.0, delta: 1.1, epsilon: 1.15 };
      // Map: coeff → resource
      const map = [
        ["alpha", "TB"], ["beta", "SN"], ["gamma", "ToC"], ["delta", "DR"], ["epsilon", "QR"]
      ];
      const newCoeffs = {};
      let details = [];
      map.forEach(([coeff, res]) => {
        const used = allUsage[res] || 0;
        const possible = allPossible[res] || 0;
        const base = baseCoeffs[coeff];
        if (possible === 0) {
          // No data yet — keep base
          newCoeffs[coeff] = base;
          details.push(`${res}: no data, staying at base ${base}`);
          return;
        }
        const pct = used / possible;
        const sf = Math.pow(pct - 0.6, 2);
        // Multiplicative: base × (1 ± sf)
        if (pct > 0.5) {
          newCoeffs[coeff] = Math.max(0.1, base * (1 - sf));
          details.push(`${res}: ${(pct*100).toFixed(0)}% used → ×(1-${sf.toFixed(3)}) = ${newCoeffs[coeff].toFixed(3)}`);
        } else {
          newCoeffs[coeff] = base * (1 + sf);
          details.push(`${res}: ${(pct*100).toFixed(0)}% used → ×(1+${sf.toFixed(3)}) = ${newCoeffs[coeff].toFixed(3)}`);
        }
      });
      return { ...s, coefficients: newCoeffs };
    });
    log("Coefficients recalculated (multiplicative formula applied).", "info");
  }

  // ── SNAPSHOT POSSIBLE USAGE (call at end of Merging phase) ──
  function snapshotPossibleUsage(pid) {
    const p = state.players.find(x => x.id === pid);
    if (!p) return;
    setState(s => ({
      ...s,
      prevPossibleUsage: {
        ToC: p.ToC, DR: p.DR, SN: p.SN, TB: p.TB, QR: p.QR,
      },
    }));
    log(`${p.name} Merging Phase snapshot recorded for coefficient calculation.`, "info");
  }

  // ── TRACK RESOURCE SPENDING (called after weaving/actions) ──
  function recordResourceUsage(spent) {
    setState(s => {
      const prev = s.prevResourceUsage || {};
      const updated = { ...prev };
      Object.entries(spent).forEach(([res, amt]) => {
        updated[res] = (updated[res] || 0) + amt;
      });
      return { ...s, prevResourceUsage: updated };
    });
  }

  // ── RENDER ────────────────────────────────────────────────────────────────

  if (state.winner !== null) {
    const winner = state.players.find(p => p.id === state.winner);
    return (
      <div style={styles.root}>
        <div style={{ textAlign: "center", padding: 60 }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>✦</div>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: 36, color: "#4ade80", marginBottom: 8 }}>
            Reality Woven
          </div>
          <div style={{ color: "#eee", fontSize: 22, marginBottom: 32 }}>
            {state.winType === 'monopoly'
              ? `${winner?.name} has achieved Dimensional Monopoly — controlling production for 5 consecutive rounds!`
              : `${winner?.name} has woven 3 Tapestries of Reality and escaped the collapsing universe!`}
          </div>
          <button onClick={() => setState(initialState())} style={{ ...styles.btn, marginTop: 24 }}>Play Again</button>
        </div>
      </div>
    );
  }

  if (state.rc >= 100) {
    return (
      <div style={styles.root}>
        <div style={{ textAlign: "center", padding: 60 }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>💀</div>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: 32, color: "#f87171", marginBottom: 8 }}>
            Reality Collapsed
          </div>
          <div style={{ color: "#eee", fontSize: 18, marginBottom: 32 }}>
            The RC reached 100. All players lose — reality has been consumed by chaos.
          </div>
          <button onClick={() => setState(initialState())} style={{ ...styles.btn, marginTop: 24 }}>Try Again</button>
        </div>
      </div>
    );
  }

  if (!state.setup) {
    return (
      <div style={styles.root}>
        <SetupScreen
          setupCount={setupCount}
          setSetupCount={setSetupCount}
          setupNames={setupNames}
          setSetupNames={setSetupNames}
          setupMode={setupMode}
          setSetupMode={setSetupMode}
          onStart={startGame}
        />
      </div>
    );
  }

  const cp = state.players[state.currentPlayerIdx];
  const phase = PHASES[state.currentPhase];

  // Show round intro overlay at start of each round (first player, preliminary phase, not seen yet)
  const showRoundIntro = state.round > 1 && state.currentPlayerIdx === 0 && state.currentPhase === 0 && !state.roundIntroSeen;

  return (
    <div style={styles.root}>
      {showRoundIntro && (
        <RoundIntroOverlay
          round={state.round}
          rc={state.rc}
          coefficients={state.coefficients}
          prevCoefficients={state.prevCoefficients}
          prevUsagePct={state.prevUsagePct}
          players={state.players}
          prevResourceUsage={state.prevResourceUsage}
          prevPossibleUsage={state.prevPossibleUsage}
          grcp={state.grcp}
          onDismiss={() => setState(s => ({ ...s, roundIntroSeen: true }))}
        />
      )}
      {/* Header */}
      <div style={styles.header}>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#a78bfa", letterSpacing: 2 }}>
          THREADS OF CONTINUITY
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Tag color="#f87171">RC: {state.rc.toFixed(1)}</Tag>
          <Tag color="#60a5fa">Round {state.round}</Tag>
          <Tag color="#fbbf24">ToRST: {calcToRST(state.rc).toFixed(2)}</Tag>
          {state.ecePending && <Tag color="#f87171">⚠ ECE PENDING</Tag>}
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {[["alpha","TB","#a78bfa"],["beta","SN","#60a5fa"],["gamma","ToC","#4ade80"],["delta","DR","#f87171"],["epsilon","QR","#fbbf24"]].map(([k,res,color]) => (
                <span key={k} style={{ fontSize: 11 }}>
                  <span style={{ color, fontWeight: 700 }}>{res}</span>
                  <span style={{ color: "#64748b" }}> {state.coefficients[k].toFixed(2)}</span>
                </span>
              ))}
            </span>
        </div>
      </div>

      <div style={styles.body}>
        {/* Left: Players */}
        <div style={styles.leftPanel}>
          <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>PLAYERS</div>
          {state.players.map((p, idx) => (
            <PlayerCard
              key={p.id}
              player={p}
              isActive={idx === state.currentPlayerIdx}
              onChangeResource={(res, d) => changeResource(p.id, res, d)}
            />
          ))}
        </div>

        {/* Center: Phase Panel */}
        <div style={styles.centerPanel}>
          <div style={styles.phaseHeader}>
            <div style={{ color: "#a78bfa", fontWeight: 700, fontSize: 13, letterSpacing: 2, textTransform: "uppercase" }}>
              {cp?.name}'s Turn
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {PHASES.map((ph, i) => (
                <div key={ph} style={{
                  background: i === state.currentPhase ? "#a78bfa22" : "transparent",
                  border: `1px solid ${i === state.currentPhase ? "#a78bfa" : "#2a3147"}`,
                  borderRadius: 4,
                  padding: "2px 8px",
                  color: i < state.currentPhase ? "#334155" : i === state.currentPhase ? "#a78bfa" : "#475569",
                  fontSize: 11,
                  fontWeight: 700,
                }}>
                  {ph}
                </div>
              ))}
            </div>
          </div>

          <div style={styles.phaseBox}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: 16, color: "#e2e8f0", marginBottom: 6 }}>
              {phase} Phase
            </div>
            <div style={{ color: "#64748b", fontSize: 13, marginBottom: 16 }}>
              {PHASE_DESCRIPTIONS[phase]}
            </div>

            {/* Phase-specific controls */}
            {phase === "Preliminary" && state.currentPlayerIdx === 0 && (
              <PreliminaryPanel
                rc={state.rc}
                round={state.round}
                coefficients={state.coefficients}
                onSkipTurn={() => skipTurnForQR(cp?.id)}
                playerName={cp?.name}
                players={state.players}
                monopolyRoundsInControl={state.monopolyRoundsInControl}
                monopolyLoggedThisRound={state.monopolyLoggedThisRound}
                onUpdateMonopoly={(rounds) => setState(s => ({ ...s, monopolyRoundsInControl: rounds, monopolyLoggedThisRound: true }))}
                onWinMonopoly={(leaderId) => setState(s => ({ ...s, winner: leaderId, winType: 'monopoly' }))}
              />
            )}
            
{phase === "Preliminary" && state.currentPlayerIdx !== 0 && (
  <div style={{ background: "#0a0f1a", borderRadius: 8, padding: 14 }}>
    <div style={{ color: "#64748b", fontSize: 12, marginBottom: 8 }}>
      Coefficients were calculated at the start of this round:
    </div>

    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {Object.entries(state.coefficients).map(([k, v]) => {
        const meta = COEFF_META[k];
        return (
          <div key={k} style={{ background: "#1a2235", borderRadius: 5, padding: "5px 10px" }}>
            <span style={{ color: meta.color, fontWeight: 700, fontSize: 12 }}>
              {meta.resource}
            </span>{" "}
            <span style={{ color: "#94a3b8", fontSize: 12 }}>
              {v.toFixed(3)}
            </span>
          </div>
        );
      })}
    </div>

    <div style={{ marginTop: 12 }}>
      <button
        onClick={() => skipTurnForQR(cp?.id)}
        style={{
          ...styles.btnSm,
          borderColor: "#fbbf24",
          color: "#fbbf24"
        }}
      >
        Skip Turn → -10 QR
      </button>
    </div>
  </div>
)}
{phase === "Resource Collection" && (
              <ResourceCollectionPanel
                player={cp}
                diceResult={state.diceResult}
                diceRolled={state.diceRolled}
                pnCollected={state.pnCollected}
                onRoll={doRoll2d6}
                onApply={() => applyRollToPlayer(cp?.id)}
                onCollectPN={() => collectPNs(cp?.id)}
              />
            )}

            {phase === "Merging" && (
              <MergingPanel
                player={cp}
                players={state.players}
                pnBuyType={pnBuyType}
                setPnBuyType={setPnBuyType}
                onBuyPN={() => buyPN(cp?.id)}
                onUpgradePN={(idx) => upgradePN(cp?.id, idx)}
                onSabotage={(targetId, method) => sabotagePNRoll(cp?.id, targetId, method)}
                onSnapshot={() => snapshotPossibleUsage(cp?.id)}
                grcp={state.grcp}
                setState={setState}
                log={log}
                round={state.round}
              />
            )}

            {phase === "Weaving" && (
              <WeavingPanel
                player={cp}
                weavingInputs={weavingInputs}
                setWeavingInputs={setWeavingInputs}
                weavingCalc={state.weavingCalc}
                coefficients={state.coefficients}
                actionsSelected={actionsSelected}
                setActionsSelected={setActionsSelected}
                actionsApplied={actionsApplied}
                weavingMode={weavingMode}
                setWeavingMode={setWeavingMode}
                onCalc={doWeavingCalc}
                onRollWeave={() => rollWeave(cp?.id)}
                onApplyActions={() => applyActions(cp?.id)}
                rc={state.rc}
                grcp={state.grcp}
                ecePending={state.ecePending}
              />
            )}

            {phase === "Reconciliation" && (
              <ReconciliationPanel
                player={cp}
                onReconcile={() => doReconciliation(cp?.id)}
                reconciliationDone={state.reconciliationDone}
                ecePending={state.ecePending}
                anrpPending={state.anrpPending}
                onResolveECE={(choice) => resolveECE(cp?.id, choice)}
                onResolveANRP={() => resolveANRP(cp?.id, null)}
              />
            )}

            {phase === "Ending" && (
              <EndingPanel
                players={state.players}
                round={state.round}
                rc={state.rc}
                monopolyRoundsInControl={state.monopolyRoundsInControl}

              />
            )}

            {/* Rules Reference */}
            <PhaseRulesPanel phase={phase} grcp={state.grcp} />

            {phase === "Reconciliation" && !state.reconciliationDone && !state.ecePending && !state.anrpPending && (
              <div style={{ background: "#fbbf2422", border: "1px solid #fbbf24", borderRadius: 6, padding: "7px 12px", marginTop: 12, color: "#fbbf24", fontSize: 12 }}>
                ⚠ Click "Run Reconciliation" above before advancing.
              </div>
            )}
            <button
              onClick={nextPhase}
              disabled={phase === "Reconciliation" && !state.reconciliationDone && !state.ecePending && !state.anrpPending}
              style={{
                ...styles.btn, marginTop: 12, width: "100%",
                opacity: (phase === "Reconciliation" && !state.reconciliationDone) ? 0.4 : 1,
                cursor: (phase === "Reconciliation" && !state.reconciliationDone) ? "not-allowed" : "pointer",
              }}>
              {state.currentPhase < PHASES.length - 1 ? `→ Next: ${PHASES[state.currentPhase + 1]} Phase` : "End Turn →"}
            </button>
          </div>
        </div>

        {/* Right: Log */}
        <div style={styles.rightPanel}>
          <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>GAME LOG</div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {state.gameLog.map(e => <LogEntry key={e.id} entry={e} />)}
          </div>
          <GRCPPanel grcp={state.grcp} setState={setState} log={log} round={state.round} />
          <div style={{ borderTop: "1px solid #1e2535", paddingTop: 10, marginTop: 8 }}>
            <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700, letterSpacing: 2, marginBottom: 6 }}>RC TRACKER</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[0, 10, 25, 50, 75, 90, 100].map(v => (
                <div key={v} style={{
                  flex: 1, height: 6, borderRadius: 3,
                  background: state.rc >= v ? (v >= 75 ? "#f87171" : v >= 50 ? "#fbbf24" : "#4ade80") : "#1e2535",
                  minWidth: 12,
                }} />
              ))}
            </div>
            <div style={{ color: "#475569", fontSize: 11, marginTop: 4 }}>
              RC: {state.rc.toFixed(1)} / 100
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SETUP SCREEN ─────────────────────────────────────────────────────────────
function SetupScreen({ setupCount, setSetupCount, setupNames, setSetupNames, setupMode, setSetupMode, onStart }) {
  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "40px 20px" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: 28, color: "#a78bfa", letterSpacing: 3, marginBottom: 6 }}>
          THREADS OF CONTINUITY
        </div>
        <div style={{ color: "#475569", fontSize: 14 }}>Digital Game Tracker</div>
      </div>

      <div style={styles.card}>
        <label style={styles.label}>Number of Players</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {[3, 4, 5].map(n => (
            <button key={n} onClick={() => setSetupCount(n)} style={{
              ...styles.btn,
              flex: 1,
              background: setupCount === n ? "#a78bfa22" : "transparent",
              border: `1px solid ${setupCount === n ? "#a78bfa" : "#2a3147"}`,
              color: setupCount === n ? "#a78bfa" : "#475569",
            }}>{n}</button>
          ))}
        </div>

        <label style={styles.label}>Player Names</label>
        {Array.from({ length: setupCount }).map((_, i) => (
          <input
            key={i}
            value={setupNames[i]}
            onChange={e => {
              const n = [...setupNames];
              n[i] = e.target.value;
              setSetupNames(n);
            }}
            placeholder={`Player ${i + 1}`}
            style={styles.input}
          />
        ))}

        <label style={styles.label}>Game Mode</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          {["Casual", "Standard", "Hardcore"].map(m => (
            <button key={m} onClick={() => setSetupMode(m)} style={{
              ...styles.btn,
              flex: 1,
              background: setupMode === m ? "#4ade8022" : "transparent",
              border: `1px solid ${setupMode === m ? "#4ade80" : "#2a3147"}`,
              color: setupMode === m ? "#4ade80" : "#475569",
              fontSize: 12,
            }}>{m}</button>
          ))}
        </div>
        <div style={{ color: "#334155", fontSize: 12, marginBottom: 16, textAlign: "center" }}>
          Base RC: Casual=5 · Standard=10 · Hardcore=15
        </div>
        <button onClick={onStart} style={{ ...styles.btn, width: "100%", fontSize: 15, padding: "12px 0" }}>
          Begin Game
        </button>
      </div>
    </div>
  );
}

// ─── PLAYER CARD ──────────────────────────────────────────────────────────────
function PlayerCard({ player, isActive, onChangeResource }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{
      ...styles.card,
      borderColor: isActive ? "#a78bfa" : "#1e2535",
      marginBottom: 8,
      background: isActive ? "#a78bfa08" : "#0f1624",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isActive && <span style={{ color: "#a78bfa", fontSize: 10 }}>▶</span>}
          <span style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 13 }}>{player.name}</span>
          {player.skipNextTurn && <Tag color="#f87171">SKIP</Tag>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Tag color="#4ade80">ToR: {player.tor}/3</Tag>
          {player.pns.length > 0 && (
            <button onClick={() => setExpanded(e => !e)} style={{ ...btnSmStyle("#1a2235", "#2a3147"), width: "auto", padding: "0 6px" }}
              title={`${player.pns.length} Production Node${player.pns.length !== 1 ? "s" : ""}`}>
              {expanded ? "▲" : `▼ ${player.pns.length}PN`}
            </button>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {["ToC", "DR", "SN", "QR", "TB"].map(res => (
          <ResourcePip key={res} type={res} value={player[res]} onChange={onChangeResource} mini />
        ))}
      </div>
      {expanded && player.pns.length > 0 && (
        <div style={{ marginTop: 8, borderTop: "1px solid #1e2535", paddingTop: 8 }}>
          <div style={{ color: "#334155", fontSize: 10, marginBottom: 4, letterSpacing: 1 }}>PRODUCTION NODES</div>
          {player.pns.map((pn, i) => (
            <div key={i} style={{ color: "#4ade80", fontSize: 11 }}>
              {pn.type} Node — Lvl {pn.level} (+{pn.level}/rd)
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── PHASE PANELS ─────────────────────────────────────────────────────────────
const COEFF_META = {
  alpha: { label: "Temporal Bridge weight", resource: "TB", color: "#a78bfa", help: "How much TB boosts your weave" },
  beta:  { label: "Spatial Node weight",    resource: "SN", color: "#60a5fa", help: "How much SN boosts your weave" },
  gamma: { label: "Thread of Continuity weight", resource: "ToC", color: "#4ade80", help: "How much ToC boosts your weave" },
  delta: { label: "Dimensional Ripple drag", resource: "DR", color: "#f87171", help: "How much DR hurts your weave" },
  epsilon: { label: "Quantum Residue drag", resource: "QR", color: "#fbbf24", help: "How much QR hurts your weave" },
};

function PreliminaryPanel({ rc, round, coefficients, onSkipTurn, playerName,
  players, monopolyRoundsInControl, monopolyLoggedThisRound, onUpdateMonopoly, onWinMonopoly }) {
  const torst = calcToRST(rc);

  // Monopoly calculation (same logic as EndingPanel)
  const globalPNProduction = (players||[]).reduce((sum, p) =>
    sum + (p.pns||[]).reduce((s2, pn) => s2 + pn.level, 0), 0);
  const playerShares = (players||[]).map(p => ({
    playerId: p.id,
    name: p.name,
    share: globalPNProduction > 0
      ? ((p.pns||[]).reduce((s, pn) => s + pn.level, 0) / globalPNProduction * 100).toFixed(1)
      : "0.0",
  }));
  const sortedShares = [...playerShares].sort((a, b) => parseFloat(b.share) - parseFloat(a.share));
  const leader = sortedShares[0] || {};
  const runnerUp = sortedShares[1] || {};
  const leaderInControl = parseFloat(leader.share||0) > 50 &&
    parseFloat(leader.share||0) > parseFloat(runnerUp.share||0);

  return (
    <div>
      {/* Monopoly tracker — only visible here, start of each round */}
      {globalPNProduction > 0 && (
        <div style={{ background: "#0a0f1a", border: "1px solid #fbbf2433", borderRadius: 8, padding: 12, marginBottom: 14 }}>
          <div style={{ color: "#fbbf24", fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
            DIMENSIONAL MONOPOLY — {monopolyRoundsInControl}/5
          </div>
          {playerShares.map(ps => (
            <div key={ps.name} style={{ marginBottom: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                <span style={{ color: parseFloat(ps.share) > 50 ? "#fbbf24" : "#64748b", fontSize: 12 }}>{ps.name}</span>
                <span style={{ color: parseFloat(ps.share) > 50 ? "#fbbf24" : "#475569", fontWeight: 700, fontSize: 12 }}>{ps.share}%</span>
              </div>
              <div style={{ background: "#1a2235", borderRadius: 2, height: 4 }}>
                <div style={{ width: `${Math.min(100, parseFloat(ps.share))}%`, height: 4, borderRadius: 2,
                  background: parseFloat(ps.share) > 50 ? "#fbbf24" : "#334155" }} />
              </div>
            </div>
          ))}
          <div style={{ marginTop: 8 }}>
            <div style={{ color: "#4ade80", fontSize: 11 }}>✓ Monopoly streak auto-tracked: {monopolyRoundsInControl}/5</div></div>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div style={styles.label}>Weaving Coefficients — how resources are weighted this round</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {Object.entries(coefficients).map(([k, v]) => {
            const meta = COEFF_META[k];
            const isBoost = k === "alpha" || k === "beta" || k === "gamma";
            const bar = Math.min(100, (v / 3) * 100);
            return (
              <div key={k} style={{ background: "#0a0f1a", borderRadius: 6, padding: "7px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div>
                    <span style={{ color: meta.color, fontWeight: 700, fontSize: 12 }}>{meta.resource} </span>
                    <span style={{ color: "#64748b", fontSize: 11 }}>{meta.label}</span>
                  </div>
                  <span style={{ color: meta.color, fontWeight: 700, fontSize: 13 }}>
                    {isBoost ? "+" : "−"}{v.toFixed(2)}
                  </span>
                </div>
                <div style={{ background: "#1a2235", borderRadius: 3, height: 4 }}>
                  <div style={{ width: `${bar}%`, height: 4, background: meta.color, borderRadius: 3, opacity: 0.7 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ background: "#0a0f1a", borderRadius: 6, padding: "8px 12px", marginBottom: 12 }}>
        <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>WEAVE DIFFICULTY THIS ROUND</div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div>
            <div style={{ color: "#334155", fontSize: 10 }}>Reality Constant</div>
            <div style={{ color: "#f87171", fontWeight: 700, fontSize: 20 }}>{rc.toFixed(1)}</div>
          </div>
          <div style={{ color: "#334155", fontSize: 18 }}>→</div>
          <div>
            <div style={{ color: "#334155", fontSize: 10 }}>Success Threshold</div>
            <div style={{ color: "#a78bfa", fontWeight: 700, fontSize: 20 }}>{torst.toFixed(2)}</div>
            <div style={{ color: "#334155", fontSize: 10 }}>Your Weaving Score must beat this</div>
          </div>
        </div>
      </div>
      <div style={{ borderTop: "1px solid #1e2535", paddingTop: 12 }}>
        <div style={{ color: "#64748b", fontSize: 11, marginBottom: 6 }}>SKIP TURN OPTION</div>
        <div style={{ color: "#475569", fontSize: 12, marginBottom: 8 }}>
          {playerName} may skip their entire turn to reduce their QR by 10.
        </div>
        <button onClick={onSkipTurn} style={{ ...styles.btnSm, borderColor: "#fbbf24", color: "#fbbf24" }}>
          Skip Turn → -10 QR
        </button>
      </div>
    </div>
  );
}

function ResourceCollectionPanel({ player, diceResult, diceRolled, pnCollected, onRoll, onApply, onCollectPN }) {
  const rollApplied = diceResult?.applied;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {player?.pns?.length > 0 && (
        <div>
          {pnCollected ? (
            <div style={{ color: "#4ade80", fontSize: 12 }}>✓ PN resources collected this turn.</div>
          ) : (
            <button onClick={onCollectPN} style={styles.btnSm}>Collect PN Resources</button>
          )}
        </div>
      )}
      {diceRolled ? (
        <div style={{ color: "#475569", fontSize: 12 }}>
          {rollApplied ? "✓ Dice rolled and applied." : "Dice rolled — apply result below."}
        </div>
      ) : (
        <button onClick={onRoll} style={styles.btnSm}>Roll 2d6 for Resources</button>
      )}
      {diceResult && (
        <div style={{ background: "#0a0f1a", borderRadius: 8, padding: 12 }}>
          <div style={{ color: "#fbbf24", fontWeight: 700, fontSize: 18, marginBottom: 4 }}>
            ⬡ {diceResult.d1} + {diceResult.d2} = {diceResult.sum}
          </div>
          <div style={{ color: "#4ade80", fontSize: 13, marginBottom: 8 }}>{diceResult.gain}</div>
          <button
            onClick={onApply}
            disabled={rollApplied}
            style={{
              ...styles.btnSm,
              background: rollApplied ? "#1a2235" : "#4ade8022",
              borderColor: rollApplied ? "#2a3147" : "#4ade80",
              color: rollApplied ? "#334155" : "#4ade80",
              cursor: rollApplied ? "not-allowed" : "pointer",
              opacity: rollApplied ? 0.5 : 1,
            }}
          >
            {rollApplied ? "✓ Applied" : `Apply to ${player?.name}`}
          </button>
        </div>
      )}
      <div style={{ color: "#334155", fontSize: 12 }}>
        2–5: +3 ToC · 6–8: +2 DR · 9–10: +2 SN · 11–12: +1 TB
      </div>
    </div>
  );
}

function MergingPanel({ player, players, pnBuyType, setPnBuyType, onBuyPN, onUpgradePN, onSabotage, onSnapshot, grcp, setState, log, round }) {
  const [tab, setTab] = useState("pns");
  const [sabTarget, setSabTarget] = useState(null);
  const [sabMethod, setSabMethod] = useState("DR");

  const opponents = players.filter(p => p.id !== player?.id);

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
        {[["pns","Production Nodes"],["sabotage","Sabotage"],["grcp","GRCP"],["social","Trading & Social"]].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            ...styles.btnSm, fontSize: 11,
            background: tab === t ? "#a78bfa22" : "transparent",
            borderColor: tab === t ? "#a78bfa" : "#2a3147",
            color: tab === t ? "#a78bfa" : "#475569",
          }}>{label}</button>
        ))}
      </div>

      {/* PRODUCTION NODES TAB */}
      {tab === "pns" && (
        <div>
          <div style={styles.label}>Buy New Node</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {PN_TYPES.map(t => (
              <button key={t} onClick={() => setPnBuyType(t)} style={{
                ...styles.btnSm,
                background: pnBuyType === t ? `${RESOURCE_COLORS[t]}22` : "transparent",
                borderColor: pnBuyType === t ? RESOURCE_COLORS[t] : "#2a3147",
                color: pnBuyType === t ? RESOURCE_COLORS[t] : "#475569",
              }}>{t}</button>
            ))}
          </div>
          <div style={{ color: "#475569", fontSize: 11, marginBottom: 8 }}>
            Cost: {Object.entries(PN_CREATION_COST[pnBuyType]).map(([r, a]) => `${a} ${r}`).join(" + ")} → +1 {pnBuyType}/round
          </div>
          <button onClick={onBuyPN} style={styles.btnSm}>Purchase {pnBuyType} Node</button>

          {player?.pns?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={styles.label}>Upgrade Existing Nodes</div>
              {player.pns.map((pn, i) => {
                const cost = getUpgradeCost(pn.type, pn.level);
                const costStr = cost ? Object.entries(cost).map(([r,a]) => `${a} ${r}`).join("+") : "MAX";
                const canAfford = cost && Object.entries(cost).every(([r,a]) => (player[r]||0) >= a);
                return (
                  <div key={i} style={{ background: "#0a0f1a", borderRadius: 6, padding: "7px 10px", marginBottom: 5, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ color: RESOURCE_COLORS[pn.type], fontWeight: 700, fontSize: 12 }}>{pn.type} Node</span>
                      <span style={{ color: "#475569", fontSize: 11 }}> Lv{pn.level} → +{pn.level}/rd</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: cost ? (canAfford ? "#4ade80" : "#f87171") : "#334155", fontSize: 10 }}>{costStr}</span>
                      {cost && (
                        <button onClick={() => onUpgradePN(i)} disabled={!canAfford} style={{
                          ...styles.btnSm, fontSize: 10, padding: "2px 8px",
                          opacity: canAfford ? 1 : 0.4, cursor: canAfford ? "pointer" : "not-allowed",
                          borderColor: canAfford ? "#4ade80" : "#2a3147", color: canAfford ? "#4ade80" : "#475569",
                        }}>Upgrade</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SABOTAGE TAB */}
      {tab === "sabotage" && (
        <div>
          <div style={{ color: "#64748b", fontSize: 12, marginBottom: 10 }}>
            Spend 3 DR and roll d6. On an even number (2,4,6): target PN output is halved for 1 round and you gain half the lost resources.
          </div>
          <div style={styles.label}>Target Player</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {opponents.map(p => (
              <button key={p.id} onClick={() => setSabTarget(p.id)} style={{
                ...styles.btnSm,
                borderColor: sabTarget === p.id ? "#f87171" : "#2a3147",
                color: sabTarget === p.id ? "#f87171" : "#475569",
                background: sabTarget === p.id ? "#f8717122" : "transparent",
              }}>{p.name} ({p.pns.length} PN{p.pns.length !== 1 ? "s" : ""})</button>
            ))}
          </div>
          <div style={{ color: "#f87171", fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Cost: 3 DR</div>
          {(() => {
            const targetPlayer = players.find(p => p.id === sabTarget);
            const targetHasPNs = !!(targetPlayer && targetPlayer.pns.length > 0);
            const canProceed = !!(sabTarget !== null && sabTarget !== undefined && targetHasPNs);
            const noTarget = sabTarget === null || sabTarget === undefined;
            const noPNs = sabTarget && !targetHasPNs;
            return (
              <div>
                <button
                  onClick={() => { if (sabTarget !== null && sabTarget !== undefined && targetHasPNs) onSabotage(sabTarget, sabMethod); }}
                  disabled={!canProceed}
                  style={{ ...styles.btnSm, opacity: canProceed ? 1 : 0.4, cursor: canProceed ? "pointer" : "not-allowed", borderColor: "#f87171", color: "#f87171" }}
                >
                  Roll Sabotage
                </button>
                {noTarget && <div style={{ color: "#475569", fontSize: 11, marginTop: 6 }}>Select a target above.</div>}
                {noPNs && <div style={{ color: "#f87171", fontSize: 11, marginTop: 6 }}>⚠ Target has no PNs to sabotage.</div>}
              </div>
            );
          })()}
        </div>
      )}

      {/* GRCP TAB */}
      {tab === "grcp" && (
        <div>
          <div style={{ color: "#64748b", fontSize: 12, marginBottom: 10 }}>
            A Game Rule Change Proposal can only be initiated during your Merging Phase. Log it here — it will appear in the relevant phase's rules reference.
          </div>
          <InlineGRCPForm grcp={grcp} setState={setState} log={log} round={round} />
        </div>
      )}

      {/* SOCIAL TAB */}
      {tab === "social" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            ["Trading", "Write the trade on paper, read aloud, both sign. Counter-offers follow the same process."],
            ["Public Offers", "Write offer discreetly, fold, place center of table. Any player may view it privately. First to sign accepts. Each player only gets one look."],
            ["Alliances", "Write Alliance Proposal Form (APF) with: duration/goal, shared resources, break conditions & penalties. Send discreetly. Counter-offers allowed."],
            ["Bribery", "Write bribe on paper (any format), hand discreetly. Recipient signs 'A' (accept) or 'R' (reject). No counter-offers."],
          ].map(([title, desc]) => (
            <div key={title} style={{ background: "#0a0f1a", borderRadius: 6, padding: "8px 12px" }}>
              <div style={{ color: "#a78bfa", fontWeight: 700, fontSize: 12, marginBottom: 3 }}>{title}</div>
              <div style={{ color: "#475569", fontSize: 11 }}>{desc}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ borderTop: "1px solid #1e2535", paddingTop: 8, marginTop: 6 }}>
        <div style={{ color: "#334155", fontSize: 10 }}>
          📋 Resource snapshot for coefficient calculation is recorded automatically when you advance.
        </div>
      </div>
    </div>
  );
}

// Targets that can be overridden by GRCP
const GRCP_TARGETS = [
  { value: "", label: "— select what changes —" },
  { group: "Action Costs", items: WEAVING_ACTIONS.map(a => ({ value: `action:${a.id}`, label: `Action: ${a.label}` })) },
  { group: "PN Creation Costs", items: [
    ...["ToC","DR","TB","SN"].flatMap(t =>
      Object.keys(PN_CREATION_COST[t]).map(res => ({ value: `pn_create:${t}:${res}`, label: `${t} Node creation: ${res} cost` }))
    )
  ]},
  { group: "Reconciliation Thresholds", items: [
    { value: "reconcile:dr_qr_divisor", label: "DR→QR conversion divisor (default: 5)" },
    { value: "reconcile:unstable_qr", label: "Unstable Timeline QR threshold (default: 20)" },
    { value: "reconcile:ece_dr_low",  label: "ECE low DR threshold (default: 10)" },
    { value: "reconcile:ece_dr_high", label: "ECE high DR threshold (default: 15)" },
  ]},
  { group: "Other", items: [{ value: "other", label: "Freeform (note only, no numeric effect)" }] },
];

function InlineGRCPForm({ grcp, setState, log, round }) {
  const [form, setForm] = useState({
    rule: "", change: "", reason: "", affectedPhase: "All",
    overrideTarget: "", overrideRes: "", overrideValue: "",
  });
  const [saved, setSaved] = useState(false);

  const selectedAction = form.overrideTarget.startsWith("action:")
    ? WEAVING_ACTIONS.find(a => `action:${a.id}` === form.overrideTarget)
    : null;
  const isActionTarget = !!selectedAction;
  const isNumericTarget = form.overrideTarget && form.overrideTarget !== "other";

  function buildOverrides() {
    if (!isNumericTarget || !form.overrideValue) return undefined;
    const val = parseInt(form.overrideValue, 10);
    if (isNaN(val)) return undefined;
    if (isActionTarget && form.overrideRes) {
      return [{ target: form.overrideTarget, res: form.overrideRes, value: val }];
    } else if (!isActionTarget) {
      return [{ target: form.overrideTarget, value: val }];
    }
    return undefined;
  }

  function addGRCP() {
    if (!form.rule.trim() || !form.change.trim()) return;
    const overrides = buildOverrides();
    const entry = { rule: form.rule, change: form.change, reason: form.reason,
      affectedPhase: form.affectedPhase, id: Date.now(), round, overrides };
    setState(s => ({ ...s, grcp: [...s.grcp, entry] }));
    const effectNote = overrides ? ` [LIVE OVERRIDE applied]` : "";
    log(`⚑ GRCP: "${form.rule}" → "${form.change}"${effectNote}`, "event");
    setForm({ rule: "", change: "", reason: "", affectedPhase: "All", overrideTarget: "", overrideRes: "", overrideValue: "" });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      {grcp.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: "#334155", fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>ACTIVE RULE CHANGES</div>
          {grcp.map(g => (
            <div key={g.id} style={{ background: "#fbbf2411", border: "1px solid #fbbf2422", borderRadius: 5, padding: "5px 8px", marginBottom: 3 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ color: "#fbbf24", fontSize: 11, fontWeight: 700 }}>{g.rule} → {g.change}</div>
                {g.overrides && <span style={{ color: "#4ade80", fontSize: 9, fontWeight: 700 }}>LIVE</span>}
              </div>
              <div style={{ color: "#475569", fontSize: 10 }}>{g.affectedPhase} · Round {g.round}</div>
            </div>
          ))}
        </div>
      )}

      <div style={styles.label}>Propose a Rule Change</div>

      <div style={{ color: "#475569", fontSize: 10, marginBottom: 4 }}>What does this change? (for live enforcement)</div>
      <select value={form.overrideTarget} onChange={e => setForm(f => ({...f, overrideTarget: e.target.value, overrideRes: "", overrideValue: ""}))}
        style={{ ...styles.input, marginBottom: 8 }}>
        <option value="">— select target (optional) —</option>
        {GRCP_TARGETS.filter(g => g.items).map(g => (
          <optgroup key={g.group} label={g.group}>
            {g.items.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
          </optgroup>
        ))}
      </select>

      {isActionTarget && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ color: "#475569", fontSize: 10, marginBottom: 4 }}>Which resource cost to change?</div>
          <select value={form.overrideRes} onChange={e => setForm(f => ({...f, overrideRes: e.target.value}))}
            style={{ ...styles.input, marginBottom: 0 }}>
            <option value="">— select resource —</option>
            {["ToC","DR","SN","TB","QR"].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      )}

      {isNumericTarget && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ color: "#475569", fontSize: 10, marginBottom: 4 }}>New value (number)</div>
          <input type="number" min={0} placeholder="e.g. 1" value={form.overrideValue}
            onChange={e => setForm(f => ({...f, overrideValue: e.target.value}))}
            style={{ ...styles.input, marginBottom: 0 }} />
        </div>
      )}

      <input placeholder="Original rule description" value={form.rule}
        onChange={e => setForm(f => ({...f, rule: e.target.value}))} style={styles.input} />
      <input placeholder="New rule / what changes" value={form.change}
        onChange={e => setForm(f => ({...f, change: e.target.value}))} style={styles.input} />
      <input placeholder="Reason (optional)" value={form.reason}
        onChange={e => setForm(f => ({...f, reason: e.target.value}))} style={styles.input} />
      <div style={{ color: "#475569", fontSize: 10, marginBottom: 4 }}>Phase affected</div>
      <select value={form.affectedPhase} onChange={e => setForm(f => ({...f, affectedPhase: e.target.value}))}
        style={{ ...styles.input, marginBottom: 10 }}>
        {["All","Preliminary","Resource Collection","Merging","Weaving","Reconciliation","Ending","ECE","Other"].map(p => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <button onClick={addGRCP} style={{ ...styles.btnSm, borderColor: "#fbbf24", color: "#fbbf24", width: "100%", padding: "7px 0" }}>
        {saved ? "✓ Logged!" : "Log GRCP"}
      </button>
    </div>
  );
}


function WeavingPanel({ player, weavingInputs, setWeavingInputs, weavingCalc, actionsSelected, setActionsSelected, actionsApplied, weavingMode, setWeavingMode, onCalc, onRollWeave, onApplyActions, grcp, ecePending }) {
  const categories = [...new Set(WEAVING_ACTIONS.map(a => a.category))];

  // Resolve display cost using structured GRCP overrides
  function getDisplayCost(action) {
    if (!grcp || grcp.length === 0) return action.cost;
    const overrides = grcp
      .filter(g => g.overrides)
      .flatMap(g => g.overrides)
      .filter(o => o.target === `action:${action.id}`);
    if (overrides.length === 0) return action.cost;
    const newCost = { ...action.cost };
    overrides.forEach(o => {
      if (o.value === 0) delete newCost[o.res];
      else newCost[o.res] = o.value;
    });
    return newCost;
  }

  // Simulate the running balance after currently-selected actions
  function getRunningBalance() {
    const bal = { ToC: player?.ToC||0, DR: player?.DR||0, SN: player?.SN||0, TB: player?.TB||0, QR: player?.QR||0 };
    for (const id of actionsSelected) {
      const a = WEAVING_ACTIONS.find(x => x.id === id);
      if (!a) continue;
      const effectiveCost = getDisplayCost(a);
      for (const [res, amt] of Object.entries(effectiveCost)) bal[res] = Math.max(0, (bal[res]||0) - amt);
      for (const [res, amt] of Object.entries(a.effect||{})) {
        if (res !== "skipNextTurn") bal[res] = Math.max(0, (bal[res]||0) + amt);
      }
    }
    return bal;
  }

  function canAffordAction(a) {
    const effectiveCost = getDisplayCost(a);
    const bal = { ToC: player?.ToC||0, DR: player?.DR||0, SN: player?.SN||0, TB: player?.TB||0, QR: player?.QR||0 };
    for (const id of actionsSelected) {
      const act = WEAVING_ACTIONS.find(x => x.id === id);
      if (!act) continue;
      const actCost = getDisplayCost(act);
      for (const [res, amt] of Object.entries(actCost)) bal[res] = Math.max(0, (bal[res]||0) - amt);
    }
    return Object.entries(effectiveCost).every(([res, amt]) => (bal[res]||0) >= amt);
  }

  function toggleAction(id) {
    if (actionsApplied) return;
    const isSelected = actionsSelected.includes(id);
    if (isSelected) {
      setActionsSelected(prev => prev.filter(x => x !== id));
      return;
    }
    if (actionsSelected.length >= 3) return;
    const action = WEAVING_ACTIONS.find(a => a.id === id);
    if (!action) return;
    if (!canAffordAction(action)) return;
    setActionsSelected(prev => [...prev, id]);
  }

  const runningBalance = getRunningBalance();

  return (
    <div>
      {/* Mode selector */}
      {!weavingMode && (
        <div>
          <div style={{ color: "#64748b", fontSize: 12, marginBottom: 12 }}>
            Choose what to do this Weaving Phase:
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setWeavingMode("actions")} style={{
              ...styles.btn, flex: 1, fontSize: 13, padding: "14px 8px",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            }}>
              <span style={{ fontSize: 20 }}>⚡</span>
              Take 3 Actions
              <span style={{ color: "#64748b", fontSize: 10, fontWeight: 400 }}>Spend resources for effects</span>
            </button>
            <button onClick={() => setWeavingMode("weave")} style={{
              ...styles.btn, flex: 1, fontSize: 13, padding: "14px 8px",
              background: "#4ade8022", border: "1px solid #4ade80", color: "#4ade80",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            }}>
              <span style={{ fontSize: 20 }}>✦</span>
              Attempt Weave
              <span style={{ color: "#4ade8055", fontSize: 10, fontWeight: 400 }}>Try to weave a ToR</span>
            </button>
          </div>
        </div>
      )}

      {/* ACTIONS MODE */}
      {weavingMode === "actions" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ color: "#a78bfa", fontWeight: 700, fontSize: 13 }}>
              ⚡ Choose up to 3 Actions ({actionsSelected.length}/3)
            </div>
            <button onClick={() => setWeavingMode(null)} style={{ ...styles.btnSm, fontSize: 10 }}>← Back</button>
          </div>
          {actionsApplied && (
            <div style={{ background: "#4ade8022", border: "1px solid #4ade80", borderRadius: 6, padding: "6px 10px", marginBottom: 10 }}>
              <div style={{ color: "#4ade80", fontSize: 12 }}>✓ Actions applied for this turn.</div>
              <button onClick={() => setWeavingMode("weave")} style={{ ...styles.btnSm, borderColor: "#4ade80", color: "#4ade80", marginTop: 8, width: "100%" }}>
                ✦ Now Attempt a Weave
              </button>
            </div>
          )}
          {actionsApplied && ecePending && (
            <div style={{ background: "#f8717122", border: "1px solid #f87171", borderRadius: 6, padding: "8px 12px", marginBottom: 10 }}>
              <div style={{ color: "#f87171", fontWeight: 700, fontSize: 13, marginBottom: 4 }}>⚠ Ethereal Chaos Event triggered!</div>
              <div style={{ color: "#94a3b8", fontSize: 12 }}>Proceed to the Reconciliation Phase to choose your resolution: Nebula Flush, Reset, or Collapse.</div>
            </div>
          )}
          {categories.map(cat => (
            <div key={cat} style={{ marginBottom: 10 }}>
              <div style={{ color: "#334155", fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>{cat.toUpperCase()}</div>
              {WEAVING_ACTIONS.filter(a => a.category === cat).map(a => {
                const selected = actionsSelected.includes(a.id);
                // Affordable = can pay from running balance after other selected actions
                const affordable = canAffordAction(a);
                const full = !selected && actionsSelected.length >= 3;
                const disabled = actionsApplied || full || (!selected && !affordable);
                // Cost display using running balance
                const effectiveCost = getDisplayCost(a);
                const isOverridden = JSON.stringify(effectiveCost) !== JSON.stringify(a.cost);
                const costStr = Object.entries(effectiveCost).map(([res, amt]) => {
                  const have = runningBalance[res] || 0;
                  const short = have < amt;
                  return `${amt} ${res}${short && !selected ? " ⚠" : ""}`;
                }).join(" + ") || "free";
                return (
                  <div key={a.id} onClick={() => !disabled && toggleAction(a.id)} style={{
                    cursor: disabled ? "default" : "pointer",
                    background: selected ? "#a78bfa22" : "#0a0f1a",
                    border: `1px solid ${selected ? "#a78bfa" : !affordable && !selected ? "#2a1515" : "#1e2535"}`,
                    borderRadius: 5, padding: "6px 10px", marginBottom: 4,
                    opacity: (disabled && !selected) ? 0.4 : 1,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <span style={{ color: selected ? "#a78bfa" : "#94a3b8", fontSize: 12, fontWeight: selected ? 700 : 400 }}>
                        {selected ? "✓ " : ""}{a.label}
                        {isOverridden && <span style={{ color: "#fbbf24", fontSize: 9, marginLeft: 4 }}>⚑GRCP</span>}
                      </span>
                      <span style={{ color: !affordable && !selected ? "#f87171" : "#334155", fontSize: 10 }}>
                        {full ? "full" : costStr}
                      </span>
                    </div>
                    {a.social && selected && (
                      <div style={{ color: "#fbbf24", fontSize: 10, marginTop: 2 }}>⚑ {a.social}</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {!actionsApplied && actionsSelected.length > 0 && (
            <div>
              <div style={{ background: "#0a0f1a", borderRadius: 6, padding: "8px 10px", marginBottom: 8, marginTop: 6 }}>
                <div style={{ color: "#334155", fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>BALANCE AFTER THESE ACTIONS</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {["ToC","DR","SN","TB","QR"].map(res => (
                    <span key={res} style={{ fontSize: 11 }}>
                      <span style={{ color: RESOURCE_COLORS[res] }}>{res}</span>
                      <span style={{ color: "#94a3b8" }}> {runningBalance[res] ?? player?.[res] ?? 0}</span>
                    </span>
                  ))}
                </div>
              </div>
              <button onClick={onApplyActions} style={{ ...styles.btn, width: "100%" }}>
                Apply {actionsSelected.length} Action{actionsSelected.length > 1 ? "s" : ""}
              </button>
            </div>
          )}
        </div>
      )}

      {/* WEAVE MODE */}
      {weavingMode === "weave" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ color: "#4ade80", fontWeight: 700, fontSize: 13 }}>✦ Weave a Tapestry of Reality</div>
            <button onClick={() => setWeavingMode(null)} style={{ ...styles.btnSm, fontSize: 10 }}>← Back</button>
          </div>
          <div style={{ color: "#475569", fontSize: 11, marginBottom: 10 }}>
            Commit resources to boost your weave. Your current DR and QR automatically work against you — you can't opt out of them.
          </div>

          {/* Drag resources — auto-applied, read-only */}
          <div style={{ background: "#f8717111", border: "1px solid #f8717133", borderRadius: 6, padding: "8px 12px", marginBottom: 10 }}>
            <div style={{ color: "#f87171", fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>DRAGGING YOU DOWN (auto-applied from your totals)</div>
            <div style={{ display: "flex", gap: 16 }}>
              {["DR", "QR"].map(res => (
                <div key={res}>
                  <span style={{ color: RESOURCE_COLORS[res], fontWeight: 700, fontSize: 12 }}>↓ {res} </span>
                  <span style={{ color: "#f87171", fontWeight: 700, fontSize: 16 }}>{player?.[res] ?? 0}</span>
                </div>
              ))}
            </div>
            <div style={{ color: "#475569", fontSize: 10, marginTop: 4 }}>Reduce DR and QR before weaving to improve your odds.</div>
          </div>

          {/* Boost resources — player chooses how many to commit */}
          <div style={{ color: "#64748b", fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>COMMIT TO BOOST (choose how many)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
            {["TB", "SN", "ToC"].map(res => {
              const have = player?.[res] ?? 0;
              const want = weavingInputs[res] || 0;
              const over = want > have;
              return (
                <div key={res} style={{
                  background: over ? "#f8717111" : "#0a0f1a",
                  border: `1px solid ${over ? "#f87171" : "#1e2535"}`,
                  borderRadius: 6, padding: "6px 8px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ color: RESOURCE_COLORS[res], fontWeight: 700, fontSize: 12 }}>↑ {res}</span>
                    <span style={{ color: "#334155", fontSize: 10 }}>{have} avail</span>
                  </div>
                  <input
                    type="number" min={0} max={have} value={want}
                    onChange={e => setWeavingInputs(p => ({ ...p, [res]: Math.max(0, Math.min(+e.target.value, player?.[res] ?? 0)) }))}
                    style={{ ...styles.input, marginBottom: 0, padding: "3px 6px", borderColor: over ? "#f87171" : "#2a3147" }}
                  />
                  {over && <div style={{ color: "#f87171", fontSize: 9, marginTop: 2 }}>⚠ too many</div>}
                </div>
              );
            })}
          </div>

          <button onClick={onCalc} style={styles.btnSm}>Calculate My Chances</button>

          {weavingCalc && (
            <div style={{ background: "#0a0f1a", borderRadius: 8, padding: 14, marginTop: 10 }}>
              <div style={{ color: "#64748b", fontSize: 11, marginBottom: 10, letterSpacing: 1 }}>WEAVE ATTEMPT SUMMARY</div>
              <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <div style={{ flex: 1, background: "#111827", borderRadius: 6, padding: "8px 12px", minWidth: 70 }}>
                  <div style={{ color: "#475569", fontSize: 10 }}>Your Strength</div>
                  <div style={{ color: "#4ade80", fontWeight: 700, fontSize: 22 }}>{weavingCalc.ws.toFixed(2)}</div>
                </div>
                <div style={{ color: "#334155", fontSize: 18, alignSelf: "center" }}>vs</div>
                <div style={{ flex: 1, background: "#111827", borderRadius: 6, padding: "8px 12px", minWidth: 70 }}>
                  <div style={{ color: "#475569", fontSize: 10 }}>Difficulty</div>
                  <div style={{ color: "#f87171", fontWeight: 700, fontSize: 22 }}>{weavingCalc.torst.toFixed(2)}</div>
                </div>
              </div>
              <div style={{ background: "#111827", borderRadius: 6, padding: "10px 14px", marginBottom: 10 }}>
                <div style={{ color: "#475569", fontSize: 10, marginBottom: 4 }}>SUCCESS CHANCE</div>
                <div style={{ color: "#fbbf24", fontWeight: 700, fontSize: 28 }}>{weavingCalc.pt.toFixed(0)}%</div>
                <div style={{ color: "#475569", fontSize: 12 }}>
                  Roll d100 — need <span style={{ color: "#fbbf24", fontWeight: 700 }}>{Math.floor(weavingCalc.pt)} or lower</span>
                </div>
              {weavingCalc.qrPenalty > 0 && (
                <div style={{ color: "#fbbf24", fontSize: 11, marginTop: 4 }}>
                  ⚠ QR penalty: {weavingCalc.qrPenaltyLabel} reduced your chance by {weavingCalc.qrPenalty}%.
                </div>
              )}
                <div style={{ background: "#1a2235", borderRadius: 3, height: 6, marginTop: 8 }}>
                  <div style={{
                    width: `${weavingCalc.pt}%`, height: 6, borderRadius: 3,
                    background: weavingCalc.pt >= 60 ? "#4ade80" : weavingCalc.pt >= 30 ? "#fbbf24" : "#f87171",
                    transition: "width 0.4s",
                  }} />
                </div>
                {weavingCalc.playerDR > 0 || weavingCalc.playerQR > 0 ? (
                  <div style={{ color: "#475569", fontSize: 10, marginTop: 6 }}>
                    Dragged by {weavingCalc.playerDR} DR + {weavingCalc.playerQR} QR — reduce them first to improve odds.
                  </div>
                ) : null}
              </div>
              <button onClick={onRollWeave} style={{ ...styles.btnSm, width: "100%", background: "#4ade8022", borderColor: "#4ade80", color: "#4ade80", padding: "8px 0" }}>
                Roll d100 — Attempt the Weave
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReconciliationPanel({ player, onReconcile, reconciliationDone, ecePending, anrpPending, onResolveECE, onResolveANRP }) {
  const [selectedECE, setSelectedECE] = useState(null);
  return (
    <div>
      <div style={{ color: "#64748b", fontSize: 12, marginBottom: 10 }}>
        Auto-check penalties: DR→QR, unstable timeline (QR≥20), chaos rolls (DR≥10/15).
      </div>
      <button onClick={onReconcile} disabled={reconciliationDone} style={{ ...styles.btnSm, opacity: reconciliationDone ? 0.45 : 1, cursor: reconciliationDone ? "not-allowed" : "pointer", pointerEvents: reconciliationDone ? "none" : "auto" }}>{reconciliationDone ? `✓ Reconciliation Complete for ${player?.name}` : `Run Reconciliation for ${player?.name}`}</button>

      {ecePending && (
        <div style={{ marginTop: 16, background: "#f8717122", border: "1px solid #f87171", borderRadius: 8, padding: 12 }}>
          <div style={{ color: "#f87171", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
            ⚠ Ethereal Chaos Event
          </div>
          <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 10 }}>
            All ECEs: initiator forfeits next turn. Choose your resolution:
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {[
              { key: "flush", label: "Nebula Flush",
                desc: "You lose all TB, SN, ToC. Others +5 QR, -2 DR. RC +2." },
              { key: "reset", label: "Nebula Reset ☢",
                desc: "EVERYONE (including you) resets all resources to 0. PNs lost. RC +10. Mutually assured destruction." },
              { key: "collapse", label: "Nebula Collapse",
                desc: "All players: +15 QR, +10 DR, -50% TB (round down), lose all SN over 5. RC +5." },
              { key: "fracture", label: "Nebula Fracture",
                desc: "Split players into Fissure A & B (you choose). Groups interact only within themselves for 2 rounds. Smaller group +5 QR each. RC +1/round for 2 rounds." },
              { key: "conflagration", label: "Nebula Conflagration",
                desc: "All PNs inactive for 1 round. Players with 4+ PNs must lose one of their choice. RC +4." },
              { key: "anrp", label: "⬡ Advanced Nebula Rescue Procedure",
                desc: "Attempt to rescue the Nebula instead. Costs 8 DR + 3 TB. Roll dice to determine outcome. High risk, potential RC reduction." },
            ].map(opt => {
              const isSelected = selectedECE === opt.key;
              return (
                <div key={opt.key}
                  onClick={() => setSelectedECE(isSelected ? null : opt.key)}
                  style={{
                    cursor: "pointer",
                    background: isSelected ? (opt.key === "reset" ? "#f8717122" : opt.key === "anrp" ? "#60a5fa22" : "#a78bfa22") : "#0a0f1a",
                    border: `1px solid ${isSelected ? (opt.key === "reset" ? "#f87171" : opt.key === "anrp" ? "#60a5fa" : "#a78bfa") : "#2a3147"}`,
                    borderRadius: 6, padding: "7px 10px",
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 700, fontSize: 12, color: isSelected ? (opt.key === "reset" ? "#f87171" : opt.key === "anrp" ? "#60a5fa" : "#a78bfa") : "#94a3b8" }}>
                      {isSelected ? "✓ " : ""}{opt.label}
                    </span>
                    {isSelected && <span style={{ color: "#475569", fontSize: 10 }}>selected</span>}
                  </div>
                  <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>{opt.desc}</div>
                </div>
              );
            })}
          </div>
          {selectedECE && (
            <div style={{ marginTop: 10 }}>
              <div style={{ color: "#f87171", fontSize: 11, marginBottom: 6 }}>
                ⚠ This cannot be undone. You will forfeit your next turn.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => { onResolveECE(selectedECE); setSelectedECE(null); }}
                  style={{ ...styles.btn, flex: 1, background: "#f8717122", borderColor: "#f87171", color: "#f87171" }}>
                  Trigger {["flush","reset","collapse","fracture","conflagration","anrp"].includes(selectedECE)
                    ? { flush:"Nebula Flush", reset:"Nebula Reset", collapse:"Nebula Collapse",
                        fracture:"Nebula Fracture", conflagration:"Nebula Conflagration", anrp:"ANRP" }[selectedECE]
                    : selectedECE}
                </button>
                <button onClick={() => setSelectedECE(null)} style={{ ...styles.btnSm, flex: 0 }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {player && (
        <div style={{ marginTop: 12, color: "#334155", fontSize: 12 }}>
          <div>QR≥20 (unstable timeline): {player.QR >= 20 ? "⚠ YES — skip next turn, -5 QR, -5 ToC" : "✓ OK"}</div>
          <div>DR≥10 (high DR warning): {player.DR >= 10 ? "⚠ Consider reducing DR" : "✓ OK"}</div>
          <div>ECE: triggered voluntarily in Weaving Phase by spending 15 QR.</div>
        </div>
      )}
    </div>
  );
}

function EndingPanel({ players, round, rc, monopolyRoundsInControl, monopolyLoggedThisRound, onUpdateMonopoly, onWinMonopoly }) {
  const resources = ["ToC", "DR", "SN", "QB", "TB"];
  const totals = {};
  ["ToC", "DR", "SN", "QR", "TB"].forEach(r => {
    totals[r] = players.reduce((s, p) => s + (p[r] || 0), 0);
  });

  // Dimensional Monopoly: sum of all PN outputs per player
  const globalPNProduction = players.reduce((sum, p) =>
    sum + p.pns.reduce((s2, pn) => s2 + pn.level, 0), 0);

  const playerShares = players.map(p => ({
    playerId: p.id,
    name: p.name,
    production: p.pns.reduce((s, pn) => s + pn.level, 0),
    share: globalPNProduction > 0
      ? ((p.pns.reduce((s, pn) => s + pn.level, 0) / globalPNProduction) * 100).toFixed(1)
      : "0.0",
  }));

  const sortedShares = [...playerShares].sort((a, b) => parseFloat(b.share) - parseFloat(a.share));
  const leader = sortedShares[0] || {};
  const runnerUp = sortedShares[1] || {};
  const leaderInControl = parseFloat(leader.share || 0) > 50 &&
    parseFloat(leader.share || 0) > parseFloat(runnerUp.share || 0);

  return (
    <div>
      <div style={{ color: "#64748b", fontSize: 12, marginBottom: 10 }}>
        Verify all resources and penalties. Update inflation. Check Dimensional Monopoly progress.
      </div>

      {/* Inflation tracker */}
      <div style={{ background: "#0a0f1a", borderRadius: 8, padding: 10, marginBottom: 12 }}>
        <div style={{ color: "#475569", fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>INFLATION STATUS</div>
        {["ToC","DR","SN","TB","QR"].map(r => {
          const threshold = INFLATION_THRESHOLDS[r];
          const total = totals[r];
          const tier = threshold ? getInflationTier(r, total) : "N/A";
          const tierColor = { Stable: "#4ade80", Moderate: "#fbbf24", High: "#fb923c", Severe: "#f87171" }[tier] || "#475569";
          return (
            <div key={r} style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, alignItems: "center" }}>
              <span style={{ color: RESOURCE_COLORS[r], fontSize: 12, minWidth: 32 }}>{r}</span>
              <span style={{ color: "#94a3b8", fontSize: 12 }}>{total} / {threshold || "—"}</span>
              {threshold && <span style={{ color: tierColor, fontSize: 11, fontWeight: 700 }}>{tier}</span>}
            </div>
          );
        })}
      </div>

      {/* Dimensional Monopoly */}
      <div style={{ background: "#0a0f1a", borderRadius: 8, padding: 10 }}>
        <div style={{ color: "#475569", fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>DIMENSIONAL MONOPOLY</div>
        <div style={{ color: "#334155", fontSize: 11, marginBottom: 8 }}>
          Win condition: control &gt;50% (outright majority, no ties) for 5 consecutive rounds.
          Current streak: <span style={{ color: "#fbbf24", fontWeight: 700 }}>{monopolyRoundsInControl}/5</span>
        </div>
        {globalPNProduction === 0 ? (
          <div style={{ color: "#334155", fontSize: 11 }}>No PNs in play yet.</div>
        ) : (
          <>
            {playerShares.map(ps => (
              <div key={ps.name} style={{ marginBottom: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ color: parseFloat(ps.share) >= 50 ? "#fbbf24" : "#64748b", fontSize: 12 }}>{ps.name}</span>
                  <span style={{ color: parseFloat(ps.share) >= 50 ? "#fbbf24" : "#475569", fontWeight: 700, fontSize: 12 }}>{ps.share}%</span>
                </div>
                <div style={{ background: "#1a2235", borderRadius: 2, height: 4 }}>
                  <div style={{ width: `${Math.min(100, parseFloat(ps.share))}%`, height: 4, borderRadius: 2,
                    background: parseFloat(ps.share) >= 50 ? "#fbbf24" : "#334155" }} />
                </div>
              </div>
            ))}
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              {monopolyLoggedThisRound ? (
                <div style={{ color: "#4ade80", fontSize: 12 }}>✓ Monopoly streak updated for this round.</div>
              ) : (
                <button
                  onClick={() => {
                    const newRounds = leaderInControl ? monopolyRoundsInControl + 1 : 0;
                    onUpdateMonopoly(newRounds);
                    if (newRounds >= 5) onWinMonopoly(leader?.playerId);
                  }}
                  style={{ ...styles.btnSm, borderColor: "#fbbf24", color: "#fbbf24" }}
                >
                  {leaderInControl ? `✓ ${leader?.name} in control → +1 streak` : "✗ No one in control → reset streak"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}


// ─── PHASE RULES REFERENCE ──────────────────────────────────────────────────
const PHASE_RULES = {
  Preliminary: {
    summary: "Calculate RC and weaving coefficients. Happens ONCE per round, before the first player's turn.",
    rules: [
      "RC formula (standard): RC = Base RC + R² where R is the round number.",
      "Coefficient formula: Scaling Factor = ((Usage / Possible Usage) − 0.6)². If usage > 50%, subtract factor (overuse penalty). If < 50%, add factor (neglect bonus).",
      "Players may opt to skip their entire turn to reduce their QR by 10.",
      "Preliminary Phase is resolved once before the first player acts — not repeated each turn.",
    ],
  },
  "Resource Collection": {
    summary: "Collect PN resources, then roll 2d6.",
    rules: [
      "Step 1: Collect any resources from your Production Nodes.",
      "Step 2: Roll both d6 dice. Sum 2–5 → +3 ToC. Sum 6–8 → +2 DR. Sum 9–10 → +2 SN. Sum 11–12 → +1 TB.",
    ],
  },
  Merging: {
    summary: "Buy PNs, trade, build alliances, propose GRCPs.",
    rules: [
      "This is the phase for purchasing Production Nodes.",
      "Players may trade resources, make public offers, bribe, or form alliances.",
      "A GRCP (Game Rule Change Proposal) can ONLY be initiated during a player's Merging Phase.",
      "At the END of this phase, note your current resource totals for Possible Usage tracking (used next round for coefficient calculation).",
    ],
  },
  Weaving: {
    summary: "Choose: take 3 actions OR attempt to weave a Tapestry of Reality. Not both.",
    rules: [
      "Take up to 3 actions from the action list, spending resources for each.",
      "Or attempt to Weave a ToR: WS = (α×TB + β×SN + γ×ToC) / (δ×DR + ε×QR).",
      "DR and QR are auto-applied from your current totals and are NOT spent on the weave.",
      "PT = ceil(1.5 × (WS / ToRST) × 100). Roll d100 ≤ PT to succeed.",
      "QR graduated penalty: 7–9 QR: −3% PT. 10–12: −6%. 13–15: −10%. 16–18: −15%. 19: −20%.",
      "Success: +1 ToR, RC −2 next round. Pay committed TB/SN/ToC. DR/QR not paid.",
      "Failure: lose committed TB/SN/ToC, RC +1. DR/QR not paid.",
      "Alliances and Bribery also happen during this phase.",
    ],
  },
  Reconciliation: {
    summary: "Resolve DR/QR penalties and chaos rolls.",
    rules: [
      "For every 5 DR you have, gain 1 QR.",
      "If you have 20+ QR: Unstable Timeline — forfeit next turn, lose 5 QR and 5 ToC.",
      "ECE is now triggered voluntarily during the Weaving Phase by spending 15 QR (action: Trigger Ethereal Chaos Event).",
      "High DR (≥10) is flagged as a warning during Reconciliation — reduce it with actions.",
      "ECE options: Nebula Flush (lose all TB/SN/ToC; others +5 QR; RC+1), Nebula Reset (others reset to 0; you +5ToC+1TB+3SN, skip next turn; RC+2), Nebula Collapse (all +25%DR, +15%QR, −⅔ToC, −⅓SN; RC+3).",
    ],
  },
  Ending: {
    summary: "Verify resources and update inflation tracker.",
    rules: [
      "Ensure all resources are accurate and all penalties have been applied.",
      "Update any manual notes, alliances, and table trackers that changed this round.",
      "Update the inflation tracker with total resource production this round.",
      "Inflation tiers: Stable (≤ threshold), Moderate (≤ 1.5×), High (≤ 2×), Severe (> 2×). PN efficiency: 100% / 90% / 75% / 50%.",
    ],
  },
};

function PhaseRulesPanel({ phase, grcp }) {
  const [open, setOpen] = useState(false);
  const rules = PHASE_RULES[phase];
  if (!rules) return null;
  const relevantGRCPs = grcp.filter(g =>
    g.affectedPhase === phase || g.affectedPhase === "All"
  );
  return (
    <div style={{ marginTop: 16 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        ...styles.btnSm,
        width: "100%",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "7px 12px",
        background: open ? "#1a2235" : "transparent",
      }}>
        <span>📖 {phase} Phase — Rules Reference</span>
        <span style={{ color: "#475569" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ background: "#0a0f1a", border: "1px solid #1e2535", borderRadius: "0 0 8px 8px", padding: 12 }}>
          <div style={{ color: "#a78bfa", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{rules.summary}</div>
          {rules.rules.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 5 }}>
              <span style={{ color: "#334155", fontSize: 11, marginTop: 1 }}>◈</span>
              <span style={{ color: "#64748b", fontSize: 12 }}>{r}</span>
            </div>
          ))}
          {relevantGRCPs.length > 0 && (
            <div style={{ marginTop: 10, borderTop: "1px solid #2a3147", paddingTop: 8 }}>
              <div style={{ color: "#fbbf24", fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>⚑ ACTIVE RULE CHANGES (GRCP)</div>
              {relevantGRCPs.map(g => (
                <div key={g.id} style={{ background: "#fbbf2411", border: "1px solid #fbbf2433", borderRadius: 5, padding: "6px 10px", marginBottom: 4 }}>
                  <div style={{ color: "#fbbf24", fontSize: 11, fontWeight: 700 }}>Rule: {g.rule}</div>
                  <div style={{ color: "#94a3b8", fontSize: 11 }}>→ Changed to: {g.change}</div>
                  <div style={{ color: "#475569", fontSize: 10 }}>Reason: {g.reason} · Round {g.round}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── GRCP TRACKER ─────────────────────────────────────────────────────────────
const PHASE_OPTIONS = ["All", "Preliminary", "Resource Collection", "Merging", "Weaving", "Reconciliation", "Ending", "Weaving Rules", "Inflation", "ECE", "Other"];

function GRCPPanel({ grcp, setState, log, round }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ rule: "", change: "", reason: "", affectedPhase: "All" });
  const [adding, setAdding] = useState(false);

  function addGRCP() {
    if (!form.rule.trim() || !form.change.trim()) return;
    const entry = { ...form, id: Date.now(), round };
    setState(s => ({ ...s, grcp: [...s.grcp, entry] }));
    log(`⚑ GRCP added: "${form.rule}" → "${form.change}"`, "event");
    setForm({ rule: "", change: "", reason: "", affectedPhase: "All" });
    setAdding(false);
  }

  function removeGRCP(id) {
    setState(s => ({ ...s, grcp: s.grcp.filter(g => g.id !== id) }));
  }

  return (
    <div style={{ borderTop: "1px solid #1e2535", paddingTop: 10, marginBottom: 10 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        ...styles.btnSm, width: "100%", display: "flex", justifyContent: "space-between",
        background: "transparent", marginBottom: open ? 6 : 0,
      }}>
        <span style={{ color: grcp.length > 0 ? "#fbbf24" : "#64748b" }}>
          ⚑ Rule Changes ({grcp.length})
        </span>
        <span style={{ color: "#475569" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div>
          {grcp.length === 0 && (
            <div style={{ color: "#334155", fontSize: 11, marginBottom: 6 }}>No rule changes yet.</div>
          )}
          {grcp.map(g => (
            <div key={g.id} style={{ background: "#fbbf2411", border: "1px solid #fbbf2422", borderRadius: 5, padding: "6px 8px", marginBottom: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#fbbf24", fontSize: 11, fontWeight: 700 }}>{g.rule}</span>
                <button onClick={() => removeGRCP(g.id)} style={{ ...btnSmStyle("#1a2235","#2a3147"), color: "#f87171", width: "auto", padding: "0 5px", fontSize: 10 }}>✕</button>
              </div>
              <div style={{ color: "#94a3b8", fontSize: 11 }}>→ {g.change}</div>
              <div style={{ color: "#475569", fontSize: 10 }}>{g.affectedPhase} · Round {g.round}{g.reason ? ` · ${g.reason}` : ""}</div>
            </div>
          ))}
          {!adding ? (
            <button onClick={() => setAdding(true)} style={{ ...styles.btnSm, marginTop: 4, width: "100%" }}>+ Log GRCP</button>
          ) : (
            <div style={{ background: "#0a0f1a", borderRadius: 6, padding: 10, marginTop: 4 }}>
              <div style={{ color: "#fbbf24", fontSize: 11, fontWeight: 700, marginBottom: 6 }}>New Rule Change</div>
              <div style={{ background:"#101827", border:"1px solid #1f2937", borderRadius:6, padding:8, marginBottom:8, color:"#94a3b8", fontSize:10 }}>
                <div><b>GRCP Sandbox Guide</b></div>
                <div>All = global rule affecting every phase.</div>
                <div>Other = social / bookkeeping / victory rules not tied to a phase.</div>
                <div>For action-cost changes, record the COMPLETE replacement cost in the change field.</div>
                <div>Examples:</div>
                <div>• SA1 cost becomes: 4 ToC + 2 DR</div>
                <div>• Remove DR requirement from Upgrade PN</div>
                <div>• Weaving attempts limited to once per round</div>
              </div>
              <input placeholder="Original rule (brief)" value={form.rule}
                onChange={e => setForm(f => ({...f, rule: e.target.value}))} style={styles.input} />
              <input placeholder="New rule / change" value={form.change}
                onChange={e => setForm(f => ({...f, change: e.target.value}))} style={styles.input} />
              <input placeholder="Reason (optional)" value={form.reason}
                onChange={e => setForm(f => ({...f, reason: e.target.value}))} style={styles.input} />
              <div style={{ color: "#475569", fontSize: 10, marginBottom: 4 }}>Affects phase:</div>
              <select value={form.affectedPhase} onChange={e => setForm(f => ({...f, affectedPhase: e.target.value}))}
                style={{ ...styles.input, marginBottom: 8 }}>
                {PHASE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={addGRCP} style={{ ...styles.btnSm, flex: 1, borderColor: "#fbbf24", color: "#fbbf24" }}>Save</button>
                <button onClick={() => setAdding(false)} style={{ ...styles.btnSm, flex: 1 }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ROUND INTRO OVERLAY ─────────────────────────────────────────────────────
function RoundIntroOverlay({ round, rc, coefficients, prevCoefficients, prevUsagePct, players, prevResourceUsage, prevPossibleUsage, grcp, onDismiss }) {
  const torst = calcToRST(rc);
  const resources = ["ToC","DR","SN","TB","QR"];

  // Inflation status this round
  const inflationStatus = resources.map(r => {
    const threshold = INFLATION_THRESHOLDS[r];
    if (!threshold) return null;
    const total = players.reduce((s, p) => s + (p[r]||0), 0);
    const tier = getInflationTier(r, total);
    return { r, total, threshold, tier };
  }).filter(Boolean);

  const activeGRCPs = grcp.filter(g => g.overrides && g.overrides.length > 0);

  // Coefficient change explanation
  const coeffMap = [["alpha","TB"],["beta","SN"],["gamma","ToC"],["delta","DR"],["epsilon","QR"]];
  const coeffChanges = coeffMap.map(([k, res]) => {
    const cur = coefficients[k];
    const prev = prevCoefficients?.[k];
    const pct = prevUsagePct?.[res];
    const isBoost = ["alpha","beta","gamma"].includes(k);
    const meta = COEFF_META[k];
    let delta = prev != null ? cur - prev : 0;
    const displayDelta = isBoost ? delta : -delta;
    let explanation = "";
    if (pct === null || pct === undefined) {
      explanation = "No usage data — coefficient unchanged from last round.";
    } else if (pct === 0) {
      explanation = `${res} was not spent at all (0%) — strong neglect bonus. Coefficient pushed further from base.`;
    } else if (pct > 50) {
      explanation = `${res} was heavily used (${pct}%) — overuse penalty. Coefficient pulled toward base.`;
    } else if (pct < 50) {
      explanation = `${res} was lightly used (${pct}%) — neglect bonus. Coefficient pushed further from base.`;
    } else {
      explanation = `${res} usage was exactly 50% — minimal change.`;
    }
    return { k, res, cur, prev, delta, displayDelta, pct, isBoost, meta, explanation };
  });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "#000000cc", display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }}>
      <div style={{
        background: "#0f1624", border: "1px solid #2a3147", borderRadius: 12,
        padding: 28, maxWidth: 560, width: "100%", maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 24px 64px #000000cc",
      }}>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: "#a78bfa", marginBottom: 4 }}>
          Round {round} Begins
        </div>
        <div style={{ color: "#334155", fontSize: 12, marginBottom: 20 }}>
          Here's everything you need to know heading into this round.
        </div>

        {/* RC + ToRST */}
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, background: "#0a0f1a", borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ color: "#f87171", fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>REALITY CONSTANT</div>
            <div style={{ color: "#f87171", fontWeight: 700, fontSize: 28 }}>{rc.toFixed(1)}</div>
            <div style={{ background: "#1a2235", borderRadius: 3, height: 5, marginTop: 6 }}>
              <div style={{ width: `${Math.min(100, rc)}%`, height: 5, borderRadius: 3,
                background: rc >= 75 ? "#f87171" : rc >= 50 ? "#fbbf24" : "#4ade80" }} />
            </div>
          </div>
          <div style={{ flex: 1, background: "#0a0f1a", borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ color: "#a78bfa", fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>WEAVE THRESHOLD (ToRST)</div>
            <div style={{ color: "#a78bfa", fontWeight: 700, fontSize: 28 }}>{torst.toFixed(3)}</div>
            <div style={{ color: "#475569", fontSize: 11, marginTop: 4 }}>Your WS must exceed this to have any chance.</div>
          </div>
        </div>

        {/* Coefficients with change explanations */}
        <div style={{ background: "#0a0f1a", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
          <div style={{ color: "#64748b", fontSize: 10, letterSpacing: 1, marginBottom: 8 }}>WEAVING COEFFICIENTS THIS ROUND</div>
          {coeffChanges.map(({ k, res, cur, prev, delta, displayDelta, pct, isBoost, meta, explanation }) => (
            <div key={k} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ color: meta.color, fontSize: 12, fontWeight: 700 }}>
                  {isBoost ? "↑" : "↓"} {res}
                  <span style={{ color: "#475569", fontWeight: 400, fontSize: 10 }}> {meta.label}</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {prev != null && Math.abs(displayDelta) > 0.0001 && (
                    <span style={{ color: displayDelta > 0 ? "#4ade80" : "#f87171", fontSize: 10 }}>
                      {displayDelta > 0 ? "▲" : "▼"}{Math.abs(delta).toFixed(3)}
                    </span>
                  )}
                  <span style={{ color: meta.color, fontWeight: 700, fontSize: 14 }}>
                    {isBoost ? "+" : "−"}{cur.toFixed(3)}
                  </span>
                </span>
              </div>
              <div style={{ color: "#334155", fontSize: 10, marginLeft: 12 }}>
                {pct !== null && pct !== undefined
                  ? <span><span style={{ color: pct > 50 ? "#f87171" : pct < 50 ? "#60a5fa" : "#4ade80" }}>{pct}% used last round</span> — {explanation}</span>
                  : <span>{explanation}</span>
                }
              </div>
              <div style={{ background: "#1a2235", borderRadius: 2, height: 3, marginTop: 4 }}>
                <div style={{ width: `${Math.min(100, (cur / 3) * 100)}%`, height: 3, borderRadius: 2, background: meta.color, opacity: 0.5 }} />
              </div>
            </div>
          ))}
        </div>

        {/* Inflation */}
        <div style={{ background: "#0a0f1a", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
          <div style={{ color: "#64748b", fontSize: 10, letterSpacing: 1, marginBottom: 8 }}>INFLATION STATUS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {inflationStatus.map(({ r, total, threshold, tier }) => {
              const tierColor = { Stable: "#4ade80", Moderate: "#fbbf24", High: "#fb923c", Severe: "#f87171" }[tier] || "#475569";
              return (
                <div key={r} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: RESOURCE_COLORS[r], fontSize: 12 }}>{r}</span>
                  <span style={{ color: "#475569", fontSize: 11 }}>{total}/{threshold}</span>
                  <span style={{ color: tierColor, fontSize: 11, fontWeight: 700 }}>{tier}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Player standings */}
        <div style={{ background: "#0a0f1a", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
          <div style={{ color: "#64748b", fontSize: 10, letterSpacing: 1, marginBottom: 8 }}>PLAYER STANDINGS</div>
          {[...players].sort((a,b) => b.tor - a.tor).map(p => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
              <span style={{ color: "#e2e8f0", fontSize: 13 }}>{p.name}</span>
              <div style={{ display: "flex", gap: 10 }}>
                <span style={{ color: "#4ade80", fontSize: 12 }}>ToR {p.tor}/3</span>
                <span style={{ color: p.QR >= 13 ? "#f87171" : p.QR >= 7 ? "#fbbf24" : "#475569", fontSize: 12 }}>QR {p.QR}</span>
                <span style={{ color: "#60a5fa", fontSize: 12 }}>{p.pns.length} PN{p.pns.length !== 1 ? "s" : ""}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Active GRCPs */}
        {activeGRCPs.length > 0 && (
          <div style={{ background: "#fbbf2411", border: "1px solid #fbbf2433", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
            <div style={{ color: "#fbbf24", fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>ACTIVE RULE CHANGES</div>
            {activeGRCPs.map(g => (
              <div key={g.id} style={{ color: "#94a3b8", fontSize: 11, marginBottom: 3 }}>
                ⚑ {g.rule} → {g.change}
              </div>
            ))}
          </div>
        )}

        <button onClick={onDismiss} style={{ ...styles.btn, width: "100%", fontSize: 14, padding: "12px 0" }}>
          Begin Round {round} →
        </button>
      </div>
    </div>
  );
}

// ─── COEFFICIENT DROPDOWN (header widget) ────────────────────────────────────
function CoeffDropdown({ coefficients }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} style={{
        ...styles.btnSm,
        borderColor: open ? "#a78bfa" : "#2a3147",
        color: open ? "#a78bfa" : "#64748b",
        fontSize: 11,
        padding: "3px 10px",
      }}>
        ⚖ Coefficients {open ? "▲" : "▼"}
      </button>
      {open && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 100,
          background: "#0f1624", border: "1px solid #2a3147", borderRadius: 8,
          padding: "10px 14px", minWidth: 230, boxShadow: "0 8px 32px #00000088",
        }}>
          <div style={{ color: "#64748b", fontSize: 10, letterSpacing: 1, marginBottom: 8 }}>CURRENT WEAVING COEFFICIENTS</div>
          {Object.entries(coefficients).map(([k, v]) => {
            const meta = COEFF_META[k];
            const isBoost = ["alpha","beta","gamma"].includes(k);
            const bar = Math.min(100, (v / 3) * 100);
            return (
              <div key={k} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ color: meta.color, fontSize: 12 }}>
                    {isBoost ? "↑" : "↓"} {meta.resource}
                    <span style={{ color: "#475569", fontWeight: 400, fontSize: 10 }}> {meta.label}</span>
                  </span>
                  <span style={{ color: meta.color, fontWeight: 700, fontSize: 13 }}>
                    {isBoost ? "+" : "−"}{v.toFixed(3)}
                  </span>
                </div>
                <div style={{ background: "#1a2235", borderRadius: 2, height: 3 }}>
                  <div style={{ width: `${bar}%`, height: 3, borderRadius: 2, background: meta.color, opacity: 0.6 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = {
  root: {
    background: "#070d1a",
    minHeight: "100vh",
    color: "#e2e8f0",
    fontFamily: "'DM Mono', 'Courier New', monospace",
    fontSize: 13,
  },
  header: {
    background: "#0a0f1a",
    borderBottom: "1px solid #1e2535",
    padding: "10px 20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  body: {
    display: "grid",
    gridTemplateColumns: "280px 1fr 240px",
    gap: 0,
    height: "calc(100vh - 50px)",
  },
  leftPanel: {
    borderRight: "1px solid #1e2535",
    padding: "14px 12px",
    overflowY: "auto",
    background: "#080e1b",
  },
  centerPanel: {
    overflowY: "auto",
    padding: "14px 20px",
  },
  rightPanel: {
    borderLeft: "1px solid #1e2535",
    padding: "14px 12px",
    background: "#080e1b",
    display: "flex",
    flexDirection: "column",
    overflowY: "hidden",
  },
  phaseHeader: {
    marginBottom: 14,
  },
  phaseBox: {
    background: "#0a0f1a",
    border: "1px solid #1e2535",
    borderRadius: 10,
    padding: 18,
  },
  card: {
    background: "#0f1624",
    border: "1px solid #1e2535",
    borderRadius: 8,
    padding: "10px 12px",
  },
  label: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
    display: "block",
  },
  input: {
    background: "#0a0f1a",
    border: "1px solid #2a3147",
    borderRadius: 5,
    color: "#e2e8f0",
    padding: "6px 10px",
    fontSize: 13,
    width: "100%",
    boxSizing: "border-box",
    marginBottom: 8,
    fontFamily: "inherit",
  },
  btn: {
    background: "#a78bfa22",
    border: "1px solid #a78bfa",
    color: "#a78bfa",
    borderRadius: 6,
    padding: "8px 16px",
    cursor: "pointer",
    fontSize: 13,
    fontFamily: "'DM Mono', monospace",
    fontWeight: 700,
  },
  btnSm: {
    background: "#1a2235",
    border: "1px solid #2a3147",
    color: "#94a3b8",
    borderRadius: 5,
    padding: "5px 12px",
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "'DM Mono', monospace",
  },
};
