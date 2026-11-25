(function (global) {
  'use strict';

  const DIRS = [
    { key: 'N', dr: -1, dc: 0, opp: 'S' },
    { key: 'E', dr: 0, dc: 1, opp: 'W' },
    { key: 'S', dr: 1, dc: 0, opp: 'N' },
    { key: 'W', dr: 0, dc: -1, opp: 'E' }
  ];

  function cellKey(r, c) {
    return `${r},${c}`;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  const NORMAL_GRID_CURVE = [4, 5, 6, 7, 7, 8, 9, 10, 11, 12];

  function getGridSizeForStage(stage, difficulty = 'hard') {
    if (difficulty === 'normal') {
      const idx = Math.max(0, Math.min(NORMAL_GRID_CURVE.length - 1, stage - 1));
      return NORMAL_GRID_CURVE[idx];
    }
    if (stage <= 1) return 5;
    if (stage <= 13) return 4 + stage; // Stage 2->6, 3->7, ..., 13->17
    return Math.min(20, 17 + Math.floor((stage - 13) / 2));
  }

  function getGridDimensionsForStage(stage, aspectRatio, difficulty = 'hard') {
    const base = getGridSizeForStage(stage, difficulty);
    const ar = Math.max(0.58, Math.min(1.55, Number(aspectRatio) || 1));

    // Keep exact square when arena is near-square or on compact 4x4 Stage 1 Normal
    if (Math.abs(ar - 1) < 0.14 || base <= 4) {
      return { rows: base, cols: base, base };
    }

    const targetArea = base * base;
    let cols = Math.round(Math.sqrt(targetArea * ar));
    cols = Math.max(4, Math.min(24, cols));
    let rows = Math.round(targetArea / cols);
    rows = Math.max(4, Math.min(24, rows));

    return { rows, cols, base };
  }

  function createEmptyGrid(rows, cols) {
    const grid = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        row.push({ r, c, N: true, E: true, S: true, W: true });
      }
      grid.push(row);
    }
    return grid;
  }

  function inBounds(rows, cols, r, c) {
    return r >= 0 && r < rows && c >= 0 && c < cols;
  }

  function openWall(grid, r1, c1, r2, c2) {
    const dr = r2 - r1;
    const dc = c2 - c1;
    if (dr === -1 && dc === 0) {
      grid[r1][c1].N = false;
      grid[r2][c2].S = false;
    } else if (dr === 1 && dc === 0) {
      grid[r1][c1].S = false;
      grid[r2][c2].N = false;
    } else if (dr === 0 && dc === 1) {
      grid[r1][c1].E = false;
      grid[r2][c2].W = false;
    } else if (dr === 0 && dc === -1) {
      grid[r1][c1].W = false;
      grid[r2][c2].E = false;
    }
  }

  function closeWall(grid, r1, c1, r2, c2) {
    const dr = r2 - r1;
    const dc = c2 - c1;
    if (dr === -1 && dc === 0) {
      grid[r1][c1].N = true;
      grid[r2][c2].S = true;
    } else if (dr === 1 && dc === 0) {
      grid[r1][c1].S = true;
      grid[r2][c2].N = true;
    } else if (dr === 0 && dc === 1) {
      grid[r1][c1].E = true;
      grid[r2][c2].W = true;
    } else if (dr === 0 && dc === -1) {
      grid[r1][c1].W = true;
      grid[r2][c2].E = true;
    }
  }

  function hasPassage(grid, r1, c1, r2, c2) {
    const dr = r2 - r1;
    const dc = c2 - c1;
    if (dr === -1 && dc === 0) return !grid[r1][c1].N;
    if (dr === 1 && dc === 0) return !grid[r1][c1].S;
    if (dr === 0 && dc === 1) return !grid[r1][c1].E;
    if (dr === 0 && dc === -1) return !grid[r1][c1].W;
    return false;
  }

  function creates2x2Open(grid, rows, cols, r1, c1, r2, c2) {
    openWall(grid, r1, c1, r2, c2);
    let found = false;
    const minR = Math.max(0, Math.min(r1, r2) - 1);
    const maxR = Math.min(rows - 2, Math.max(r1, r2));
    const minC = Math.max(0, Math.min(c1, c2) - 1);
    const maxC = Math.min(cols - 2, Math.max(c1, c2));

    for (let r = minR; r <= maxR && !found; r++) {
      for (let c = minC; c <= maxC && !found; c++) {
        // Check if 2x2 cells (r,c), (r,c+1), (r+1,c), (r+1,c+1) have all 4 interior walls open
        if (
          !grid[r][c].E &&
          !grid[r][c].S &&
          !grid[r][c + 1].S &&
          !grid[r + 1][c].E
        ) {
          found = true;
        }
      }
    }
    closeWall(grid, r1, c1, r2, c2);
    return found;
  }

  function generateSpanningTree(rows, cols) {
    const grid = createEmptyGrid(rows, cols);
    const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
    const startR = Math.floor(Math.random() * rows);
    const startC = Math.floor(Math.random() * cols);
    visited[startR][startC] = true;
    const active = [{ r: startR, c: startC }];

    // Growing Tree: 78% newest (DFS corridors) + 22% random (Prim branches)
    while (active.length > 0) {
      const pickNewest = Math.random() < 0.78;
      const idx = pickNewest ? active.length - 1 : Math.floor(Math.random() * active.length);
      const cur = active[idx];

      const neighbors = [];
      for (const d of DIRS) {
        const nr = cur.r + d.dr;
        const nc = cur.c + d.dc;
        if (inBounds(rows, cols, nr, nc) && !visited[nr][nc]) {
          neighbors.push({ r: nr, c: nc });
        }
      }

      if (neighbors.length > 0) {
        const next = neighbors[Math.floor(Math.random() * neighbors.length)];
        openWall(grid, cur.r, cur.c, next.r, next.c);
        visited[next.r][next.c] = true;
        active.push(next);
      } else {
        active.splice(idx, 1);
      }
    }

    return grid;
  }

  function bfsDistances(grid, rows, cols, start) {
    const dist = Array.from({ length: rows }, () => Array(cols).fill(-1));
    const parent = Array.from({ length: rows }, () => Array(cols).fill(null));
    const queue = [{ r: start.r, c: start.c }];
    dist[start.r][start.c] = 0;

    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const cell = grid[cur.r][cur.c];
      for (const d of DIRS) {
        if (!cell[d.key]) {
          const nr = cur.r + d.dr;
          const nc = cur.c + d.dc;
          if (inBounds(rows, cols, nr, nc) && dist[nr][nc] === -1) {
            dist[nr][nc] = dist[cur.r][cur.c] + 1;
            parent[nr][nc] = cur;
            queue.push({ r: nr, c: nc });
          }
        }
      }
    }

    return { dist, parent };
  }

  function reconstructPath(parent, goal) {
    const path = [];
    let cur = goal;
    while (cur) {
      path.push({ r: cur.r, c: cur.c });
      cur = parent[cur.r][cur.c];
    }
    path.reverse();
    return path;
  }

  function findShortestPath(grid, rows, cols, start, goal) {
    const { dist, parent } = bfsDistances(grid, rows, cols, start);
    if (dist[goal.r][goal.c] === -1) return null;
    return reconstructPath(parent, goal);
  }

  function pickStartAndGoal(grid, rows, cols, stage) {
    const corners = [
      { r: 0, c: 0, oppR: rows - 1, oppC: cols - 1 },
      { r: 0, c: cols - 1, oppR: rows - 1, oppC: 0 },
      { r: rows - 1, c: 0, oppR: 0, oppC: cols - 1 },
      { r: rows - 1, c: cols - 1, oppR: 0, oppC: 0 }
    ];

    const chosen = stage === 1 ? corners[0] : corners[Math.floor(Math.random() * corners.length)];
    const start = { r: chosen.r, c: chosen.c };
    const { dist } = bfsDistances(grid, rows, cols, start);

    // Pick a goal in the opposite half/quadrant with high BFS distance
    const midR = (rows - 1) / 2;
    const midC = (cols - 1) / 2;
    let bestGoal = { r: chosen.oppR, c: chosen.oppC };
    let bestScore = -1;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r === start.r && c === start.c) continue;
        const inOppR = chosen.oppR > midR ? r >= Math.floor(midR) : r <= Math.ceil(midR);
        const inOppC = chosen.oppC > midC ? c >= Math.floor(midC) : c <= Math.ceil(midC);
        if (!inOppR || !inOppC) continue;
        const manhattan = Math.abs(r - start.r) + Math.abs(c - start.c);
        const score = dist[r][c] * 1.4 + manhattan * 0.6;
        if (score > bestScore) {
          bestScore = score;
          bestGoal = { r, c };
        }
      }
    }

    return { start, goal: bestGoal };
  }

  function findBestAlternateWall(grid, rows, cols, p0) {
    // Multi-source BFS from all nodes on p0 to project every cell onto its root index in p0
    const proj = Array.from({ length: rows }, () => Array(cols).fill(-1));
    const branchDist = Array.from({ length: rows }, () => Array(cols).fill(-1));
    const branchParent = Array.from({ length: rows }, () => Array(cols).fill(null));
    const queue = [];

    for (let i = 0; i < p0.length; i++) {
      const node = p0[i];
      proj[node.r][node.c] = i;
      branchDist[node.r][node.c] = 0;
      queue.push(node);
    }

    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const cell = grid[cur.r][cur.c];
      for (const d of DIRS) {
        if (!cell[d.key]) {
          const nr = cur.r + d.dr;
          const nc = cur.c + d.dc;
          if (inBounds(rows, cols, nr, nc) && proj[nr][nc] === -1) {
            proj[nr][nc] = proj[cur.r][cur.c];
            branchDist[nr][nc] = branchDist[cur.r][cur.c] + 1;
            branchParent[nr][nc] = cur;
            queue.push({ r: nr, c: nc });
          }
        }
      }
    }

    const candidates = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Check E and S walls only to avoid duplicates
        const checks = [
          { key: 'E', nr: r, nc: c + 1 },
          { key: 'S', nr: r + 1, nc: c }
        ];
        for (const ch of checks) {
          if (!inBounds(rows, cols, ch.nr, ch.nc)) continue;
          if (!grid[r][c][ch.key]) continue; // already open
          const pA = proj[r][c];
          const pB = proj[ch.nr][ch.nc];
          if (pA === pB || pA === -1 || pB === -1) continue;
          if (creates2x2Open(grid, rows, cols, r, c, ch.nr, ch.nc)) continue;

          const spanOnP0 = Math.abs(pB - pA);
          const offCellsCount = branchDist[r][c] + branchDist[ch.nr][ch.nc];
          // Ensure at least 1 cell (ideally >=2) is genuinely off p0, or span >= 2
          if (offCellsCount === 0 && spanOnP0 < 3) continue;

          // Build the exact alternate simple path
          let u = { r, c };
          let v = { r: ch.nr, c: ch.nc };
          let idxA = pA;
          let idxB = pB;
          if (idxA > idxB) {
            const tmp = u; u = v; v = tmp;
            const tmpI = idxA; idxA = idxB; idxB = tmpI;
          }

          // Walk u -> rootA (excluding rootA)
          const legA = [];
          let cur = u;
          while (cur && branchDist[cur.r][cur.c] > 0) {
            legA.push({ r: cur.r, c: cur.c });
            cur = branchParent[cur.r][cur.c];
          }
          legA.reverse();

          // Walk v -> rootB (excluding rootB)
          const legB = [];
          cur = v;
          while (cur && branchDist[cur.r][cur.c] > 0) {
            legB.push({ r: cur.r, c: cur.c });
            cur = branchParent[cur.r][cur.c];
          }

          const detourInternal = [...legA, ...legB];
          const altPath = [
            ...p0.slice(0, idxA + 1),
            ...detourInternal,
            ...p0.slice(idxB)
          ];

          // Score how enjoyable/distinct this alternate route is
          const avgDim = (rows + cols) * 0.5;
          const altDiff = altPath.length - p0.length;
          const idealOff = Math.min(Math.max(2, Math.floor(avgDim * 0.85)), 9);
          const offScore = detourInternal.length >= 2 ? 25 - Math.abs(detourInternal.length - idealOff) * 2 : 5;
          const spanScore = Math.min(spanOnP0, 8) * 2.5;
          const lengthPenalty = altDiff > Math.max(8, avgDim) ? (altDiff - Math.max(8, avgDim)) * 4 : 0;
          const score = offScore + spanScore - lengthPenalty + Math.random() * 4;

          candidates.push({
            u: { r, c },
            v: { r: ch.nr, c: ch.nc },
            altPath,
            detourInternal,
            score
          });
        }
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  function getLongestOffSegment(route, shortestSet, start, goal) {
    let bestSeg = [];
    let curSeg = [];
    for (const cell of route) {
      const k = cellKey(cell.r, cell.c);
      const isEndpoint =
        (cell.r === start.r && cell.c === start.c) ||
        (cell.r === goal.r && cell.c === goal.c);
      if (!shortestSet.has(k) && !isEndpoint) {
        curSeg.push(cell);
        if (curSeg.length > bestSeg.length) {
          bestSeg = curSeg;
        }
      } else {
        curSeg = [];
      }
    }
    return bestSeg;
  }

  function pickItemFromRoutes(shortestPath, candidateRoutes, start, goal) {
    const shortestSet = new Set(shortestPath.map((p) => cellKey(p.r, p.c)));
    let bestChoice = null;

    for (const route of candidateRoutes) {
      if (!route || route.length < 3) continue;
      const seg = getLongestOffSegment(route, shortestSet, start, goal);
      if (seg.length > 0) {
        if (!bestChoice || seg.length > bestChoice.seg.length) {
          bestChoice = { seg, route };
        }
      }
    }

    if (!bestChoice) return null;
    const midIndex = Math.floor(bestChoice.seg.length / 2);
    return {
      cell: bestChoice.seg[midIndex],
      route: bestChoice.route,
      extraLength: Math.max(0, bestChoice.route.length - shortestPath.length)
    };
  }

  function getHealItemCount(stage, difficulty = 'hard') {
    if (difficulty === 'normal') {
      if (stage < 4) return 0;
      if (stage < 6) return 1;
      if (stage < 8) return 2;
      if (stage < 10) return 3;
      return 4;
    }
    if (stage < 4) return 0;
    if (stage < 6) return 1;
    if (stage < 8) return 2;
    if (stage < 11) return 3;
    if (stage < 14) return 4;
    return Math.min(6, 4 + Math.floor((stage - 11) / 3));
  }

  function placeHealItems(grid, rows, cols, start, goal, nextItem, shortestPath, itemRoute, count) {
    if (count <= 0) return [];

    // Multi-source BFS from shortestPath and itemRoute to measure detour distance
    const routeDist = Array.from({ length: rows }, () => Array(cols).fill(-1));
    const queue = [];
    const seedRoute = (route) => {
      if (!route) return;
      for (const cell of route) {
        if (routeDist[cell.r][cell.c] === -1) {
          routeDist[cell.r][cell.c] = 0;
          queue.push({ r: cell.r, c: cell.c });
        }
      }
    };
    seedRoute(shortestPath);
    seedRoute(itemRoute);

    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const cell = grid[cur.r][cur.c];
      for (const d of DIRS) {
        if (!cell[d.key]) {
          const nr = cur.r + d.dr;
          const nc = cur.c + d.dc;
          if (inBounds(rows, cols, nr, nc) && routeDist[nr][nc] === -1) {
            routeDist[nr][nc] = routeDist[cur.r][cur.c] + 1;
            queue.push({ r: nr, c: nc });
          }
        }
      }
    }

    const forbidden = new Set([
      cellKey(start.r, start.c),
      cellKey(goal.r, goal.c)
    ]);
    if (nextItem) forbidden.add(cellKey(nextItem.r, nextItem.c));

    const nearCandidates = [];
    const allCandidates = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (forbidden.has(cellKey(r, c))) continue;
        const rd = routeDist[r][c];
        allCandidates.push({ r, c, rd });
        if (rd >= 0 && rd <= 2) {
          nearCandidates.push({ r, c, rd });
        }
      }
    }

    const pool = nearCandidates.length >= count ? nearCandidates : allCandidates;
    const anchors = [start, goal];
    if (nextItem) anchors.push({ r: nextItem.r, c: nextItem.c });

    const picked = [];
    const usedKeys = new Set();

    for (let i = 0; i < count; i++) {
      let best = null;
      let bestScore = -Infinity;

      for (const cand of pool) {
        const k = cellKey(cand.r, cand.c);
        if (usedKeys.has(k)) continue;

        let minDist = Infinity;
        for (const a of anchors) {
          const d = Math.abs(cand.r - a.r) + Math.abs(cand.c - a.c);
          if (d < minDist) minDist = d;
        }
        // Prefer well-spaced cells along or right beside the solution corridors
        const routeAffinity = cand.rd === 0 ? 1.15 : cand.rd === 1 ? 0.75 : 0.2;
        const score = minDist + routeAffinity + Math.random() * 0.9;
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }

      if (!best) break;
      usedKeys.add(cellKey(best.r, best.c));
      anchors.push({ r: best.r, c: best.c });
      picked.push({
        r: best.r,
        c: best.c,
        bonusSeconds: 1 + Math.floor(Math.random() * 3),
        used: false
      });
    }

    return picked;
  }

  function generateMaze(stage, aspectRatio = 1, difficulty = 'hard') {
    const { rows, cols, base } = getGridDimensionsForStage(stage, aspectRatio, difficulty);
    const size = base;
    const healCount = getHealItemCount(stage, difficulty);

    // Retry up to 12 times to guarantee a clean multi-route maze with an off-shortest item
    let fallbackResult = null;

    for (let attempt = 0; attempt < 12; attempt++) {
      const grid = generateSpanningTree(rows, cols);
      const { start, goal } = pickStartAndGoal(grid, rows, cols, stage);
      const p0 = findShortestPath(grid, rows, cols, start, goal);
      if (!p0 || p0.length < Math.max(4, Math.floor(size * 1.1))) continue;

      const altWall = findBestAlternateWall(grid, rows, cols, p0);
      if (!altWall) continue;

      // Open the primary alternate route wall
      openWall(grid, altWall.u.r, altWall.u.c, altWall.v.r, altWall.v.c);

      const candidateRoutes = [p0, altWall.altPath];

      // Add extra braided loops for richer multi-path structure without breaking distinctness
      const desiredExtraLoops = Math.min(8, Math.max(1, Math.floor(size * 0.45)));
      const closedWalls = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (c + 1 < cols && grid[r][c].E) closedWalls.push({ r1: r, c1: c, r2: r, c2: c + 1 });
          if (r + 1 < rows && grid[r][c].S) closedWalls.push({ r1: r, c1: c, r2: r + 1, c2: c });
        }
      }
      shuffle(closedWalls);

      let addedLoops = 0;
      for (const w of closedWalls) {
        if (addedLoops >= desiredExtraLoops) break;
        if (creates2x2Open(grid, rows, cols, w.r1, w.c1, w.r2, w.c2)) continue;
        openWall(grid, w.r1, w.c1, w.r2, w.c2);

        // Verify that we still have a valid distinct alternate route for the item
        const testShortest = findShortestPath(grid, rows, cols, start, goal);
        const testItem = pickItemFromRoutes(testShortest, candidateRoutes, start, goal);
        if (!testItem || testShortest.length < Math.max(4, Math.floor(size * 0.95))) {
          // Revert this extra wall so we don't shortcut the maze too much
          closeWall(grid, w.r1, w.c1, w.r2, w.c2);
        } else {
          addedLoops++;
        }
      }

      const shortestPath = findShortestPath(grid, rows, cols, start, goal);
      const itemPick = pickItemFromRoutes(shortestPath, candidateRoutes, start, goal);

      if (itemPick) {
        // Choose bonus time: 1, 2, or 3 seconds (weighted slightly by detour risk)
        const r = Math.random();
        let bonusSeconds;
        if (itemPick.extraLength >= 4) {
          bonusSeconds = r < 0.2 ? 1 : r < 0.62 ? 2 : 3;
        } else {
          bonusSeconds = r < 0.36 ? 1 : r < 0.76 ? 2 : 3;
        }

        const nextItem = {
          r: itemPick.cell.r,
          c: itemPick.cell.c,
          bonusSeconds
        };
        const healItems = placeHealItems(
          grid,
          rows,
          cols,
          start,
          goal,
          nextItem,
          shortestPath,
          itemPick.route,
          healCount
        );

        return {
          stage,
          rows,
          cols,
          grid,
          start,
          goal,
          shortestPath,
          itemRoute: itemPick.route,
          item: nextItem,
          healItems
        };
      }

      // Save fallback just in case
      if (!fallbackResult && shortestPath && shortestPath.length >= 3) {
        const mid = shortestPath[Math.floor(shortestPath.length / 2)];
        const fallbackNextItem = {
          r: mid.r,
          c: mid.c,
          bonusSeconds: 1 + Math.floor(Math.random() * 3)
        };
        fallbackResult = {
          stage,
          rows,
          cols,
          grid,
          start,
          goal,
          shortestPath,
          itemRoute: shortestPath,
          item: fallbackNextItem,
          healItems: placeHealItems(
            grid,
            rows,
            cols,
            start,
            goal,
            fallbackNextItem,
            shortestPath,
            shortestPath,
            healCount
          )
        };
      }
    }

    return fallbackResult;
  }

  global.Meiro5 = global.Meiro5 || {};
  global.Meiro5.generateMaze = generateMaze;
  global.Meiro5.hasPassage = hasPassage;
  global.Meiro5.getGridSizeForStage = getGridSizeForStage;
  global.Meiro5.getGridDimensionsForStage = getGridDimensionsForStage;
  global.Meiro5.getHealItemCount = getHealItemCount;
})(window);
