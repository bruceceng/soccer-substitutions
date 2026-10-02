// =============================================================================
// MAIN UI APPLICATION SCRIPT
// =============================================================================
// Controls worker creation, Plotly chart updates, and schedule UI rendering.
// =============================================================================

const SHIFT_MINUTES = 6;

const timbresRoster = [
  { id: 'Jesse', name: 'Jesse', active: true, goaliePref: 'preferred', gkScore: 3, defScore: 3, midScore: 4, fwdScore: 3 },
  { id: 'Ellis', name: 'Ellis', active: true, goaliePref: 'preferred', gkScore: 3, defScore: 3, midScore: 3, fwdScore: 4 },
  { id: 'Bennet', name: 'Bennet', active: true, goaliePref: 'preferred', gkScore: 2, defScore: 3, midScore: 2, fwdScore: 3 },
  { id: 'Diego', name: 'Diego', active: true, goaliePref: 'preferred', gkScore: 3, defScore: 3, midScore: 3, fwdScore: 5 },
  { id: 'London', name: 'London', active: true, goaliePref: 'refuses', gkScore: 0, defScore: 3, midScore: 3, fwdScore: 3 },
  { id: 'Kyton', name: 'Kyton', active: true, goaliePref: 'preferred', gkScore: 3, defScore: 3, midScore: 2, fwdScore: 2 },
  { id: 'Vivian', name: 'Vivian', active: true, goaliePref: 'refuses', gkScore: 0, defScore: 3, midScore: 3, fwdScore: 3 },
  { id: 'Isabelle', name: 'Isabelle', active: true, goaliePref: 'refuses', gkScore: 0, defScore: 3, midScore: 2, fwdScore: 2 },
  { id: 'Olivia', name: 'Olivia', active: true, goaliePref: 'refuses', gkScore: 0, defScore: 3, midScore: 3, fwdScore: 4 },
  { id: 'Elena', name: 'Elena', active: true, goaliePref: 'refuses', gkScore: 0, defScore: 3, midScore: 2, fwdScore: 2 }
];

let worker = null;
let chartData = { x: [], y: [] };
let isAutoRunning = false;

/**
 * Extracts tuned meta-parameters from the UI controls.
 */
function getMetaParams() {
  return {
    popSize: parseInt(document.getElementById('metaPopSize')?.value, 10) || 150,
    mutationRate: parseFloat(document.getElementById('metaMutationRate')?.value) ?? 0.35,
    elitismRate: parseFloat(document.getElementById('metaElitismRate')?.value) ?? 0.15,
    immigrantRate: parseFloat(document.getElementById('metaImmigrantRate')?.value) ?? 0.10,
    stagnationThreshold: parseInt(document.getElementById('metaStagnation')?.value, 10) || 35,
    localSearchMax: parseInt(document.getElementById('metaLocalSearch')?.value, 10) || 8
  };
}

/**
 * Initializes or returns the existing Web Worker instance.
 */
function getWorker() {
  if (!worker) {
    const blob = new Blob([window.workerCode], { type: 'application/javascript' });
    worker = new Worker(URL.createObjectURL(blob));

    worker.onmessage = function(e) {
      const { bestPlan, totalGenerations, fitness, elapsedMs, history } = e.data;

      // Append generation history points for Plotly
      history.forEach(function(pt) {
        chartData.x.push(pt.gen);
        chartData.y.push(pt.fitness);
      });

      updateChart();
      renderScheduleOutput(bestPlan, totalGenerations, fitness, elapsedMs);

      // Continuously trigger next step when auto-run mode is enabled
      if (isAutoRunning) {
        setTimeout(function() {
          if (isAutoRunning) {
            stepOptimization(300);
          }
        }, 50);
      }
    };
  }
  return worker;
}

/**
 * Sets up the initial Plotly.js chart container.
 */
function initChart() {
  chartData = { x: [], y: [] };

  const trace = {
    x: [],
    y: [],
    type: 'scatter',
    mode: 'lines',
    line: { color: '#2563eb', width: 2 },
    name: 'Best Fitness'
  };

  const layout = {
    title: { text: 'GA Fitness Convergence', font: { size: 14 } },
    margin: { l: 45, r: 20, t: 35, b: 35 },
    xaxis: { title: 'Generation', autorange: true },
    yaxis: { title: 'Fitness Score', autorange: true },
    hovermode: 'closest'
  };

  Plotly.newPlot('fitnessChart', [trace], layout, { 
    responsive: true, 
    displayModeBar: false 
  });
}

/**
 * Updates the existing Plotly graph with newly generated fitness points.
 */
function updateChart() {
  Plotly.react('fitnessChart', [{
    x: [...chartData.x],
    y: [...chartData.y],
    type: 'scatter',
    mode: 'lines',
    line: { color: '#2563eb', width: 2 }
  }], {
    title: { text: 'GA Fitness Convergence', font: { size: 14 } },
    margin: { l: 45, r: 20, t: 35, b: 35 },
    xaxis: { title: 'Generation', autorange: true },
    yaxis: { title: 'Fitness Score', autorange: true }
  });
}

/**
 * Starts a fresh optimization process from generation 0.
 */
function startNewOptimization() {
  stopAutoRun();
  initChart();

  getWorker().postMessage({
    action: 'init',
    roster: timbresRoster,
    weights: { defense: 1.0, mid: 1.0, forward: 1.8, goalie: 1.0 },
    positions: ['D', 'D', 'M', 'M', 'F'],
    fieldPlayersPerShift: 5,
    timeBudgetMs: 350,
    metaParams: getMetaParams()
  });
}

/**
 * Advances the current population state by a specific time budget.
 */
function stepOptimization(ms) {
  if (!ms) {
    ms = 300;
  }

  getWorker().postMessage({
    action: 'step',
    roster: timbresRoster,
    weights: { defense: 1.0, mid: 1.0, forward: 1.8, goalie: 1.0 },
    positions: ['D', 'D', 'M', 'M', 'F'],
    fieldPlayersPerShift: 5,
    timeBudgetMs: ms,
    metaParams: getMetaParams()
  });
}

/**
 * Toggles continuous GA optimization on and off.
 */
function toggleAutoRun() {
  const btn = document.getElementById('btnAuto');

  if (isAutoRunning) {
    stopAutoRun();
  } else {
    isAutoRunning = true;
    if (btn) {
      btn.innerText = 'Pause Continuous';
    }
    stepOptimization(300);
  }
}

/**
 * Halts auto-running optimization cycles.
 */
function stopAutoRun() {
  isAutoRunning = false;
  const btn = document.getElementById('btnAuto');
  if (btn) {
    btn.innerText = 'Auto Run (Continuous)';
  }
}

/**
 * Formats the optimized schedule solution into structured JSON for display.
 */
function renderScheduleOutput(bestPlan, totalGenerations, fitness, elapsedMs) {
  const statusEl = document.getElementById('status');
  const outputEl = document.getElementById('output');

  if (statusEl) {
    statusEl.textContent = 'Generations: ' + totalGenerations + 
      ' | Fitness: ' + fitness.toFixed(1) + 
      ' (' + elapsedMs.toFixed(1) + ' ms step)';
  }

  if (outputEl && bestPlan) {
    const shiftNames = ['Q1-1', 'Q1-2', 'Q2-1', 'Q2-2', 'Q3-1', 'Q3-2', 'Q4-1', 'Q4-2'];
    let formattedSchedule = {};
    let playerMetrics = {};

    timbresRoster.forEach(function(p) {
      playerMetrics[p.id] = {
        GoalKeeperMins: 0,
        DefenseMins: 0,
        MidfieldMins: 0,
        ForwardMins: 0,
        TotalMins: 0
      };
    });

    for (let i = 0; i < 8; i++) {
      const q = Math.floor(i / 2);
      const gk = bestPlan.goalieGene[q];
      const field = bestPlan.shiftGenes[i];

      formattedSchedule[shiftNames[i]] = {
        K: gk,
        D_l: field[0],
        D_r: field[1],
        M_l: field[2],
        M_r: field[3],
        F: field[4]
      };

      playerMetrics[gk].GoalKeeperMins += SHIFT_MINUTES;
      playerMetrics[gk].TotalMins += SHIFT_MINUTES;

      playerMetrics[field[0]].DefenseMins += SHIFT_MINUTES;
      playerMetrics[field[1]].DefenseMins += SHIFT_MINUTES;
      playerMetrics[field[2]].MidfieldMins += SHIFT_MINUTES;
      playerMetrics[field[3]].MidfieldMins += SHIFT_MINUTES;
      playerMetrics[field[4]].ForwardMins += SHIFT_MINUTES;

      [field[0], field[1], field[2], field[3], field[4]].forEach(function(id) {
        playerMetrics[id].TotalMins += SHIFT_MINUTES;
      });
    }

    outputEl.textContent = JSON.stringify({
      Schedule: formattedSchedule,
      PlayerMinutesMetrics: playerMetrics
    }, null, 2);
  }
}

// Bind DOM event listeners on load
document.addEventListener('DOMContentLoaded', function() {
  initChart();

  document.getElementById('btnInit')?.addEventListener('click', startNewOptimization);
  document.getElementById('btnStep')?.addEventListener('click', function() {
    stopAutoRun();
    stepOptimization(500);
  });
  document.getElementById('btnAuto')?.addEventListener('click', toggleAutoRun);
});