/**
 * Scheduler Automated Test Suite
 * Injects a "Run Automated Tests" button into the Debug tab,
 * generates random non-conflicting test cases, executes the pipeline,
 * and audits constraints, position assignments, and playing time fairness.
 */

(function () {
    // Inject the test button into the Debug tab when loaded
    function injectTestButton() {
        const debugTab = document.querySelector('#debug-tab') || document.querySelector('.debug-container') || document.getElementById('debug');
        // Fallback: append to body or header if specific debug container isn't found by id
        const targetContainer = debugTab || document.body;

        if (document.getElementById('run-automated-tests-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'run-automated-tests-btn';
        btn.innerText = 'Run Automated Pipeline Tests';
        btn.style.cssText = 'margin: 10px; padding: 8px 16px; background-color: #2b6cb0; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';
        
        btn.addEventListener('click', () => {
            console.info('[TestRunner] Starting automated test suite...');
            runAutomatedTests(200); // Run 20 random test iterations
        });

        targetContainer.prepend(btn);
    }

    // Helper to generate a random integer between min and max (inclusive)
    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // Generate a valid random test case payload
    function generateRandomTestCase() {
        // Rule 2 requirement: 6 or more players, at least 2 willing goalies
        const playerNames = ['Jesse', 'Ellis', 'Bennet', 'Diego', 'London', 'Kyton', 'Vivian', 'Isabelle', 'Olivia', 'Elena'];
        const numPlayers = randomInt(6, playerNames.length);
        const selectedNames = playerNames.slice(0, numPlayers);

        const roster = selectedNames.map((name, idx) => ({
            id: `p_${idx + 1}`,
            name: name,
            defScore: randomInt(1, 5),
            midScore: randomInt(1, 5),
            fwdScore: randomInt(1, 5),
            // Ensure at least the first 2 players have goalie capability/willingness
            goalieScore: idx < 2 ? randomInt(3, 5) : randomInt(1, 5),
            priorMinutes: { G: 0, D: 0, M: 0, F: 0 }
        }));

        // Standard 4 quarters, 2 chunks per quarter (6 mins each)
        const chunks = [];
        let chunkCounter = 1;
        for (let q = 1; q <= 4; q++) {
            for (let sub = 1; sub <= 2; sub++) {
                chunks.push({
                    id: `chunk_${chunkCounter}`,
                    quarter: q,
                    duration: 6,
                    isPartial: false
                });
                chunkCounter++;
            }
        }

        // Rule 1 requirement: Generate non-mutually-exclusive random constraints
        // Avoid locking the same player twice in the same chunk or conflicting slots
        const constraints = [];
        const usedPlayerChunks = new Set();

        // Add 2 to 5 random constraints
        const numConstraints = randomInt(2, 5);
        const availablePositions = ['G', 'D_L', 'D_R', 'M_L', 'M_R', 'F'];

        for (let i = 0; i < numConstraints; i++) {
            const randomPlayer = roster[randomInt(0, roster.length - 1)];
            const randomChunk = chunks[randomInt(0, chunks.length - 1)];
            const randomPos = availablePositions[randomInt(0, availablePositions.length - 1)];

            const key = `${randomChunk.id}_${randomPlayer.id}`;
            if (!usedPlayerChunks.has(key)) {
                usedPlayerChunks.add(key);
                constraints.push({
                    chunkId: randomChunk.id,
                    playerId: randomPlayer.id,
                    position: randomPos,
                    source: 'manual'
                });
            }
        }

        return {
            roster,
            chunks,
            constraints,
            benched: [],
            prioritizeBalancedDefense: true
        };
    }

    // Main Test Runner Execution Loop
    function runAutomatedTests(iterations = 20) {
        let passedCount = 0;
        let failedCount = 0;

        for (let i = 0; i < iterations; i++) {
            const payload = generateRandomTestCase();
            let result;

            try {
                // Execute pipeline stages (assuming stage4 & stage5 functions are globally available in your app)
                const stage4Mock = generateMockStage4(payload);
                result = allocatePositionCategories(stage4Mock, payload, payload.chunks, payload.constraints);
            } catch (err) {
                console.error(`[TestRunner] Iteration ${i + 1} threw an unhandled exception:`, err);
                console.jsonPayloadFailure = payload;
                failedCount++;
                continue;
            }

            // Run Verification Checks
            const failures = [];

            // 1. Check Constraints Respected
            payload.constraints.forEach(c => {
                const chunkResult = result.grid.find(g => g.chunk.id === c.chunkId);
                if (!chunkResult) {
                    failures.push(`Constraint chunk ${c.chunkId} not found in output grid.`);
                    return;
                }
                const cell = chunkResult.cells[c.playerId];
                if (!cell || cell.role === 'Bench') {
                    failures.push(`Constraint violated: Player ${c.playerId} was benched in chunk ${c.chunkId}.`);
                }
            });

            // 2. Check One and Only One Position per Active Player Per Chunk
            result.grid.forEach(g => {
                const activeCells = Object.values(g.cells).filter(cell => cell.role !== 'Bench');
                activeCells.forEach(cell => {
                    const hasValidPos = ['G', 'D_L', 'D_R', 'M_L', 'M_R', 'F'].includes(cell.position);
                    if (!hasValidPos) {
                        failures.push(`Invalid or missing unique position assignment in chunk ${g.chunk.id}: role=${cell.role}, pos=${cell.position}`);
                    }
                });
            });

            // 3. Check Playing Minutes Fairness (Pairwise Comparison)
            const playerTotals = {};
            payload.roster.forEach(p => { playerTotals[p.id] = 0; });
            result.grid.forEach(g => {
                Object.keys(g.cells).forEach(playerId => {
                    if (g.cells[playerId].role !== 'Bench') {
                        playerTotals[playerId] = (playerTotals[playerId] || 0) + g.chunk.duration;
                    }
                });
            });

            const playerIds = payload.roster.map(p => p.id);
            for (let x = 0; x < playerIds.length; x++) {
                for (let y = x + 1; y < playerIds.length; y++) {
                    const p1 = playerIds[x];
                    const p2 = playerIds[y];
                    const diff = Math.abs(playerTotals[p1] - playerTotals[p2]);

                    if (diff > 6) {
                        // Check condition 3b: are there unconstrained future assignments where least played was benched while most played played non-goalie?
                        const leastPlayed = playerTotals[p1] < playerTotals[p2] ? p1 : p2;
                        const mostPlayed = leastPlayed === p1 ? p2 : p1;

                        let foundUnconstrainedViolation = false;
                        result.grid.forEach(g => {
                            const isLeastBenched = g.cells[leastPlayed]?.role === 'Bench';
                            const isMostFieldedNonGoalie = g.cells[mostPlayed]?.role && g.cells[mostPlayed]?.role !== 'Bench' && g.cells[mostPlayed]?.role !== 'G';
                            const isConstraintInvolved = g.cells[mostPlayed]?.starred || g.cells[leastPlayed]?.starred;

                            if (isLeastBenched && isMostFieldedNonGoalie && !isConstraintInvolved) {
                                foundUnconstrainedViolation = true;
                            }
                        });

                        if (foundUnconstrainedViolation) {
                            failures.push(`Fairness violation between ${leastPlayed} (${playerTotals[leastPlayed]}m) and ${mostPlayed} (${playerTotals[mostPlayed]}m): separated by >6m with unconstrained mismatch.`);
                        }
                    }
                }
            }

            if (failures.length > 0) {
                failedCount++;
                console.group(`[TestRunner] ❌ Test Iteration ${i + 1} FAILED`);
                console.error("Failures detected:\n- " + failures.join("\n- "));
                console.log("Failing Test Payload (JSON):");
                console.log(JSON.stringify(payload, null, 2));
                console.groupEnd();
            } else {
                passedCount++;
            }
        }

        console.info(`[TestRunner] Suite Complete. Passed: ${passedCount}/${iterations}, Failed: ${failedCount}/${iterations}`);
    }

    // Helper mock for Stage 4 output required by stage 5 allocator
    function generateMockStage4(payload) {
        const requiredFutureMinutes = {};
        payload.roster.forEach(p => {
            // Give each player a valid divisible-by-6 minute target (e.g., 24 or 30 mins)
            requiredFutureMinutes[p.id] = 24; 
        });
        return { requiredFutureMinutes, chunkPlayers: {} };
    }

    // Auto-initialize button injection on load
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(injectTestButton, 500);
    } else {
        window.addEventListener('DOMContentLoaded', injectTestButton);
    }
})();