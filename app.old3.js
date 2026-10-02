// ============================================================================
// 1. WEB WORKER DEFINITION (Hierarchical Fitness Engine)
// ============================================================================
function gaWorkerScope() {
  const FIELD_POSITIONS = ["D_l", "D_r", "M_l", "M_r", "F"];
  const ALL_PLAYERS = [
    "Jesse", "Ellis", "Diego", "Elena", "Bennet", 
    "London", "Kyton", "Vivian", "Isabelle", "Olivia"
  ];

  // Pool of players eligible/willing to play Goalkeeper
  const ALLOWED_GKS = ["Diego", "Bennet", "Ellis", "London", "Kyton"];

  const GAME_TARGETS = {
    Jesse: 30, Ellis: 30, Diego: 30, Elena: 30, Bennet: 30,
    London: 30, Vivian: 30, Olivia: 30, Kyton: 24, Isabelle: 24
  };

  function getRandomElement(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function buildMask(context) {
    const mask = {};
    context.remainingQuarters.forEach(qNum => {
      mask[qNum] = { gk: false, baseLineup: [false, false, false, false, false] };
    });

    (context.pins || []).forEach(pin => {
      if (mask[pin.quarter]) {
        if (pin.posIdx === 0) mask[pin.quarter].gk = true;
        else if (pin.posIdx >= 1 && pin.posIdx <= 5) mask[pin.quarter].baseLineup[pin.posIdx - 1] = true;
      }
    });

    return mask;
  }

  function createRandomQuarterBlock(qNum, context, mask) {
    let available = shuffle([...ALL_PLAYERS]);
    let gk = null;
    const baseLineup = new Array(5).fill(null);

    // 1. Process pinned positions
    (context.pins || []).forEach(pin => {
      if (pin.quarter === qNum) {
        if (pin.posIdx === 0) gk = pin.playerId;
        else if (pin.posIdx >= 1 && pin.posIdx <= 5) baseLineup[pin.posIdx - 1] = pin.playerId;
      }
    });

    const assigned = [gk, ...baseLineup].filter(Boolean);
    available = available.filter(p => !assigned.includes(p));

    // 2. Assign Goalkeeper from ALLOWED_GKS pool only
    if (!gk) {
      const validGkCandidates = available.filter(p => ALLOWED_GKS.includes(p));
      if (validGkCandidates.length > 0) {
        gk = getRandomElement(validGkCandidates);
      } else {
        gk = available.pop();
      }
      available = available.filter(p => p !== gk);
    }

    // 3. Assign Field Positions
    for (let i = 0; i < 5; i++) {
      if (!baseLineup[i]) baseLineup[i] = available.pop();
    }

    // 4. Optional Sub/Swap
    let swap = null;
    if (context.maxSwapsPerQuarter > 0 && Math.random() < 0.4) {
      const unpinnedPositions = [];
      for (let i = 0; i < 5; i++) {
        if (!mask[qNum].baseLineup[i]) unpinnedPositions.push(i);
      }

      if (unpinnedPositions.length > 0 && available.length > 0) {
        swap = {
          offPosIdx: getRandomElement(unpinnedPositions),
          onPlayer: getRandomElement(available)
        };
      }
    }

    return { quarterNum: qNum, gk, baseLineup, swap };
  }

  function decodeChromosome(chromosome, context) {
    const schedule = {};
    const totals = { ...context.pastMinutes };
    const posCounts = {};
    const futureMinutes = {};

    ALL_PLAYERS.forEach(p => { 
      posCounts[p] = { gk: 0, def: 0, off: 0 }; 
      futureMinutes[p] = 0;
    });

    chromosome.quarters.forEach(q => {
      const qName = `Q${q.quarterNum}`;
      
      const shift1 = { GK: q.gk };
      q.baseLineup.forEach((p, idx) => { shift1[FIELD_POSITIONS[idx]] = p; });

      const shift2 = { ...shift1 };
      if (q.swap) {
        const swappedPos = FIELD_POSITIONS[q.swap.offPosIdx];
        shift2[swappedPos] = q.swap.onPlayer;
      }

      schedule[`${qName}-1`] = shift1;
      schedule[`${qName}-2`] = shift2;

      [shift1, shift2].forEach(shift => {
        Object.entries(shift).forEach(([pos, player]) => {
          totals[player] = (totals[player] || 0) + 6;
          futureMinutes[player] = (futureMinutes[player] || 0) + 6;
          if (pos === "GK") posCounts[player].gk += 6;
          else if (pos.startsWith("D")) posCounts[player].def += 6;
          else posCounts[player].off += 6;
        });
      });
    });

    return { schedule, totals, posCounts, futureMinutes };
  }

  // ==========================================================================
  // HIERARCHICAL FITNESS FUNCTION
  // Tier 1: Asymmetric Target Minutes Math (Hard Constraint)
  // Tier 2: GK Rotation Rules & Pool Enforcement
  // Tier 3: Position Balance (Soft Constraint)
  // Tier 4: Sub Penalty
  // ==========================================================================
  function evaluateFitness(chromosome, context) {
    const { totals, posCounts, futureMinutes } = decodeChromosome(chromosome, context);
    let score = 0;

    // --- TIER 1: ASYMMETRIC MINUTES FAIRNESS ---
    ALL_PLAYERS.forEach(p => {
      const target = GAME_TARGETS[p];
      const diff = totals[p] - target;

      if (diff > 0) {
        // Squared penalty for overplaying (e.g. +6m = -360,000 penalty points)
        score -= Math.pow(diff, 2) * 10000;
      } else if (diff < 0) {
        // Standard linear penalty for unavoidable game deficits
        score -= Math.abs(diff) * 10000;
      }
    });

    // --- TIER 2: GOALKEEPER ROTATION MANDATES ---
    const gkQuarterCounts = {};
    chromosome.quarters.forEach(q => {
      gkQuarterCounts[q.gk] = (gkQuarterCounts[q.gk] || 0) + 1;
      
      // Heavy penalty if a non-allowed player ends up in goal
      if (!ALLOWED_GKS.includes(q.gk)) {
        score -= 100000;
      }
    });

    Object.entries(gkQuarterCounts).forEach(([player, count]) => {
      if (count >= 3) {
        // HARD MANDATE: Never 3 or 4 quarters in goal
        score -= 500000;
      } else if (count === 2) {
        // SOFT PREFERENCE: Heavily penalize repeating GK if single-quarter option exists
        score -= 2000;
      }
    });

    // --- TIER 3: POSITION BALANCE ---
    ALL_PLAYERS.forEach(p => {
      if (futureMinutes[p] >= 12) {
        if (posCounts[p].def === 0) score -= 20;
        if (posCounts[p].off === 0) score -= 20;
      }
    });

    // --- TIER 4: SUB PENALTY ---
    chromosome.quarters.forEach(q => {
      if (q.swap !== null) score -= 5;
    });

    return score;
  }

  function mutate(chromosome, context, mask) {
    const mutated = JSON.parse(JSON.stringify(chromosome));
    const qIdx = Math.floor(Math.random() * mutated.quarters.length);
    const qBlock = mutated.quarters[qIdx];
    const qNum = qBlock.quarterNum;

    const mutationType = Math.random();

    if (mutationType < 0.4) {
      const freeIndices = [0, 1, 2, 3, 4].filter(i => !mask[qNum].baseLineup[i]);
      if (freeIndices.length >= 2) {
        const idx1 = getRandomElement(freeIndices);
        let idx2 = getRandomElement(freeIndices);
        while (idx1 === idx2) idx2 = getRandomElement(freeIndices);
        
        const temp = qBlock.baseLineup[idx1];
        qBlock.baseLineup[idx1] = qBlock.baseLineup[idx2];
        qBlock.baseLineup[idx2] = temp;
      }
    } else if (mutationType < 0.7) {
      if (qBlock.swap) {
        qBlock.swap = null;
      } else if (context.maxSwapsPerQuarter > 0) {
        const freeIndices = [0, 1, 2, 3, 4].filter(i => !mask[qNum].baseLineup[i]);
        if (freeIndices.length > 0) {
          const onField = [qBlock.gk, ...qBlock.baseLineup];
          const bench = ALL_PLAYERS.filter(p => !onField.includes(p));
          if (bench.length > 0) {
            qBlock.swap = {
              offPosIdx: getRandomElement(freeIndices),
              onPlayer: getRandomElement(bench)
            };
          }
        }
      }
    } else {
      if (!mask[qNum].gk) {
        const onField = qBlock.baseLineup;
        const candidates = ALLOWED_GKS.filter(p => !onField.includes(p) && p !== qBlock.gk);
        if (candidates.length > 0) {
          qBlock.gk = getRandomElement(candidates);
        }
      }
    }

    return mutated;
  }

  self.onmessage = function (e) {
    const context = e.data;
    const generations = 1500;
    const popSize = 60;
    const mask = buildMask(context);

    let population = Array.from({ length: popSize }, () => ({
      quarters: context.remainingQuarters.map(qNum => createRandomQuarterBlock(qNum, context, mask))
    }));

    let best = population[0];
    let bestScore = evaluateFitness(best, context);
    const startTime = performance.now();

    for (let gen = 0; gen < generations; gen++) {
      population.sort((a, b) => evaluateFitness(b, context) - evaluateFitness(a, context));
      
      if (evaluateFitness(population[0], context) > bestScore) {
        best = JSON.parse(JSON.stringify(population[0]));
        bestScore = evaluateFitness(best, context);
      }

      const nextGen = population.slice(0, popSize / 2);
      while (nextGen.length < popSize) {
        const parent = getRandomElement(nextGen);
        nextGen.push(mutate(parent, context, mask));
      }
      population = nextGen;
    }

    const durationMs = (performance.now() - startTime).toFixed(1);
    const decoded = decodeChromosome(best, context);

    self.postMessage({
      best,
      bestScore,
      durationMs,
      schedule: decoded.schedule,
      totals: decoded.totals,
      posCounts: decoded.posCounts
    });
  };
}

// ============================================================================
// 2. DYNAMIC WORKER INSTANTIATION VIA BLOB URL
// ============================================================================
function createInlineWorker(workerFunc) {
  const code = `(${workerFunc.toString()})();`;
  const blob = new Blob([code], { type: "application/javascript" });
  return new Worker(URL.createObjectURL(blob));
}

const worker = createInlineWorker(gaWorkerScope);

// ============================================================================
// 3. UI CONTROLLER & DOM HANDLERS
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

  // Default test pin: Diego to Forward in Q3
  addPinRow(3, 5, "Diego");
});

function renderPastMinutesInputs() {
  const container = document.getElementById("pastMinutesInputs");
  container.innerHTML = "";
  ALL_PLAYERS.forEach(p => {
    const div = document.createElement("div");
    div.innerHTML = `
      <label>${p}</label>
      <input type="number" id="past_${p}" value="${defaultPast[p] || 0}" step="6" min="0" max="48">
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
  
  const maxSwapsPerQuarter = Number(document.getElementById("maxSwaps").value);

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

  return { remainingQuarters, pastMinutes, pins, maxSwapsPerQuarter };
}

function runOptimization() {
  const context = gatherContext();
  document.getElementById("metricsOutput").innerText = "Running GA Optimization in Worker thread...";
  worker.postMessage(context);
}

worker.onmessage = function (e) {
  const { bestScore, durationMs, schedule, totals, posCounts } = e.data;

  document.getElementById("metricsOutput").innerHTML = 
    `Status: Complete | Time: <strong>${durationMs} ms</strong> | Fitness Score: <strong>${bestScore}</strong>`;

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