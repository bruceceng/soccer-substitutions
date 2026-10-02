// ============================================================================
// 1. EXHAUSTIVE SEARCH SUBGAME SCHEDULER (Web Worker Scope)
// ============================================================================
function exhaustiveSearchWorkerScope() {
  const FIELD_POSITIONS = ["D_l", "D_r", "M_l", "M_r", "F"];
  const ALL_PLAYERS = [
    "Jesse", "Ellis", "Diego", "Elena", "Bennet", 
    "London", "Kyton", "Vivian", "Isabelle", "Olivia"
  ];

  const ALLOWED_GKS = ["Diego", "Bennet", "Ellis", "Kyton", "London"];

  const GAME_TARGETS = {
    Jesse: 30, Ellis: 30, Diego: 30, Elena: 30, Bennet: 30,
    London: 30, Vivian: 30, Olivia: 30, Kyton: 24, Isabelle: 24
  };

  function permutations(arr, k) {
    if (k === 0) return [[]];
    let result = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      permutations(rest, k - 1).forEach(p => {
        result.push([arr[i], ...p]);
      });
    }
    return result;
  }

  function getGoalieSequences(remainingQuarters, pastGks = []) {
    const qCount = remainingQuarters.length;
    if (qCount === 0) return [[]];
    const possibleGks = ALLOWED_GKS.filter(g => !pastGks.includes(g));
    const gkPerms = permutations(possibleGks, qCount);
    
    return gkPerms.map(perm => {
      let mapping = {};
      remainingQuarters.forEach((qNum, idx) => {
        mapping[qNum] = perm[idx];
      });
      return mapping;
    });
  }

  function evaluateSchedule(schedule, context) {
    const totals = { ...context.pastMinutes };
    const posCounts = {};
    const gkCounts = {};
    
    ALL_PLAYERS.forEach(p => {
      posCounts[p] = { gk: 0, def: 0, off: 0 };
      gkCounts[p] = 0;
    });

    let score = 0;

    Object.entries(schedule).forEach(([shiftKey, roles]) => {
      Object.entries(roles).forEach(([pos, player]) => {
        totals[player] = (totals[player] || 0) + 6;
        if (pos === "GK") {
          posCounts[player].gk += 6;
          gkCounts[player] = (gkCounts[player] || 0) + 1;
        } else if (pos.startsWith("D")) {
          posCounts[player].def += 6;
        } else {
          posCounts[player].off += 6;
        }
      });
    });

    ALL_PLAYERS.forEach(p => {
      const target = GAME_TARGETS[p];
      const diff = totals[p] - target;
      if (diff > 0) {
        score -= Math.pow(diff, 2) * 20000;
      } else if (diff < 0) {
        score -= Math.abs(diff) * 10000;
      }
    });

    Object.values(gkCounts).forEach(count => {
      if (count >= 3) score -= 1000000;
      else if (count === 2) score -= 5000;
    });

    return { score, totals, posCounts };
  }

  self.onmessage = function (e) {
    const context = e.data;
    const startTime = performance.now();

    const remainingQuarters = context.remainingQuarters;
    const goalieSeqs = getGoalieSequences(remainingQuarters);

    let bestSchedule = null;
    let bestTotals = null;
    let bestPosCounts = null;
    let maxScore = -Infinity;

    goalieSeqs.forEach(gkMap => {
      const candidateSchedule = {};
      let validBranch = true;

      remainingQuarters.forEach(qNum => {
        const gk = gkMap[qNum];
        const nonGks = ALL_PLAYERS.filter(p => p !== gk);

        const eligibleForField = nonGks.filter(p => {
          const currentTotal = (context.pastMinutes[p] || 0);
          return currentTotal < GAME_TARGETS[p];
        });

        const activeFieldPool = eligibleForField.length >= 5 ? eligibleForField : nonGks;
        const shift1Players = activeFieldPool.slice(0, 5);
        
        if (shift1Players.length < 5) {
          validBranch = false;
          return;
        }

        candidateSchedule[`Q${qNum}-1`] = {
          GK: gk,
          D_l: shift1Players[0],
          D_r: shift1Players[1],
          M_l: shift1Players[2],
          M_r: shift1Players[3],
          F:   shift1Players[4]
        };

        const maxSubs = (qNum === 4) ? 5 : 1;
        const shift2Players = [...shift1Players];

        if (maxSubs > 0 && nonGks.length > 5) {
          const benchPlayers = nonGks.filter(p => !shift1Players.includes(p));
          if (benchPlayers.length > 0) {
            shift2Players[0] = benchPlayers[0]; 
          }
        }

        candidateSchedule[`Q${qNum}-2`] = {
          GK: gk,
          D_l: shift2Players[0],
          D_r: shift2Players[1],
          M_l: shift2Players[2],
          M_r: shift2Players[3],
          F:   shift2Players[4]
        };
      });

      if (validBranch) {
        const evalResult = evaluateSchedule(candidateSchedule, context);
        if (evalResult.score > maxScore) {
          maxScore = evalResult.score;
          bestSchedule = candidateSchedule;
          bestTotals = evalResult.totals;
          bestPosCounts = evalResult.posCounts;
        }
      }
    });

    const durationMs = (performance.now() - startTime).toFixed(1);

    self.postMessage({
      bestScore: maxScore,
      durationMs,
      schedule: bestSchedule,
      totals: bestTotals,
      posCounts: bestPosCounts
    });
  };
}

// ============================================================================
// 2. WORKER INITIALIZATION VIA BLOB
// ============================================================================
function createInlineWorker(workerFunc) {
  const code = `(${workerFunc.toString()})();`;
  const blob = new Blob([code], { type: "application/javascript" });
  return new Worker(URL.createObjectURL(blob));
}

const worker = createInlineWorker(exhaustiveSearchWorkerScope);

// ============================================================================
// 3. UI CONTROLLER & DOM BINDINGS
// ============================================================================
const ALL_PLAYERS = [
  "Jesse", "Ellis", "Diego", "Elena", "Bennet", 
  "London", "Kyton", "Vivian", "Isabelle", "Olivia"
];

const GAME_TARGETS = {
  Jesse: 30, Ellis: 30, Diego: 30, Elena: 30, Bennet: 30,
  London: 30, Vivian: 30, Olivia: 30, Kyton: 24, Isabelle: 24
};

const POS_LABELS = ["GK", "Left Def (D_l)", "Right Def (D_r)", "Left Mid (M_l)", "Right Mid (M_r)", "Forward (F)"];

const defaultPast = {
  Jesse: 32, Ellis: 12, Diego: 12, Elena: 12, Bennet: 12,
  London: 12, Kyton: 6, Vivian: 12, Isabelle: 12, Olivia: 12
};

document.addEventListener("DOMContentLoaded", () => {
  renderPastMinutesInputs();
  document.getElementById("addPinBtn").addEventListener("click", () => addPinRow());
  document.getElementById("runBtn").addEventListener("click", runOptimization);
  addPinRow(3, 5, "Diego");
});

function renderPastMinutesInputs() {
  const container = document.getElementById("pastMinutesInputs");
  container.innerHTML = "";
  ALL_PLAYERS.forEach(p => {
    const div = document.createElement("div");
    div.innerHTML = `
      <label>${p}</label>
      <input type="number" id="past_${p}" value="${defaultPast[p] || 0}" step="6" min="0" max="999">
    `;
    container.appendChild(div);
  });
}

function addPinRow(q = 3, pos = 5, pId = "Diego") {
  const container = document.getElementById("pinsList");
  const row = document.createElement("div");
  row.className = "pin-row";
  
  row.innerHTML = `
    <select class="pin-q">
      <option value="1" ${q === 1 ? 'selected' : ''}>Q1</option>
      <option value="2" ${q === 2 ? 'selected' : ''}>Q2</option>
      <option value="3" ${q === 3 ? 'selected' : ''}>Q3</option>
      <option value="4" ${q === 4 ? 'selected' : ''}>Q4</option>
    </select>
    <select class="pin-pos">
      ${POS_LABELS.map((lbl, idx) => `<option value="${idx}" ${pos === idx ? 'selected' : ''}>${lbl}</option>`).join('')}
    </select>
    <select class="pin-player">
      ${ALL_PLAYERS.map(p => `<option value="${p}" ${pId === p ? 'selected' : ''}>${p}</option>`).join('')}
    </select>
    <button type="button" onclick="this.parentElement.remove()" style="width: auto; margin:0; background:#ef4444;">X</button>
  `;
  container.appendChild(row);
}

function gatherContext() {
  const remainingQuarters = document.getElementById("remainingQuarters").value
    .split(",").map(Number);
  
  const pastMinutes = {};
  ALL_PLAYERS.forEach(p => {
    pastMinutes[p] = Number(document.getElementById(`past_${p}`).value) || 0;
  });

  const pins = [];
  document.querySelectorAll(".pin-row").forEach(row => {
    pins.push({
      quarter: Number(row.querySelector(".pin-q").value),
      posIdx: Number(row.querySelector(".pin-pos").value),
      playerId: row.querySelector(".pin-player").value
    });
  });

  return { remainingQuarters, pastMinutes, pins };
}

function runOptimization() {
  const context = gatherContext();
  document.getElementById("metricsOutput").innerText = "Running Exhaustive Subgame Search...";
  worker.postMessage(context);
}

worker.onmessage = function (e) {
  const { bestScore, durationMs, schedule, totals, posCounts } = e.data;

  document.getElementById("metricsOutput").innerHTML = 
    `Status: Complete | Time: <strong>${durationMs} ms</strong> | Score: <strong>${bestScore}</strong>`;

  renderScheduleTable(schedule);
  renderMinutesTable(totals, posCounts);
};

function renderScheduleTable(schedule) {
  const container = document.getElementById("scheduleTableContainer");
  let html = `<table>
    <thead>
      <tr>
        <th>Shift</th><th>GK</th><th>D_l</th><th>D_r</th><th>M_l</th><th>M_r</th><th>F</th>
      </tr>
    </thead>
    <tbody>`;

  Object.entries(schedule).forEach(([shiftKey, roles]) => {
    html += `<tr>
      <td><strong>${shiftKey}</strong></td>
      <td>${roles.GK}</td>
      <td>${roles.D_l}</td>
      <td>${roles.D_r}</td>
      <td>${roles.M_l}</td>
      <td>${roles.M_r}</td>
      <td>${roles.F}</td>
    </tr>`;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}

function renderMinutesTable(totals, posCounts) {
  const container = document.getElementById("minutesTableContainer");
  let html = `<table>
    <thead>
      <tr>
        <th>Player</th><th>Past+New Total</th><th>Target</th><th>Diff</th><th>Def Mins</th><th>Off Mins</th>
      </tr>
    </thead>
    <tbody>`;

  ALL_PLAYERS.forEach(p => {
    const tot = totals[p] || 0;
    const tgt = GAME_TARGETS[p];
    const diff = tot - tgt;
    const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
    const diffColor = diff === 0 ? "color: green;" : "color: red;";

    html += `<tr>
      <td><strong>${p}</strong></td>
      <td>${tot}m</td>
      <td>${tgt}m</td>
      <td style="${diffColor} font-weight:bold;">${diffStr}m</td>
      <td>${posCounts[p].def}m</td>
      <td>${posCounts[p].off}m</td>
    </tr>`;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}