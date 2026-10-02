// Worker logic running isolated on background thread
const FIELD_POSITIONS = ["D_l", "D_r", "M_l", "M_r", "F"];
const ALL_PLAYERS = [
  "Jesse", "Ellis", "Diego", "Elena", "Bennet", 
  "London", "Kyton", "Vivian", "Isabelle", "Olivia"
];

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
    mask[qNum] = {
      gk: false,
      baseLineup: [false, false, false, false, false]
    };
  });

  (context.pins || []).forEach(pin => {
    if (mask[pin.quarter]) {
      if (pin.posIdx === 0) {
        mask[pin.quarter].gk = true;
      } else if (pin.posIdx >= 1 && pin.posIdx <= 5) {
        mask[pin.quarter].baseLineup[pin.posIdx - 1] = true;
      }
    }
  });

  return mask;
}

function createRandomQuarterBlock(qNum, context, mask) {
  let available = shuffle([...ALL_PLAYERS]);
  let gk = null;
  const baseLineup = new Array(5).fill(null);

  (context.pins || []).forEach(pin => {
    if (pin.quarter === qNum) {
      if (pin.posIdx === 0) gk = pin.playerId;
      else if (pin.posIdx >= 1 && pin.posIdx <= 5) {
        baseLineup[pin.posIdx - 1] = pin.playerId;
      }
    }
  });

  const assigned = [gk, ...baseLineup].filter(Boolean);
  available = available.filter(p => !assigned.includes(p));

  if (!gk) gk = available.pop();

  for (let i = 0; i < 5; i++) {
    if (!baseLineup[i]) baseLineup[i] = available.pop();
  }

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

  ALL_PLAYERS.forEach(p => { posCounts[p] = { gk: 0, def: 0, off: 0 }; });

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
        if (pos === "GK") posCounts[player].gk += 6;
        else if (pos.startsWith("D")) posCounts[player].def += 6;
        else posCounts[player].off += 6;
      });
    });
  });

  return { schedule, totals, posCounts };
}

function evaluateFitness(chromosome, context) {
  const { totals, posCounts } = decodeChromosome(chromosome, context);
  let score = 0;

  ALL_PLAYERS.forEach(p => {
    const target = GAME_TARGETS[p];
    const diff = Math.abs(totals[p] - target);
    score -= diff * 15;
  });

  ALL_PLAYERS.forEach(p => {
    if (totals[p] > 0) {
      if (posCounts[p].def === 0) score -= 300;
      if (posCounts[p].off === 0) score -= 300;
    }
  });

  chromosome.quarters.forEach(q => {
    if (q.swap !== null) score -= 20;
  });

  const gks = chromosome.quarters.map(q => q.gk);
  const uniqueGks = new Set(gks);
  score -= (gks.length - uniqueGks.size) * 100;

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
      const candidates = ALL_PLAYERS.filter(p => !onField.includes(p) && p !== qBlock.gk);
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