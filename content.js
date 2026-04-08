/**
 * Aether - Google AI Studio Enhancer
 * Turn grouping + AetherMind Graph sidebar (Git-style SVG)
 * One Branch button per User+Model pair. Fold/Branch/Graph.
 */
(function () {
  'use strict';

  // == Config ==
  const UNIT_CLS   = 'aether-turn-unit';
  const KEEP_CLS   = 'aether-keep-visible';
  const HIDEABLE   = 'aether-can-hide';
  const HIDDEN_CLS = 'aether-hidden';
  const COLLAPSED  = 'is-collapsed';
  const PROCESSED  = 'data-aether-processed';
  const GROUP_ATTR = 'data-aether-group';
  const TURN_SELECTORS = [
    'ms-chat-turn', '.conversation-turn', '.turn-container',
    '.chat-turn', '[data-turn-index]',
  ];
  const COLORS = [
    '#4285f4','#ea4335','#fbbc04','#34a853',
    '#ff6d01','#46bdc6','#ab47bc','#ec407a',
  ];

  // == State ==
  let groupCount = 0;
  const nodes = [];
  const branches = [{ id: 0, color: COLORS[0], fromNode: null }];
  let activeNodeId = null;
  let sidebarOpen = false;
  let sidebar, svgEl, labelBox, toggleBtn, intersectionObs;
  const visibleSet = new Set();

  // == Helpers ==
  function isUserEl(el) {
    const h = [el.getAttribute('role'), el.getAttribute('data-role'),
      el.getAttribute('ng-reflect-role'), el.className
    ].filter(Boolean).join(' ').toLowerCase();
    if (/user|human|prompt/.test(h)) return true;
    for (const c of el.children) {
      const x = (c.className + ' ' + (c.getAttribute('role') || '')).toLowerCase();
      if (/user|human|prompt/.test(x)) return true;
    }
    return false;
  }

  function getLabel(el) {
    const t = (el.innerText || el.textContent || '').trim();
    return t.slice(0, 50) + (t.length > 50 ? '...' : '') || 'Turn';
  }

  function findTurns() {
    for (const s of TURN_SELECTORS) {
      const r = document.querySelectorAll(s);
      if (r.length >= 2) return Array.from(r);
    }
    return [];
  }

  function buildGroups() {
    const turns = findTurns().filter(e => !e.hasAttribute(PROCESSED));
    if (turns.length < 2) return [];
    const groups = []; let cur = null;
    for (const el of turns) {
      if (isUserEl(el)) {
        if (cur && cur.length > 1) groups.push(cur);
        cur = [el];
      } else if (cur) cur.push(el);
    }
    if (cur && cur.length > 1) groups.push(cur);
    return groups;
  }

  // == UI Factories ==
  function makeFoldBtn(userEl, gid) {
    const b = document.createElement('button');
    b.className = 'aether-fold-btn';
    b.title = 'Collapse turn';
    b.setAttribute('aria-label','Collapse turn');
    b.innerHTML = '<span class="aether-fold-icon">\u25BE</span>';
    b.addEventListener('click', e => {
      e.stopPropagation(); e.preventDefault();
      const on = userEl.classList.toggle(COLLAPSED);
      document.querySelectorAll('.' + HIDEABLE + '[' + GROUP_ATTR + '="' + gid + '"]')
        .forEach(m => m.classList.toggle(HIDDEN_CLS, on));
      b.querySelector('.aether-fold-icon').textContent = on ? '\u25B8' : '\u25BE';
      b.title = on ? 'Expand turn' : 'Collapse turn';
    });
    return b;
  }

  function makeBranchBtn(nodeId) {
    const b = document.createElement('button');
    b.className = 'aether-branch-btn';
    b.title = 'Branch from here';
    b.setAttribute('aria-label','Branch conversation');
    b.innerHTML = '<span class="aether-branch-icon">\uD83C\uDF31</span>' +
                  '<span class="aether-branch-label">Branch</span>';
    b.addEventListener('click', e => {
      e.stopPropagation(); e.preventDefault();
      b.classList.add('aether-branch-btn--active');
      setTimeout(() => b.classList.remove('aether-branch-btn--active'), 400);
      doBranch(nodeId);
    });
    return b;
  }

  // == Tagging ==
  function tagGroup(members) {
    const id = ++groupCount;
    const userEl = members[0];
    userEl.classList.add(UNIT_CLS, KEEP_CLS);
    userEl.setAttribute(PROCESSED, 'true');
    userEl.setAttribute(GROUP_ATTR, String(id));
    if (getComputedStyle(userEl).position === 'static') userEl.style.position = 'relative';

    const modelEls = [];
    for (let i = 1; i < members.length; i++) {
      const m = members[i];
      m.classList.add(HIDEABLE);
      m.setAttribute(PROCESSED, 'true');
      m.setAttribute(GROUP_ATTR, String(id));
      if (getComputedStyle(m).position === 'static') m.style.position = 'relative';
      modelEls.push(m);
    }

    // Fold btn -> user top-right
    const bar = document.createElement('div');
    bar.className = 'aether-action-bar';
    bar.appendChild(makeFoldBtn(userEl, id));
    userEl.appendChild(bar);

    // Branch btn -> bottom of last model element
    const last = modelEls[modelEls.length - 1];
    const bbar = document.createElement('div');
    bbar.className = 'aether-branch-bar';
    bbar.appendChild(makeBranchBtn(id));
    last.appendChild(bbar);

    // Graph node
    const node = {
      id, branchId: 0,
      parentId: nodes.length > 0 ? nodes[nodes.length - 1].id : null,
      userEl, modelEls, label: getLabel(userEl),
    };
    nodes.push(node);
    if (intersectionObs) intersectionObs.observe(userEl);
    renderGraph();
    console.log('[Aether] Group ' + id + ': "' + node.label + '"');
  }

  function captureOrphans() {
    document.querySelectorAll('.' + UNIT_CLS).forEach(userEl => {
      const gid = userEl.getAttribute(GROUP_ATTR);
      let nx = userEl.nextElementSibling;
      while (nx) {
        if (nx.classList.contains(UNIT_CLS)) break;
        if (nx.hasAttribute(PROCESSED)) { nx = nx.nextElementSibling; continue; }
        const isT = TURN_SELECTORS.some(s => { try { return nx.matches(s); } catch { return false; } });
        if (isT && isUserEl(nx)) break;
        if (isT) {
          nx.classList.add(HIDEABLE);
          nx.setAttribute(PROCESSED, 'true');
          nx.setAttribute(GROUP_ATTR, gid);
          if (getComputedStyle(nx).position === 'static') nx.style.position = 'relative';
          if (userEl.classList.contains(COLLAPSED)) nx.classList.add(HIDDEN_CLS);
          const nd = nodes.find(n => n.id === parseInt(gid));
          if (nd) nd.modelEls.push(nx);
          console.log('[Aether] Orphan -> group ' + gid);
        }
        nx = nx.nextElementSibling;
      }
    });
  }

  // == Branching ==
  function doBranch(fromNodeId) {
    const bid = branches.length;
    const color = COLORS[bid % COLORS.length];
    branches.push({ id: bid, color, fromNode: fromNodeId });
    console.info('[Aether] Branch ' + bid + ' from node ' + fromNodeId + ' (' + color + ')');
    document.dispatchEvent(new CustomEvent('aether:branch', {
      detail: { fromNodeId, branchId: bid, color }, bubbles: true,
    }));
    renderGraph();
  }

  // == Sidebar ==
  function createSidebar() {
    toggleBtn = document.createElement('button');
    toggleBtn.className = 'aether-sidebar-toggle';
    toggleBtn.innerHTML = '<span class="aether-toggle-icon">\uD83C\uDF3F</span>';
    toggleBtn.title = 'AetherMind Graph';
    toggleBtn.addEventListener('click', () => {
      sidebarOpen = !sidebarOpen;
      sidebar.classList.toggle('aether-sidebar--open', sidebarOpen);
      toggleBtn.classList.toggle('aether-toggle--open', sidebarOpen);
    });
    document.body.appendChild(toggleBtn);

    sidebar = document.createElement('div');
    sidebar.className = 'aether-sidebar';
    sidebar.innerHTML =
      '<div class="aether-sidebar-header">' +
        '<span class="aether-sidebar-title">AetherMind Graph</span>' +
        '<span class="aether-sidebar-count"></span>' +
      '</div>' +
      '<div class="aether-sidebar-scroll"></div>';
    document.body.appendChild(sidebar);

    const scroll = sidebar.querySelector('.aether-sidebar-scroll');
    svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.setAttribute('class', 'aether-graph-svg');
    scroll.appendChild(svgEl);
    labelBox = document.createElement('div');
    labelBox.className = 'aether-graph-labels';
    scroll.appendChild(labelBox);
  }

  // == Graph Rendering ==
  var G = { r: 5, gap: 48, colW: 18, pL: 24, pT: 24 };

  function nXY(node) {
    var i = nodes.indexOf(node);
    return { x: G.pL + node.branchId * G.colW, y: G.pT + i * G.gap };
  }

  function renderGraph() {
    if (!svgEl) return;
    var cnt = sidebar.querySelector('.aether-sidebar-count');
    if (cnt) cnt.textContent = nodes.length + ' turn' + (nodes.length !== 1 ? 's' : '');

    var maxCol = 0;
    for (var b = 0; b < branches.length; b++) if (branches[b].id > maxCol) maxCol = branches[b].id;
    var totalH = G.pT + Math.max(1, nodes.length) * G.gap + 20;
    var labX = G.pL + (maxCol + 1) * G.colW + 14;
    var totalW = labX + 160;

    svgEl.setAttribute('width', String(totalW));
    svgEl.setAttribute('height', String(totalH));
    svgEl.setAttribute('viewBox', '0 0 ' + totalW + ' ' + totalH);
    svgEl.innerHTML = '';
    labelBox.innerHTML = '';
    labelBox.style.height = totalH + 'px';

    // Vertical lines
    branches.forEach(function(br) {
      var bn = nodes.filter(function(n) { return n.branchId === br.id; });
      if (bn.length < 2) return;
      var f = nXY(bn[0]), l = nXY(bn[bn.length - 1]);
      svgEl.appendChild(mkLine(f.x, f.y, f.x, l.y, br.color, '1.5'));
    });

    // Branch connectors
    branches.forEach(function(br) {
      if (br.fromNode === null) return;
      var par = nodes.find(function(n) { return n.id === br.fromNode; });
      if (!par) return;
      var p = nXY(par);
      var bx = G.pL + br.id * G.colW;
      var bn = nodes.filter(function(n) { return n.branchId === br.id; });
      var by = bn.length ? nXY(bn[0]).y : p.y + G.gap * 0.6;
      var cpOff = Math.abs(by - p.y) * 0.4;
      var d = 'M' + p.x + ',' + p.y + ' C' + p.x + ',' + (p.y + cpOff) +
              ' ' + bx + ',' + (by - cpOff) + ' ' + bx + ',' + by;
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('stroke', br.color);
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      svgEl.appendChild(path);
      if (bn.length === 0) {
        svgEl.appendChild(mkCircle(bx, by, G.r - 1, 'none', br.color, '1.5', null));
        var lb = mkLbl('Branch ' + br.id, labX, by - 7, false);
        lb.style.color = br.color;
        lb.style.fontStyle = 'italic';
        lb.style.fontSize = '10px';
        labelBox.appendChild(lb);
      }
    });

    // Nodes
    nodes.forEach(function(node) {
      var pos = nXY(node);
      var br = branches[node.branchId] || branches[0];
      var act = node.id === activeNodeId;
      if (act) {
        svgEl.appendChild(mkCircle(pos.x, pos.y, G.r + 4, 'none', br.color, '1', '0.25'));
      }
      var fill = act ? br.color : '#1a1a1a';
      var sw = act ? '2.5' : '1.5';
      var c = mkCircle(pos.x, pos.y, act ? G.r + 1 : G.r, fill, br.color, sw, null);
      c.classList.add('aether-graph-node');
      c.dataset.nodeId = String(node.id);
      c.style.cursor = 'pointer';
      c.addEventListener('click', function() { scrollToNode(node.id); });
      svgEl.appendChild(c);

      var lb = mkLbl(node.label, labX, pos.y - 7, act);
      lb.addEventListener('click', function() { scrollToNode(node.id); });
      labelBox.appendChild(lb);
    });
  }

  function mkLine(x1, y1, x2, y2, col, sw) {
    var l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('stroke', col); l.setAttribute('stroke-width', sw);
    l.setAttribute('stroke-linecap', 'round');
    return l;
  }

  function mkCircle(cx, cy, r, fill, stroke, sw, op) {
    var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
    c.setAttribute('fill', fill); c.setAttribute('stroke', stroke);
    c.setAttribute('stroke-width', sw);
    if (op) c.setAttribute('opacity', op);
    return c;
  }

  function mkLbl(text, left, top, active) {
    var d = document.createElement('div');
    d.className = 'aether-graph-label' + (active ? ' aether-graph-label--active' : '');
    d.textContent = text;
    d.style.top = top + 'px';
    d.style.left = left + 'px';
    return d;
  }

  // == Navigation ==
  function scrollToNode(id) {
    var node = nodes.find(function(n) { return n.id === id; });
    if (!node) return;
    node.userEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setActiveNode(id);
  }

  function setActiveNode(id) {
    if (id === activeNodeId) return;
    activeNodeId = id;
    renderGraph();
  }

  // == Intersection Observer ==
  function setupIntersection() {
    intersectionObs = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        var gid = parseInt(entry.target.getAttribute(GROUP_ATTR));
        if (isNaN(gid)) return;
        if (entry.isIntersecting) visibleSet.add(gid); else visibleSet.delete(gid);
      });
      if (visibleSet.size) {
        var top = Math.min.apply(null, Array.from(visibleSet));
        if (top !== activeNodeId) setActiveNode(top);
      }
    }, { threshold: 0.3 });
  }

  // == Diagnostics ==
  function diagnose() {
    console.groupCollapsed('[Aether] Diagnostic');
    var tags = new Set();
    document.querySelectorAll('*').forEach(function(el) {
      var t = el.tagName.toLowerCase();
      if (t.startsWith('ms-') || t.startsWith('mat-')) tags.add(t);
    });
    console.log('Custom elements:', Array.from(tags).sort());
    TURN_SELECTORS.forEach(function(sel) {
      var n = document.querySelectorAll(sel).length;
      console.log((n ? 'Y' : 'N') + ' "' + sel + '" -> ' + n);
    });
    console.log('Nodes:', nodes.length, '| Branches:', branches.length);
    console.groupEnd();
  }

  // == Main ==
  function run() {
    var groups = buildGroups();
    if (groups.length) groups.forEach(tagGroup);
    captureOrphans();
  }

  createSidebar();
  setupIntersection();

  var mutObs = new MutationObserver(function(muts) {
    for (var i = 0; i < muts.length; i++) {
      if (muts[i].addedNodes.length) { requestAnimationFrame(run); return; }
    }
  });
  mutObs.observe(document.body, { childList: true, subtree: true });

  console.log('[Aether] Loaded on ' + location.href);
  run();
  setTimeout(run, 2000);
  setTimeout(function() { run(); diagnose(); }, 5000);
})();
