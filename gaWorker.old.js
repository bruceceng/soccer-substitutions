window.workerCode = `
// =============================================================================
// U8 SOCCER LINEUP OPTIMIZER - ENHANCED GENETIC ALGORITHM WORKER
// =============================================================================
// Features:
// - Continuous state persistence across execution steps
// - Memetic Local Search ("The Polisher"): Deterministic 2-Opt hill-climbing
// - Adaptive Cataclysms: Triggers epoch population restarts on stagnation
// - Uniform Crossover: Dynamic 50/50 quarter gene inheritance
// - Random Immigrants (10% per generation) & Shift-Swap Mutations
// - Multi-phase feasibility repair engine
// =============================================================================

// Persistent state across execution step calls
let population = [];
let totalGenerationsCount = 0;
let globalBestChromosome = null;
let globalBestFitness = -Infinity;
let stagnationCounter = 0;

/**
 * Main Web Worker Message Event Listener
 */
self.onmessage = function(e) {
  const { 
    action = 'init', 
    roster, 
    weights = {}, 
    startShift = 0, 
    timeBudgetMs = 350,
    fieldPlayersPerShift = 5, 
    positions = ['D', 'D', 'M', 'M', 'F']
  } = e.data;
  
  const startTime = performance.now();
  const goaliePool = roster.filter(function(p) {
    return p.active && p.goaliePref !== 'refuses';
  });
  const POP_SIZE = 150;

  // ---------------------------------------------------------------------------
  // 1. POPULATION INITIALIZATION AND RESET
  // ---------------------------------------------------------------------------
  if (action === 'init' || population.length === 0) {
    population = [];
    totalGenerationsCount = 0;
    globalBestChromosome = null;
    globalBestFitness = -Infinity;
    stagnationCounter = 0;

    for (let i = 0; i < POP_SIZE; i++) {
      population.push(
        generateRandomChromosome(roster, goaliePool, startShift, fieldPlayersPerShift)
      );
    }
  }

  let generationsInStep = 0;
  let history = [];

  // ---------------------------------------------------------------------------
  // 2. MAIN EVOLUTIONARY GENERATION LOOP
  // ---------------------------------------------------------------------------
  while (performance.now() - startTime < timeBudgetMs) {
    generationsInStep++;
    totalGenerationsCount++;

    let stepImproved = false;

    // Evaluate fitness across current population
    for (let i = 0; i < population.length; i++) {
      let chromo = population[i];

      // Enforce physical constraints prior to scoring
      repairChromosome(chromo, roster, goaliePool, fieldPlayersPerShift);
      chromo.fitness = evaluateFitness(chromo, roster, weights, startShift, positions);
      
      // Maintain persistent global best across all execution steps
      if (chromo.fitness > globalBestFitness) {
        globalBestFitness = chromo.fitness;
        globalBestChromosome = JSON.parse(JSON.stringify(chromo));
        stepImproved = true;
      }
    }

    // -------------------------------------------------------------------------
    // A. MEMETIC LOCAL SEARCH: Polish global best when a breakthrough occurs
    // -------------------------------------------------------------------------
    if (stepImproved && globalBestChromosome) {
      globalBestChromosome = localSearchPolish(
        globalBestChromosome, 
        roster, 
        weights, 
        startShift, 
        positions, 
        fieldPlayersPerShift
      );
      globalBestFitness = globalBestChromosome.fitness;
      stagnationCounter = 0;
    } else {
      stagnationCounter++;
    }

    // Record fitness trajectory for UI charting
    history.push({
      gen: totalGenerationsCount,
      fitness: globalBestFitness
    });

    // -------------------------------------------------------------------------
    // B. ADAPTIVE CATACLYSM: Reboot population if stuck for 35 generations
    // -------------------------------------------------------------------------
    if (stagnationCounter >= 35 && globalBestChromosome) {
      stagnationCounter = 0;

      const freshPop = [JSON.parse(JSON.stringify(globalBestChromosome))];
      while (freshPop.length < POP_SIZE) {
        freshPop.push(
          generateRandomChromosome(roster, goaliePool, startShift, fieldPlayersPerShift)
        );
      }
      population = freshPop;
      continue; // Jump directly to next generation step
    }

    // Rank population in descending order of fitness
    population.sort(function(a, b) {
      return b.fitness - a.fitness;
    });

    const nextGen = [];

    // C. ELITISM: Retain top 15% (22 chromosomes)
    const eliteCount = Math.floor(POP_SIZE * 0.15);
    for (let i = 0; i < eliteCount; i++) {
      nextGen.push(JSON.parse(JSON.stringify(population[i])));
    }

    // D. FRESH BLOOD / IMMIGRATION: Inject 10% brand-new random chromosomes
    const immigrantCount = Math.floor(POP_SIZE * 0.10);
    for (let i = 0; i < immigrantCount; i++) {
      nextGen.push(
        generateRandomChromosome(roster, goaliePool, startShift, fieldPlayersPerShift)
      );
    }

    // E. REPRODUCTION: Fill remaining 75% via uniform crossover and mutation
    while (nextGen.length < POP_SIZE) {
      const parentA = selectParent(population);
      const parentB = selectParent(population);
      
      let child = uniformCrossover(parentA, parentB, startShift);

      // 35% Mutation Rate to maintain diversity
      if (Math.random() < 0.35) {
        child = mutate(child, roster, goaliePool, startShift, fieldPlayersPerShift);
      }

      nextGen.push(child);
    }

    population = nextGen;
  }

  // Final repair pass on best chromosome before posting back to UI
  if (globalBestChromosome) {
    repairChromosome(globalBestChromosome, roster, goaliePool, fieldPlayersPerShift);
  }

  // Post metrics and optimized plan back to main application
  self.postMessage({
    bestPlan: globalBestChromosome,
    generationsInStep: generationsInStep,
    totalGenerations: totalGenerationsCount,
    elapsedMs: performance.now() - startTime,
    fitness: globalBestFitness,
    history: history
  });
};

/**
 * Memetic Local Search: Systematically tests player swaps to hill-climb local optima.
 */
function localSearchPolish(chromo, roster, weights, startShift, positions, fieldCount) {
  let polished = JSON.parse(JSON.stringify(chromo));
  let bestScore = evaluateFitness(polished, roster, weights, startShift, positions);

  let improved = true;
  let iterations = 0;

  while (improved && iterations < 8) {
    improved = false;
    iterations++;

    for (let s1 = startShift; s1 < 8; s1++) {
      for (let s2 = s1 + 1; s2 < 8; s2++) {
        const q1GK = polished.goalieGene[Math.floor(s1 / 2)];
        const q2GK = polished.goalieGene[Math.floor(s2 / 2)];

        let line1 = polished.shiftGenes[s1];
        let line2 = polished.shiftGenes[s2];

        for (let i = 0; i < line1.length; i++) {
          for (let j = 0; j < line2.length; j++) {
            const p1 = line1[i];
            const p2 = line2[j];

            // Skip invalid swaps (same player or player is currently Goalie in target shift)
            if (p1 === p2 || line1.includes(p2) || line2.includes(p1)) continue;
            if (p2 === q1GK || p1 === q2GK) continue;

            // Execute test swap
            line1[i] = p2;
            line2[j] = p1;

            let testScore = evaluateFitness(polished, roster, weights, startShift, positions);

            if (testScore > bestScore) {
              bestScore = testScore;
              improved = true;
              break;
            } else {
              // Revert swap if no fitness improvement
              line1[i] = p1;
              line2[j] = p2;
            }
          }
          if (improved) break;
        }
        if (improved) break;
      }
      if (improved) break;
    }
  }

  polished.fitness = bestScore;
  return polished;
}

/**
 * Generates a randomized initial schedule.
 */
function generateRandomChromosome(roster, goaliePool, startShift, fieldCount) {
  let goalieGene = [];
  let availableGoalies = [...goaliePool];
  shuffleArray(availableGoalies);

  // Assign one goalkeeper per quarter
  for (let q = 0; q < 4; q++) {
    if (availableGoalies[q]) {
      goalieGene.push(availableGoalies[q].id);
    } else {
      goalieGene.push(roster[q % roster.length].id);
    }
  }

  let shiftGenes = [];
  const activePlayers = roster.filter(function(p) {
    return p.active;
  });

  // Assign field players for all 8 shifts (2 shifts per quarter)
  for (let q = 0; q < 4; q++) {
    const qGK = goalieGene[q];
    
    let fieldCandidates = activePlayers.filter(function(p) {
      return p.id !== qGK;
    });
    shuffleArray(fieldCandidates);

    let shift1 = fieldCandidates.slice(0, fieldCount).map(function(p) {
      return p.id;
    });
    
    let shift2 = [...shift1];

    shiftGenes.push(shift1);
    shiftGenes.push(shift2);
  }

  return {
    goalieGene: goalieGene,
    shiftGenes: shiftGenes
  };
}

/**
 * Evaluates total fitness score of a lineup solution based on tactical rules.
 */
function evaluateFitness(chromo, roster, weights, startShift, positions) {
  let score = 0;
  let playerStats = {};
  let goalieQuarterCounts = {};

  roster.filter(function(p) { return p.active; }).forEach(function(p) {
    playerStats[p.id] = {
      totalShifts: 0,
      dShifts: 0,
      mShifts: 0,
      fShifts: 0,
      timeline: []
    };
    goalieQuarterCounts[p.id] = 0;
  });

  for (let q = 0; q < 4; q++) {
    const gkId = chromo.goalieGene[q];
    if (goalieQuarterCounts[gkId] !== undefined) {
      goalieQuarterCounts[gkId]++;
    }
  }

  // RULE 1: Goalie Fairness Cap (Max 1 quarter per player)
  Object.keys(goalieQuarterCounts).forEach(function(pId) {
    if (goalieQuarterCounts[pId] > 1) {
      score -= 1000 * (goalieQuarterCounts[pId] - 1);
    }
  });

  // Evaluate each of the 8 shifts
  for (let s = startShift; s < 8; s++) {
    const q = Math.floor(s / 2);
    const gkId = chromo.goalieGene[q];
    const field = chromo.shiftGenes[s];
    const activeThisShift = new Set([gkId, ...field]);

    Object.keys(playerStats).forEach(function(pId) {
      if (activeThisShift.has(pId)) {
        playerStats[pId].timeline.push(1);
        playerStats[pId].totalShifts++;
      } else {
        playerStats[pId].timeline.push(0);
      }
    });

    const gkPlayer = roster.find(function(p) { return p.id === gkId; });
    if (gkPlayer) {
      score += (gkPlayer.gkScore || 3) * (weights.goalie || 1.0) * 2.0;
    }

    // RULE 2 & 3: Defensive Anchor and Position-Specific Scoring
    let maxFieldDefScore = 0;

    field.forEach(function(pId, posIdx) {
      const player = roster.find(function(p) { return p.id === pId; });
      if (!player) return;

      const pDef = player.defScore || 3;
      if (pDef > maxFieldDefScore) {
        maxFieldDefScore = pDef;
      }

      const role = positions[posIdx] || 'M';

      if (role === 'D') {
        playerStats[pId].dShifts++;
        score += pDef * (weights.defense || 1.0);
      } else if (role === 'F') {
        playerStats[pId].fShifts++;
        score += (player.fwdScore || 3) * (weights.forward || 1.5);
      } else {
        playerStats[pId].mShifts++;
        score += (player.midScore || 3) * (weights.mid || 1.0);
      }
    });

    if (maxFieldDefScore < 4) {
      score -= 200;
    } else {
      score += maxFieldDefScore * 10;
    }
  }

  // RULE 4: Minimize mid-quarter field substitutions
  for (let q = 0; q < 4; q++) {
    const s1 = q * 2;
    const s2 = q * 2 + 1;

    if (s1 >= startShift) {
      const field1 = new Set(chromo.shiftGenes[s1]);
      const field2 = new Set(chromo.shiftGenes[s2]);

      field1.forEach(function(pId) {
        if (!field2.has(pId)) {
          score -= 150;
        }
      });
    }
  }

  // RULE 5: Positional Equity and Fatigue Rules
  Object.keys(playerStats).forEach(function(pId) {
    const stats = playerStats[pId];

    if (stats.dShifts === 0) {
      score -= 500;
    }
    if ((stats.mShifts + stats.fShifts) === 0) {
      score -= 500;
    }

    let currentBenchStreak = 0;
    let currentPlayStreak = 0;

    stats.timeline.forEach(function(status, idx) {
      if (status === 0) {
        currentBenchStreak++;
        if (currentPlayStreak >= 5) {
          score -= 100;
        }
        currentPlayStreak = 0;
      } else {
        currentPlayStreak++;
        if (currentBenchStreak > 2) {
          score -= 250;
        }
        currentBenchStreak = 0;
      }

      if (idx > 0 && stats.timeline[idx - 1] === 1 && status === 1) {
        score += 60;
      }
    });

    if (currentBenchStreak > 2) {
      score -= 250;
    }
  });

  return score;
}

/**
 * 3-Way Tournament Selection
 */
function selectParent(pop) {
  const a = pop[Math.floor(Math.random() * pop.length)];
  const b = pop[Math.floor(Math.random() * pop.length)];
  const c = pop[Math.floor(Math.random() * pop.length)];

  return [a, b, c].sort(function(x, y) {
    return y.fitness - x.fitness;
  })[0];
}

/**
 * Uniform Crossover: Dynamically decides per-quarter which parent to inherit from
 */
function uniformCrossover(parentA, parentB, startShift) {
  let child = JSON.parse(JSON.stringify(parentA));

  for (let q = 0; q < 4; q++) {
    const s1 = q * 2;
    const s2 = q * 2 + 1;

    if (Math.random() < 0.50) {
      child.goalieGene[q] = parentB.goalieGene[q];

      if (s1 >= startShift) {
        child.shiftGenes[s1] = [...parentB.shiftGenes[s1]];
      }
      if (s2 >= startShift) {
        child.shiftGenes[s2] = [...parentB.shiftGenes[s2]];
      }
    }
  }

  return child;
}

/**
 * Multi-Mode Mutation Operator
 */
function mutate(chromo, roster, goaliePool, startShift, fieldCount) {
  let mutated = JSON.parse(JSON.stringify(chromo));
  const roll = Math.random();

  if (roll < 0.25) {
    // MUTATION TYPE 1: Swap Goalie Assignment
    const targetQ = Math.floor(Math.random() * 4);
    const currentGoalies = new Set(mutated.goalieGene);
    
    const available = goaliePool.filter(function(p) {
      return !currentGoalies.has(p.id);
    });

    if (available.length > 0) {
      mutated.goalieGene[targetQ] = available[
        Math.floor(Math.random() * available.length)
      ].id;
    }

  } else if (roll < 0.60) {
    // MUTATION TYPE 2: Player Shift Swap (Preserves shift counts)
    const sA = startShift + Math.floor(Math.random() * (8 - startShift));
    const sB = startShift + Math.floor(Math.random() * (8 - startShift));

    if (sA !== sB && mutated.shiftGenes[sA].length > 0 && mutated.shiftGenes[sB].length > 0) {
      const idxA = Math.floor(Math.random() * mutated.shiftGenes[sA].length);
      const idxB = Math.floor(Math.random() * mutated.shiftGenes[sB].length);

      const pA = mutated.shiftGenes[sA][idxA];
      const pB = mutated.shiftGenes[sB][idxB];

      if (!mutated.shiftGenes[sB].includes(pA) && !mutated.shiftGenes[sA].includes(pB)) {
        mutated.shiftGenes[sA][idxA] = pB;
        mutated.shiftGenes[sB][idxB] = pA;
      }
    }

  } else {
    // MUTATION TYPE 3: Randomize Entire Quarter Lineup
    const targetQ = Math.floor(Math.random() * 4);
    const s1 = targetQ * 2;
    const s2 = targetQ * 2 + 1;

    if (s1 >= startShift) {
      const qGK = mutated.goalieGene[targetQ];
      
      const activePlayers = roster.filter(function(p) {
        return p.active && p.id !== qGK;
      });
      shuffleArray(activePlayers);

      const newField = activePlayers.slice(0, fieldCount).map(function(p) {
        return p.id;
      });

      mutated.shiftGenes[s1] = [...newField];
      mutated.shiftGenes[s2] = [...newField];
    }
  }

  return mutated;
}

/**
 * Feasibility Repair Engine
 */
function repairChromosome(chromo, roster, goaliePool, fieldPlayersPerShift) {
  const activePlayers = roster.filter(function(p) {
    return p.active;
  }).map(function(p) {
    return p.id;
  });

  const numActive = activePlayers.length;
  const totalOnField = 1 + fieldPlayersPerShift;

  if (numActive < totalOnField) return;

  const totalSlots = 8 * totalOnField;
  const minShifts = Math.floor(totalSlots / numActive);
  const maxShifts = Math.ceil(totalSlots / numActive);

  // PHASE 1: Goalie Deduplication Repair
  const validGKIds = goaliePool.map(function(p) { return p.id; });
  let usedGKs = [];

  for (let q = 0; q < 4; q++) {
    let currentGK = chromo.goalieGene[q];

    if (!validGKIds.includes(currentGK) || usedGKs.includes(currentGK)) {
      const availableGK = validGKIds.find(function(id) {
        return !usedGKs.includes(id);
      });

      if (availableGK) {
        chromo.goalieGene[q] = availableGK;
      }
    }
    usedGKs.push(chromo.goalieGene[q]);
  }

  // PHASE 2: Clear Active Goalie from Field Lineups
  for (let s = 0; s < 8; s++) {
    const q = Math.floor(s / 2);
    const qGK = chromo.goalieGene[q];
    let shift = chromo.shiftGenes[s];

    let validField = [];
    let seen = new Set([qGK]);

    for (let i = 0; i < shift.length; i++) {
      let pId = shift[i];
      if (!seen.has(pId) && activePlayers.includes(pId)) {
        validField.push(pId);
        seen.add(pId);
      }
    }

    while (validField.length < fieldPlayersPerShift) {
      const candidate = activePlayers.find(function(id) {
        return !seen.has(id);
      });

      if (!candidate) break;

      validField.push(candidate);
      seen.add(candidate);
    }

    chromo.shiftGenes[s] = validField.slice(0, fieldPlayersPerShift);
  }

  // PHASE 3: Equal Playing Time Balancing Loop
  let safety = 0;

  while (safety < 100) {
    safety++;

    let counts = {};
    activePlayers.forEach(function(id) {
      counts[id] = 0;
    });

    for (let s = 0; s < 8; s++) {
      const q = Math.floor(s / 2);
      counts[chromo.goalieGene[q]]++;
      chromo.shiftGenes[s].forEach(function(id) {
        counts[id]++;
      });
    }

    let overplayedIds = activePlayers.filter(function(id) {
      return counts[id] > maxShifts;
    });
    let underplayedIds = activePlayers.filter(function(id) {
      return counts[id] < minShifts;
    });

    if (overplayedIds.length === 0 && underplayedIds.length === 0) break;

    let swapped = false;

    // Attempt swapping full 12-minute quarter blocks first
    for (let i = 0; i < overplayedIds.length; i++) {
      let donorId = overplayedIds[i];

      for (let q = 0; q < 4; q++) {
        const s1 = q * 2;
        const s2 = q * 2 + 1;
        const qGK = chromo.goalieGene[q];

        let f1 = chromo.shiftGenes[s1];
        let f2 = chromo.shiftGenes[s2];

        if (f1.includes(donorId) && f2.includes(donorId) && counts[donorId] >= minShifts + 2) {
          let recipientId = activePlayers.find(function(id) { 
            return counts[id] <= maxShifts - 2 && 
                   id !== qGK && 
                   !f1.includes(id) && 
                   !f2.includes(id);
          });

          if (recipientId) {
            f1[f1.indexOf(donorId)] = recipientId;
            f2[f2.indexOf(donorId)] = recipientId;
            swapped = true;
            break;
          }
        }
      }

      if (swapped) break;
    }

    // Single-shift swap fallback
    if (!swapped) {
      for (let i = 0; i < overplayedIds.length; i++) {
        let donorId = overplayedIds[i];

        for (let s = 0; s < 8; s++) {
          const q = Math.floor(s / 2);
          const qGK = chromo.goalieGene[q];
          let field = chromo.shiftGenes[s];

          if (field.includes(donorId)) {
            let recipientId = activePlayers.find(function(id) {
              return counts[id] < maxShifts && id !== qGK && !field.includes(id);
            });

            if (recipientId) {
              field[field.indexOf(donorId)] = recipientId;
              swapped = true;
              break;
            }
          }
        }

        if (swapped) break;
      }
    }

    if (!swapped) break;
  }
}

/**
 * Fisher-Yates Array Shuffle Utility
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
}
`;