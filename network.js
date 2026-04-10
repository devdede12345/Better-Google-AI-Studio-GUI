/**
 * AetherMind Network Module (MAIN world)
 * Uses locally-bundled D3.js (loaded via manifest before this file).
 * Renders force-directed graph with parent-child + semantic links.
 */
(function () {
  'use strict';

  console.log('[AetherNet] Module loaded (MAIN world)');

  // ── Bridge listeners (attached FIRST) ──
  document.addEventListener('aether:activate-network', function (e) {
    var detail = e.detail;
    console.log('[AetherNet] Received activate-network event');
    if (!detail) { console.error('[AetherNet] No detail in event'); return; }
    console.log('[AetherNet] Data: nodes=' + (detail.nodes ? detail.nodes.length : 0) +
      ', branches=' + (detail.branches ? detail.branches.length : 0) +
      ', hostSelector=' + detail.hostSelector);
    var hostEl = document.querySelector(detail.hostSelector);
    if (!hostEl) {
      console.error('[AetherNet] Host element not found:', detail.hostSelector);
      return;
    }
    console.log('[AetherNet] Host element found, size=' +
      hostEl.offsetWidth + 'x' + hostEl.offsetHeight);
    var nodesArr = detail.nodes || [];
    var branchesArr = detail.branches || [];

    // If embeddings are available, process first then activate
    if (window.AetherEmbed && window.AetherEmbed.isReady()) {
      console.log('[AetherNet] AetherEmbed ready, processing nodes for semantic links...');
      window.AetherEmbed.processAllNodes(nodesArr).then(function () {
        activate(hostEl, nodesArr, branchesArr);
      }).catch(function (err) {
        console.warn('[AetherNet] Embedding processing error:', err);
        activate(hostEl, nodesArr, branchesArr);
      });
    } else {
      console.log('[AetherNet] AetherEmbed not ready, activating without semantic links');
      activate(hostEl, nodesArr, branchesArr);
    }
  });

  document.addEventListener('aether:deactivate-network', function () {
    console.log('[AetherNet] Received deactivate-network event');
    deactivate();
  });

  // Also listen for embeddings-ready to refresh if already active
  document.addEventListener('aether:embeddings-ready', function (e) {
    if (isActive && e.detail && e.detail.links) {
      console.log('[AetherNet] Embeddings ready with ' + e.detail.links.length + ' links, refreshing...');
      // Rebuild semantic links and re-render
      if (lastNodesArr && lastBranchesArr) {
        refreshWithData(lastNodesArr, lastBranchesArr);
      }
    }
  });

  // ── D3 reference (loaded globally by manifest before this script) ──
  var d3Lib = null;
  function getD3() {
    if (d3Lib) return d3Lib;
    if (window.d3 && window.d3.forceSimulation) {
      d3Lib = window.d3;
      console.log('[AetherNet] D3.js found (v' + (d3Lib.version || '?') + ')');
      return d3Lib;
    }
    console.error('[AetherNet] D3.js NOT found on window!');
    console.log('[AetherNet] window.d3 =', typeof window.d3);
    return null;
  }

  // ── State ──
  var simulation = null;
  var svgRoot = null;
  var container = null;
  var gLinks = null;
  var gSemanticLinks = null;
  var gNodes = null;
  var gLabels = null;
  var tooltip = null;
  var nodesData = [];
  var linksData = [];
  var semanticData = [];
  var width = 800;
  var height = 600;
  var isActive = false;
  var lastNodesArr = null;
  var lastBranchesArr = null;

  var SEMANTIC_COLOR = '#b39ddb';
  var SEMANTIC_ACTIVE_COLOR = '#ce93d8';

  // ══════════════════════════════════════════════════════════════
  //  Canvas setup
  // ══════════════════════════════════════════════════════════════

  function createCanvas(parentEl) {
    var d3 = getD3();
    if (!d3) return null;

    if (container) container.remove();
    container = document.createElement('div');
    container.className = 'aether-network-canvas';
    parentEl.appendChild(container);

    var rect = container.getBoundingClientRect();
    width = rect.width || 800;
    height = rect.height || 600;
    console.log('[AetherNet] Canvas created: ' + width + 'x' + height);

    svgRoot = d3.select(container).append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', '0 0 ' + width + ' ' + height)
      .attr('class', 'aether-network-svg');

    var zoom = d3.zoom()
      .scaleExtent([0.2, 4])
      .on('zoom', function (e) {
        rootG.attr('transform', e.transform);
      });
    svgRoot.call(zoom);

    var rootG = svgRoot.append('g').attr('class', 'aether-network-root');

    gLinks = rootG.append('g').attr('class', 'aether-network-links');
    gSemanticLinks = rootG.append('g').attr('class', 'aether-network-semantic');
    gNodes = rootG.append('g').attr('class', 'aether-network-nodes');
    gLabels = rootG.append('g').attr('class', 'aether-network-labels');

    tooltip = document.createElement('div');
    tooltip.className = 'aether-network-tooltip';
    tooltip.style.display = 'none';
    container.appendChild(tooltip);

    return svgRoot;
  }

  // ══════════════════════════════════════════════════════════════
  //  Data conversion
  // ══════════════════════════════════════════════════════════════

  function buildGraphData(aetherNodes, aetherBranches) {
    var nodeMap = {};
    var branchMap = {};
    aetherBranches.forEach(function (b) { if (b) branchMap[b.id] = b; });

    // Build children map for BFS depth computation
    var childrenOf = {}; // parentId -> [childId, ...]
    aetherNodes.forEach(function (n) {
      if (n.parentId != null) {
        if (!childrenOf[n.parentId]) childrenOf[n.parentId] = [];
        childrenOf[n.parentId].push(n.id);
      }
    });

    // Find root nodes (no parent or parent not in set)
    var allIds = new Set(aetherNodes.map(function (n) { return n.id; }));
    var roots = aetherNodes.filter(function (n) {
      return n.parentId == null || !allIds.has(n.parentId);
    });

    // BFS to compute depth and sibling index
    var depthOf = {};  // nodeId -> depth
    var siblingIdx = {}; // nodeId -> index among siblings
    var siblingCnt = {}; // nodeId -> total sibling count
    var maxDepth = 0;
    var queue = [];
    roots.forEach(function (r, i) {
      depthOf[r.id] = 0;
      siblingIdx[r.id] = i;
      siblingCnt[r.id] = roots.length;
      queue.push(r.id);
    });
    while (queue.length > 0) {
      var cur = queue.shift();
      var children = childrenOf[cur] || [];
      for (var ci = 0; ci < children.length; ci++) {
        var cid = children[ci];
        if (depthOf[cid] == null) {
          depthOf[cid] = depthOf[cur] + 1;
          siblingIdx[cid] = ci;
          siblingCnt[cid] = children.length;
          if (depthOf[cid] > maxDepth) maxDepth = depthOf[cid];
          queue.push(cid);
        }
      }
    }

    // Collect unique branch IDs in order for angular spread
    var branchIds = [];
    var branchSet = new Set();
    aetherNodes.forEach(function (n) {
      if (!branchSet.has(n.branchId)) { branchSet.add(n.branchId); branchIds.push(n.branchId); }
    });

    // Build node data with tree-aware initial positions
    var DEPTH_SPACING = 55;
    var BRANCH_ANGLE_STEP = branchIds.length > 1 ? (Math.PI * 1.5) / branchIds.length : 0;
    var BASE_ANGLE = -Math.PI / 2; // start from top

    nodesData = aetherNodes.map(function (n) {
      var br = branchMap[n.branchId] || null;
      var depth = depthOf[n.id] != null ? depthOf[n.id] : 0;
      var bIdx = branchIds.indexOf(n.branchId);

      // Initial position: radial layout based on depth + branch angle
      var angle, radius;
      if (branchIds.length <= 1) {
        // Single branch: vertical layout
        angle = Math.PI / 2; // downward
        radius = depth * DEPTH_SPACING;
      } else {
        // Multi-branch: fan out from center, main trunk goes down
        if (n.branchId === 0) {
          angle = Math.PI / 2;
        } else {
          angle = BASE_ANGLE + bIdx * BRANCH_ANGLE_STEP;
        }
        radius = depth * DEPTH_SPACING;
      }

      // Spread siblings horizontally at same depth
      var sibOff = 0;
      if ((siblingCnt[n.id] || 1) > 1) {
        var total = siblingCnt[n.id];
        sibOff = ((siblingIdx[n.id] || 0) - (total - 1) / 2) * 30;
      }

      var initX = width / 2 + Math.cos(angle) * radius + sibOff * Math.cos(angle + Math.PI / 2);
      var initY = height / 2 + Math.sin(angle) * radius + sibOff * Math.sin(angle + Math.PI / 2);

      var obj = {
        id: n.id,
        label: n.label || 'Turn',
        branchId: n.branchId,
        parentId: n.parentId,
        depth: depth,
        color: br ? br.color : '#4285f4',
        x: initX,
        y: initY,
      };
      nodeMap[n.id] = obj;
      return obj;
    });

    // Build links strictly from parentId (no array-order links!)
    // Fallback: orphan nodes whose parentId is missing get connected to
    // the last node on main branch (branchId 0) to prevent them floating loose.
    linksData = [];
    var lastMainNodeId = null;
    aetherNodes.forEach(function (n) {
      if (n.branchId === 0) lastMainNodeId = n.id;
    });

    aetherNodes.forEach(function (n) {
      if (n.parentId != null) {
        if (nodeMap[n.parentId]) {
          linksData.push({
            source: n.parentId,
            target: n.id,
            type: 'parent',
            color: nodeMap[n.id].color,
          });
        } else if (lastMainNodeId != null && n.id !== lastMainNodeId) {
          // Orphan: parent not found — fallback to last main-branch node
          console.warn('[AetherNet] Orphan node #' + n.id + ' (parentId=' + n.parentId +
            ' missing) → fallback to main #' + lastMainNodeId);
          linksData.push({
            source: lastMainNodeId,
            target: n.id,
            type: 'parent',
            color: nodeMap[n.id].color,
          });
        }
      }
    });

    // Diagnostic: log link topology
    console.log('[AetherNet] Link map:');
    linksData.forEach(function (l) {
      console.log('  ' + l.source + ' → ' + l.target + ' (color=' + l.color + ')');
    });

    // Semantic links from AetherEmbed (same MAIN world)
    semanticData = [];
    if (window.AetherEmbed) {
      var sLinks = window.AetherEmbed.getLinks();
      sLinks.forEach(function (sl) {
        if (nodeMap[sl.sourceId] && nodeMap[sl.targetId]) {
          semanticData.push({
            source: sl.sourceId,
            target: sl.targetId,
            type: 'semantic',
            score: sl.score,
            color: SEMANTIC_COLOR,
          });
        }
      });
    }

    // Log fork points (nodes with >1 child)
    var forkCount = 0;
    Object.keys(childrenOf).forEach(function (pid) {
      if (childrenOf[pid].length > 1) forkCount++;
    });
    console.log('[AetherNet] Graph data: ' + nodesData.length + ' nodes, ' +
      linksData.length + ' parent links, ' + semanticData.length + ' semantic links, ' +
      forkCount + ' fork points, maxDepth=' + maxDepth);
    return { nodes: nodesData, parentLinks: linksData, semanticLinks: semanticData };
  }

  // ══════════════════════════════════════════════════════════════
  //  Force simulation
  // ══════════════════════════════════════════════════════════════

  function initSimulation() {
    var d3 = getD3();
    if (!d3) return;
    if (simulation) simulation.stop();

    simulation = d3.forceSimulation(nodesData)
      // Strong repulsion — pushes fork siblings apart like umbrella ribs
      .force('charge', d3.forceManyBody().strength(-400).distanceMax(500))
      // Keep graph centered in viewport
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.05))
      // Collision: large radius prevents label overlap at fork points
      .force('collision', d3.forceCollide().radius(40).strength(0.8).iterations(2))
      // Parent-child links: short & rigid to maintain tree structure
      .force('parentLinks', d3.forceLink(linksData)
        .id(function (d) { return d.id; })
        .distance(50)
        .strength(1.0))
      // Semantic links: longer, weaker — decorative connections
      .force('semanticLinks', d3.forceLink(semanticData)
        .id(function (d) { return d.id; })
        .distance(150)
        .strength(function (d) { return (d.score || 0.5) * 0.15; }))
      .alphaDecay(0.018)
      .velocityDecay(0.35)
      .on('tick', ticked);
  }

  // ══════════════════════════════════════════════════════════════
  //  Rendering
  // ══════════════════════════════════════════════════════════════

  function render() {
    var d3 = getD3();
    if (!svgRoot || !d3) return;

    // Parent-child edges
    var linkSel = gLinks.selectAll('line.aether-net-link')
      .data(linksData, function (d) {
        var s = typeof d.source === 'object' ? d.source.id : d.source;
        var t = typeof d.target === 'object' ? d.target.id : d.target;
        return s + '-' + t;
      });
    linkSel.exit().remove();
    linkSel.enter().append('line')
      .attr('class', 'aether-net-link')
      .attr('stroke-width', 2)
      .attr('stroke-linecap', 'round')
      .merge(linkSel)
      .attr('stroke', function (d) { return d.color; })
      .attr('opacity', 0.65);

    // Semantic edges (lavender dashed)
    var semSel = gSemanticLinks.selectAll('line.aether-net-semantic')
      .data(semanticData, function (d) {
        var s = typeof d.source === 'object' ? d.source.id : d.source;
        var t = typeof d.target === 'object' ? d.target.id : d.target;
        return s + '-' + t;
      });
    semSel.exit().remove();
    semSel.enter().append('line')
      .attr('class', 'aether-net-semantic')
      .attr('stroke', SEMANTIC_COLOR)
      .attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '6,4')
      .attr('stroke-linecap', 'round')
      .attr('opacity', 0.35);

    // Nodes
    var nodeSel = gNodes.selectAll('circle.aether-net-node')
      .data(nodesData, function (d) { return d.id; });
    nodeSel.exit().remove();
    var nodeEnter = nodeSel.enter().append('circle')
      .attr('class', 'aether-net-node')
      .attr('r', 8)
      .attr('stroke-width', 2)
      .attr('cursor', 'pointer')
      .call(d3.drag()
        .on('start', dragStart)
        .on('drag', dragging)
        .on('end', dragEnd))
      .on('click', function (e, d) {
        document.dispatchEvent(new CustomEvent('aether:network-click', {
          detail: { nodeId: d.id, branchId: d.branchId },
        }));
      })
      .on('mouseenter', function (e, d) { highlightSemantic(d.id, e); })
      .on('mouseleave', function () { unhighlightSemantic(); });
    nodeEnter.merge(nodeSel)
      .attr('fill', function (d) { return d.color; })
      .attr('stroke', function (d) { return d.color; })
      .attr('fill-opacity', 0.2)
      .attr('stroke-opacity', 0.8);

    // Labels
    var lblSel = gLabels.selectAll('text.aether-net-label')
      .data(nodesData, function (d) { return d.id; });
    lblSel.exit().remove();
    lblSel.enter().append('text')
      .attr('class', 'aether-net-label')
      .attr('font-size', 10)
      .attr('fill', 'rgba(255,255,255,0.7)')
      .attr('text-anchor', 'middle')
      .attr('dy', -14)
      .attr('pointer-events', 'none')
      .merge(lblSel)
      .text(function (d) {
        return d.label.length > 18 ? d.label.slice(0, 18) + '\u2026' : d.label;
      });
  }

  function ticked() {
    gLinks.selectAll('line.aether-net-link')
      .attr('x1', function (d) { return d.source.x; })
      .attr('y1', function (d) { return d.source.y; })
      .attr('x2', function (d) { return d.target.x; })
      .attr('y2', function (d) { return d.target.y; });

    gSemanticLinks.selectAll('line.aether-net-semantic')
      .attr('x1', function (d) { return d.source.x; })
      .attr('y1', function (d) { return d.source.y; })
      .attr('x2', function (d) { return d.target.x; })
      .attr('y2', function (d) { return d.target.y; });

    gNodes.selectAll('circle.aether-net-node')
      .attr('cx', function (d) { return d.x; })
      .attr('cy', function (d) { return d.y; });

    gLabels.selectAll('text.aether-net-label')
      .attr('x', function (d) { return d.x; })
      .attr('y', function (d) { return d.y; });
  }

  // ══════════════════════════════════════════════════════════════
  //  Drag handlers
  // ══════════════════════════════════════════════════════════════

  function dragStart(e, d) {
    if (!e.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x; d.fy = d.y;
  }
  function dragging(e, d) {
    d.fx = e.x; d.fy = e.y;
  }
  function dragEnd(e, d) {
    if (!e.active) simulation.alphaTarget(0);
    d.fx = null; d.fy = null;
  }

  // ══════════════════════════════════════════════════════════════
  //  Hover: highlight semantic links + tooltip
  // ══════════════════════════════════════════════════════════════

  function highlightSemantic(nodeId, mouseEvent) {
    var d3 = getD3();
    if (!gSemanticLinks || !d3) return;
    var related = [];
    gSemanticLinks.selectAll('line.aether-net-semantic')
      .each(function (d) {
        var sId = typeof d.source === 'object' ? d.source.id : d.source;
        var tId = typeof d.target === 'object' ? d.target.id : d.target;
        if (sId === nodeId || tId === nodeId) {
          d3.select(this)
            .attr('stroke', SEMANTIC_ACTIVE_COLOR)
            .attr('stroke-width', 2.5)
            .attr('opacity', 0.8);
          related.push(d);
        } else {
          d3.select(this).attr('opacity', 0.08);
        }
      });

    gLinks.selectAll('line.aether-net-link')
      .attr('opacity', function (d) {
        var sId = typeof d.source === 'object' ? d.source.id : d.source;
        var tId = typeof d.target === 'object' ? d.target.id : d.target;
        return (sId === nodeId || tId === nodeId) ? 0.85 : 0.15;
      });

    var relatedIds = new Set([nodeId]);
    related.forEach(function (d) {
      relatedIds.add(typeof d.source === 'object' ? d.source.id : d.source);
      relatedIds.add(typeof d.target === 'object' ? d.target.id : d.target);
    });
    gNodes.selectAll('circle.aether-net-node')
      .attr('fill-opacity', function (d) { return relatedIds.has(d.id) ? 0.4 : 0.05; })
      .attr('stroke-opacity', function (d) { return relatedIds.has(d.id) ? 1 : 0.2; });

    if (tooltip && related.length > 0) {
      var lines = related.map(function (d) {
        var otherId = (typeof d.source === 'object' ? d.source.id : d.source) === nodeId
          ? (typeof d.target === 'object' ? d.target.id : d.target)
          : (typeof d.source === 'object' ? d.source.id : d.source);
        var otherNode = nodesData.find(function (n) { return n.id === otherId; });
        var name = otherNode ? otherNode.label : '#' + otherId;
        return name + ': ' + (d.score * 100).toFixed(1) + '%';
      });
      tooltip.innerHTML = '<strong>Semantic Links</strong><br>' + lines.join('<br>');
      tooltip.style.display = 'block';
      var cr = container.getBoundingClientRect();
      tooltip.style.left = (mouseEvent.clientX - cr.left + 12) + 'px';
      tooltip.style.top = (mouseEvent.clientY - cr.top - 10) + 'px';
    }
  }

  function unhighlightSemantic() {
    if (!gSemanticLinks) return;
    gSemanticLinks.selectAll('line.aether-net-semantic')
      .attr('stroke', SEMANTIC_COLOR)
      .attr('stroke-width', 1.2)
      .attr('opacity', 0.35);
    gLinks.selectAll('line.aether-net-link')
      .attr('opacity', 0.65);
    gNodes.selectAll('circle.aether-net-node')
      .attr('fill-opacity', 0.2)
      .attr('stroke-opacity', 0.8);
    if (tooltip) tooltip.style.display = 'none';
  }

  // ══════════════════════════════════════════════════════════════
  //  Explosion animation (TREE → NETWORK)
  // ══════════════════════════════════════════════════════════════

  function explosionEnter() {
    // Start all nodes at center, then let the simulation "explode" them outward
    // Nodes keep their tree-aware initial offsets but are compressed toward center
    var cx = width / 2, cy = height / 2;
    nodesData.forEach(function (d) {
      // Compress toward center but preserve direction from initial layout
      var dx = d.x - cx, dy = d.y - cy;
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      // Start close to center (15% of computed position) so the explosion is visible
      d.x = cx + (dx / dist) * Math.min(dist * 0.15, 20) + (Math.random() - 0.5) * 8;
      d.y = cy + (dy / dist) * Math.min(dist * 0.15, 20) + (Math.random() - 0.5) * 8;
    });
    if (simulation) simulation.alpha(1).restart();
  }

  // ══════════════════════════════════════════════════════════════
  //  Activate / Deactivate / Refresh
  // ══════════════════════════════════════════════════════════════

  function activate(parentEl, aetherNodes, aetherBranches) {
    var d3 = getD3();
    if (!d3) {
      console.error('[AetherNet] Cannot activate — D3.js not available');
      return;
    }
    isActive = true;
    lastNodesArr = aetherNodes;
    lastBranchesArr = aetherBranches;

    createCanvas(parentEl);
    var rect = container.getBoundingClientRect();
    width = rect.width || 800;
    height = rect.height || 600;
    svgRoot.attr('viewBox', '0 0 ' + width + ' ' + height);

    buildGraphData(aetherNodes, aetherBranches);
    initSimulation();
    render();
    explosionEnter();
    console.log('[AetherNet] Network activated');
  }

  function deactivate() {
    isActive = false;
    if (simulation) { simulation.stop(); simulation = null; }
    if (container) { container.remove(); container = null; }
    svgRoot = null;
    gLinks = null; gSemanticLinks = null; gNodes = null; gLabels = null;
    if (tooltip) { tooltip.remove(); tooltip = null; }
    nodesData = []; linksData = []; semanticData = [];
    lastNodesArr = null; lastBranchesArr = null;
    console.log('[AetherNet] Network deactivated');
  }

  function refreshWithData(aetherNodes, aetherBranches) {
    if (!isActive || !svgRoot) return;
    var oldPositions = {};
    nodesData.forEach(function (d) { oldPositions[d.id] = { x: d.x, y: d.y, vx: d.vx, vy: d.vy }; });
    buildGraphData(aetherNodes, aetherBranches);
    nodesData.forEach(function (d) {
      if (oldPositions[d.id]) {
        d.x = oldPositions[d.id].x;
        d.y = oldPositions[d.id].y;
        d.vx = oldPositions[d.id].vx;
        d.vy = oldPositions[d.id].vy;
      }
    });
    initSimulation();
    render();
    simulation.alpha(0.3).restart();
  }

  // ── Expose ──
  window.AetherNetwork = {
    activate: activate,
    deactivate: deactivate,
    refresh: refreshWithData,
    isActive: function () { return isActive; },
  };

  console.log('[AetherNet] Event listeners attached, module ready');
})();
