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
    nodesData = aetherNodes.map(function (n) {
      var br = null;
      for (var i = 0; i < aetherBranches.length; i++) {
        if (aetherBranches[i] && aetherBranches[i].id === n.branchId) { br = aetherBranches[i]; break; }
      }
      var obj = {
        id: n.id,
        label: n.label || 'Turn',
        branchId: n.branchId,
        parentId: n.parentId,
        color: br ? br.color : '#4285f4',
        x: width / 2 + (Math.random() - 0.5) * 20,
        y: height / 2 + (Math.random() - 0.5) * 20,
      };
      nodeMap[n.id] = obj;
      return obj;
    });

    linksData = [];
    aetherNodes.forEach(function (n) {
      if (n.parentId != null && nodeMap[n.parentId]) {
        linksData.push({
          source: n.parentId,
          target: n.id,
          type: 'parent',
          color: nodeMap[n.id].color,
        });
      }
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
    console.log('[AetherNet] Graph data: ' + nodesData.length + ' nodes, ' +
      linksData.length + ' parent links, ' + semanticData.length + ' semantic links');
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
      .force('charge', d3.forceManyBody().strength(-180))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(28))
      .force('parentLinks', d3.forceLink(linksData)
        .id(function (d) { return d.id; })
        .distance(60)
        .strength(0.8))
      .force('semanticLinks', d3.forceLink(semanticData)
        .id(function (d) { return d.id; })
        .distance(120)
        .strength(function (d) { return (d.score || 0.5) * 0.2; }))
      .alphaDecay(0.02)
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
      .attr('stroke-width', 1.5)
      .attr('stroke-linecap', 'round')
      .merge(linkSel)
      .attr('stroke', function (d) { return d.color; })
      .attr('opacity', 0.5);

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
        return (sId === nodeId || tId === nodeId) ? 0.6 : 0.1;
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
      .attr('opacity', 0.5);
    gNodes.selectAll('circle.aether-net-node')
      .attr('fill-opacity', 0.2)
      .attr('stroke-opacity', 0.8);
    if (tooltip) tooltip.style.display = 'none';
  }

  // ══════════════════════════════════════════════════════════════
  //  Explosion animation (TREE → NETWORK)
  // ══════════════════════════════════════════════════════════════

  function explosionEnter() {
    nodesData.forEach(function (d) {
      d.x = width / 2 + (Math.random() - 0.5) * 30;
      d.y = height / 2 + (Math.random() - 0.5) * 30;
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
