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

  const BRANCH_ATTR = 'data-aether-branch';

  // == State ==
  let groupCount = 0;
  const nodes = [];
  const branches = [{ id: 0, name: 'main', color: COLORS[0], fromNode: null }];
  let activeBranchId = 0;
  let activeNodeId = null;
  let sidebarOpen = false;
  let sidebar, svgEl, labelBox, toggleBtn, intersectionObs, statusBarEl, ctxMenu;
  const visibleSet = new Set();
  let runTimer = null;
  const RUN_DEBOUNCE = 600;
  let lastUrl = location.href;
  const STORAGE_KEY = 'aether_custom_labels';
  const BRANCH_STORAGE_KEY = 'aether_branches';
  let customLabels = {};

  // == Storage helpers ==
  function storageKey() {
    // Scope labels per playground URL path (ignore query/hash)
    return STORAGE_KEY + ':' + location.pathname;
  }

  function loadCustomLabels(cb) {
    var key = storageKey();
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(key, function(result) {
        customLabels = result[key] || {};
        console.log('[Aether] Loaded ' + Object.keys(customLabels).length + ' custom label(s)');
        if (cb) cb();
      });
    } else {
      // Fallback for dev/testing without extension context
      try { customLabels = JSON.parse(localStorage.getItem(key) || '{}'); } catch(e) { customLabels = {}; }
      if (cb) cb();
    }
  }

  function saveCustomLabels() {
    var key = storageKey();
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      var data = {};
      data[key] = customLabels;
      chrome.storage.local.set(data);
    } else {
      try { localStorage.setItem(key, JSON.stringify(customLabels)); } catch(e) {}
    }
  }

  // Branch persistence
  function branchStorageKey() { return BRANCH_STORAGE_KEY + ':' + location.pathname; }

  function saveBranches() {
    var key = branchStorageKey();
    var data = branches.map(function(b) {
      return { id: b.id, name: b.name, color: b.color, fromNode: b.fromNode };
    });
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      var obj = {}; obj[key] = data;
      chrome.storage.local.set(obj);
    } else {
      try { localStorage.setItem(key, JSON.stringify(data)); } catch(e) {}
    }
  }

  function loadBranches(cb) {
    var key = branchStorageKey();
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(key, function(result) {
        var saved = result[key];
        if (saved && saved.length) {
          branches.length = 0;
          saved.forEach(function(b) { branches.push(b); });
          console.log('[Aether] Loaded ' + branches.length + ' branch(es)');
        }
        if (cb) cb();
      });
    } else {
      try {
        var saved = JSON.parse(localStorage.getItem(key) || '[]');
        if (saved.length) { branches.length = 0; saved.forEach(function(b) { branches.push(b); }); }
      } catch(e) {}
      if (cb) cb();
    }
  }

  function getCustomLabel(nodeId) {
    return customLabels[String(nodeId)] || null;
  }

  function setCustomLabel(nodeId, text) {
    if (text) customLabels[String(nodeId)] = text;
    else delete customLabels[String(nodeId)];
    saveCustomLabels();
  }

  // Resolve display label: custom > auto-extracted
  function resolveLabel(node) {
    return getCustomLabel(node.id) || getLabel(node.userEl);
  }

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

  // Material Icon ligatures & button text to strip from labels
  const ICON_NOISE = /\b(edit_more_vert|more_vert|edit|content_copy|thumb_up|thumb_down|volume_up|share|replay|stop|close|menu|add|send|mic|attach_file|image|code|delete|check|done|arrow_drop_down|expand_more|expand_less|chevron_right|chevron_left|keyboard_arrow_down|keyboard_arrow_up)\b/gi;

  function getLabel(el) {
    // Try to find a dedicated text container first
    const candidates = el.querySelectorAll(
      'p, .user-message, .prompt-text, .text-content, ' +
      '.query-text, [data-text], .turn-text, .message-content'
    );
    let raw = '';
    for (const c of candidates) {
      const t = (c.innerText || c.textContent || '').trim();
      if (t.length > 2) { raw = t; break; }
    }
    // Fallback: collect text nodes directly, skipping buttons/icons
    if (!raw) {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          const tag = p.tagName.toLowerCase();
          if (tag === 'button' || tag === 'mat-icon' || tag === 'ms-icon' ||
              tag === 'mat-button' || p.classList.contains('mat-icon') ||
              p.classList.contains('material-icons') ||
              p.closest('button') || p.closest('mat-icon') ||
              p.closest('.aether-action-bar') || p.closest('.aether-branch-bar')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const parts = [];
      let n;
      while ((n = walk.nextNode())) {
        const t = n.textContent.trim();
        if (t) parts.push(t);
      }
      raw = parts.join(' ');
    }
    // Strip leftover icon ligature names
    raw = raw.replace(ICON_NOISE, '').replace(/\s{2,}/g, ' ').trim();
    if (!raw) return 'Turn';
    const MAX = 20;
    return raw.length > MAX ? raw.slice(0, MAX) + '...' : raw;
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
      showBranchDialog(nodeId);
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

    // Graph node — all scanned nodes go to branch 0 (main) by default
    const node = {
      id, branchId: activeBranchId,
      parentId: nodes.length > 0 ? nodes[nodes.length - 1].id : null,
      userEl, modelEls, label: 'Turn',
      custom: false,
    };
    // Resolve label: custom (persisted) > auto-extracted
    var cust = getCustomLabel(id);
    if (cust) { node.label = cust; node.custom = true; }
    else { node.label = getLabel(userEl); }
    // Tag DOM with branch id
    userEl.setAttribute(BRANCH_ATTR, String(node.branchId));
    modelEls.forEach(function(m) { m.setAttribute(BRANCH_ATTR, String(node.branchId)); });
    nodes.push(node);
    if (intersectionObs) intersectionObs.observe(userEl);
    applyFocusMode();
    renderGraph();
    console.log('[Aether] Group ' + id + ' (branch ' + node.branchId + '): "' + node.label + '"');
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
  function doBranch(fromNodeId, branchName) {
    const bid = branches.length;
    const color = COLORS[bid % COLORS.length];
    const name = branchName || ('Branch_' + bid);
    branches.push({ id: bid, name: name, color: color, fromNode: fromNodeId });
    saveBranches();
    console.info('[Aether] Branch "' + name + '" (id=' + bid + ') from node ' + fromNodeId + ' (' + color + ')');
    document.dispatchEvent(new CustomEvent('aether:branch', {
      detail: { fromNodeId, branchId: bid, color, name }, bubbles: true,
    }));
    switchBranch(bid);
  }

  function switchBranch(bid) {
    activeBranchId = bid;
    applyFocusMode();
    updateStatusBar();
    renderGraph();
    console.log('[Aether] Switched to branch: ' + (branches[bid] ? branches[bid].name : bid));
  }

  // == Focus Mode ==
  function getAncestorChain(branchId) {
    // Build set of visible node IDs: all nodes on active branch,
    // plus all ancestors up to root along the parent chain
    var br = branches[branchId];
    if (!br) return new Set();
    var visibleNodes = new Set();
    // All nodes on this branch
    nodes.forEach(function(n) { if (n.branchId === branchId) visibleNodes.add(n.id); });
    // Walk up parent branch: if branch has a fromNode, include all nodes
    // on the parent branch from root up to (and including) fromNode
    if (br.fromNode !== null) {
      var parentNode = nodes.find(function(n) { return n.id === br.fromNode; });
      if (parentNode) {
        // Include all nodes on parent's branch up to the fork point
        var pbid = parentNode.branchId;
        nodes.forEach(function(n) {
          if (n.branchId === pbid) {
            visibleNodes.add(n.id);
            // Stop adding after the fork node
            if (n.id === br.fromNode) return;
          }
        });
        // Recursively include ancestors of parent branch
        var parentAncestors = getAncestorChain(pbid);
        parentAncestors.forEach(function(nid) { visibleNodes.add(nid); });
      }
    }
    return visibleNodes;
  }

  function applyFocusMode() {
    if (activeBranchId === 0) {
      // main branch: show everything
      nodes.forEach(function(n) {
        showNodeDom(n, true);
      });
      return;
    }
    var visible = getAncestorChain(activeBranchId);
    // Also: for main branch (0), show nodes up to the fork point
    var activeBr = branches[activeBranchId];
    if (activeBr && activeBr.fromNode !== null) {
      // Show main-branch nodes only up to fork point
      var forkId = activeBr.fromNode;
      var pastFork = false;
      nodes.forEach(function(n) {
        if (n.branchId === 0) {
          if (pastFork && !visible.has(n.id)) {
            showNodeDom(n, false);
          } else {
            showNodeDom(n, true);
          }
          if (n.id === forkId) pastFork = true;
        } else if (n.branchId === activeBranchId) {
          showNodeDom(n, true);
        } else {
          showNodeDom(n, !visible.has(n.id) ? false : true);
        }
      });
    } else {
      nodes.forEach(function(n) {
        showNodeDom(n, visible.has(n.id));
      });
    }
  }

  function showNodeDom(node, show) {
    var cls = 'aether-branch-hidden';
    if (show) {
      node.userEl.classList.remove(cls);
      node.modelEls.forEach(function(m) { m.classList.remove(cls); });
    } else {
      node.userEl.classList.add(cls);
      node.modelEls.forEach(function(m) { m.classList.add(cls); });
    }
  }

  // == Branch naming dialog ==
  function showBranchDialog(fromNodeId) {
    // Remove existing dialog
    var old = document.querySelector('.aether-branch-dialog');
    if (old) old.remove();
    var defaultName = 'Branch_' + branches.length;
    var overlay = document.createElement('div');
    overlay.className = 'aether-branch-dialog-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'aether-branch-dialog';
    dialog.innerHTML =
      '<div class="aether-dialog-title">\uD83C\uDF31 New Branch from Turn #' + fromNodeId + '</div>' +
      '<input type="text" class="aether-dialog-input" placeholder="' + defaultName + '" value="' + defaultName + '">' +
      '<div class="aether-dialog-actions">' +
        '<button class="aether-dialog-btn aether-dialog-cancel">Cancel</button>' +
        '<button class="aether-dialog-btn aether-dialog-confirm">Create</button>' +
      '</div>';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    var input = dialog.querySelector('.aether-dialog-input');
    input.focus(); input.select();

    function doCreate() {
      var name = input.value.trim() || defaultName;
      overlay.remove();
      doBranch(fromNodeId, name);
    }
    function doCancel() { overlay.remove(); }
    dialog.querySelector('.aether-dialog-confirm').addEventListener('click', doCreate);
    dialog.querySelector('.aether-dialog-cancel').addEventListener('click', doCancel);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); doCreate(); }
      if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
    });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) doCancel();
    });
  }

  // == Context menu ==
  function createCtxMenu() {
    ctxMenu = document.createElement('div');
    ctxMenu.className = 'aether-ctx-menu';
    ctxMenu.style.display = 'none';
    ctxMenu.innerHTML =
      '<div class="aether-ctx-item" data-action="branch">\uD83C\uDF31 New Branch from here</div>' +
      '<div class="aether-ctx-item" data-action="switch-main">\u2B95 Switch to main</div>';
    document.body.appendChild(ctxMenu);
    // Close on click-away
    document.addEventListener('click', function() { ctxMenu.style.display = 'none'; });
  }

  function showCtxMenu(x, y, nodeId) {
    if (!ctxMenu) createCtxMenu();
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
    ctxMenu.style.display = '';
    // Rebind actions for this node
    var items = ctxMenu.querySelectorAll('.aether-ctx-item');
    items.forEach(function(item) {
      var clone = item.cloneNode(true);
      item.parentNode.replaceChild(clone, item);
    });
    var branchItem = ctxMenu.querySelector('[data-action="branch"]');
    var switchItem = ctxMenu.querySelector('[data-action="switch-main"]');
    branchItem.addEventListener('click', function(e) {
      e.stopPropagation();
      ctxMenu.style.display = 'none';
      showBranchDialog(nodeId);
    });
    switchItem.addEventListener('click', function(e) {
      e.stopPropagation();
      ctxMenu.style.display = 'none';
      switchBranch(0);
    });
    // Add branch-specific switch options
    var existingExtras = ctxMenu.querySelectorAll('.aether-ctx-item--dynamic');
    existingExtras.forEach(function(el) { el.remove(); });
    branches.forEach(function(br) {
      if (br.id === 0) return;
      var d = document.createElement('div');
      d.className = 'aether-ctx-item aether-ctx-item--dynamic';
      d.textContent = '\u2B95 Switch to ' + br.name;
      if (br.id === activeBranchId) { d.style.fontWeight = '600'; d.style.color = br.color; }
      d.addEventListener('click', function(e) {
        e.stopPropagation();
        ctxMenu.style.display = 'none';
        switchBranch(br.id);
      });
      ctxMenu.appendChild(d);
    });
  }

  // == Status Bar ==
  function createStatusBar() {
    statusBarEl = document.createElement('div');
    statusBarEl.className = 'aether-status-bar';
    statusBarEl.style.display = 'none';
    document.body.appendChild(statusBarEl);
  }

  function updateStatusBar() {
    if (!statusBarEl) return;
    var br = branches[activeBranchId];
    if (!br || activeBranchId === 0) {
      statusBarEl.style.display = 'none';
      return;
    }
    statusBarEl.style.display = '';
    statusBarEl.innerHTML = '';
    var dot = document.createElement('span');
    dot.className = 'aether-status-dot';
    dot.style.background = br.color;
    statusBarEl.appendChild(dot);
    var txt = document.createElement('span');
    txt.className = 'aether-status-text';
    txt.textContent = 'Active Branch: ' + br.name;
    statusBarEl.appendChild(txt);
    var exitBtn = document.createElement('button');
    exitBtn.className = 'aether-status-exit';
    exitBtn.textContent = '\u2715 Back to main';
    exitBtn.addEventListener('click', function() { switchBranch(0); });
    statusBarEl.appendChild(exitBtn);
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
      c.addEventListener('click', function() {
        scrollToNode(node.id);
        // Auto-switch to this node's branch
        if (node.branchId !== activeBranchId) switchBranch(node.branchId);
      });
      c.addEventListener('contextmenu', function(e) {
        e.preventDefault(); e.stopPropagation();
        showCtxMenu(e.pageX, e.pageY, node.id);
      });
      svgEl.appendChild(c);

      var lb = mkLbl(node.label, labX, pos.y - 7, act, node.id);
      lb.addEventListener('click', function() {
        scrollToNode(node.id);
        if (node.branchId !== activeBranchId) switchBranch(node.branchId);
      });
      lb.addEventListener('contextmenu', function(e) {
        e.preventDefault(); e.stopPropagation();
        showCtxMenu(e.pageX, e.pageY, node.id);
      });
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

  function mkLbl(text, left, top, active, nodeId) {
    var d = document.createElement('div');
    d.className = 'aether-graph-label' + (active ? ' aether-graph-label--active' : '');
    if (getCustomLabel(nodeId)) d.classList.add('aether-graph-label--custom');
    d.textContent = text;
    d.title = 'Double-click to rename';
    d.style.top = top + 'px';
    d.style.left = left + 'px';
    // Double-click to inline-edit
    d.addEventListener('dblclick', function(e) {
      e.stopPropagation();
      startInlineEdit(d, nodeId);
    });
    return d;
  }

  // == Inline editing ==
  function startInlineEdit(labelEl, nodeId) {
    if (labelEl.querySelector('input')) return; // already editing
    var node = nodes.find(function(n) { return n.id === nodeId; });
    if (!node) return;
    var origText = node.label;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'aether-label-input';
    input.value = origText;
    labelEl.textContent = '';
    labelEl.appendChild(input);
    input.focus();
    input.select();

    var committed = false;
    function commit() {
      if (committed) return;
      committed = true;
      var val = input.value.trim();
      if (val && val !== origText) {
        node.label = val;
        node.custom = true;
        setCustomLabel(nodeId, val);
      } else if (!val) {
        // Empty = reset to auto
        node.label = getLabel(node.userEl);
        node.custom = false;
        setCustomLabel(nodeId, null);
      }
      renderGraph();
    }
    function cancel() {
      if (committed) return;
      committed = true;
      renderGraph();
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
  }

  // == Navigation ==
  function scrollToNode(id) {
    var node = nodes.find(function(n) { return n.id === id; });
    if (!node) return;
    // Make sure the node is visible before scrolling
    if (node.branchId !== activeBranchId) switchBranch(node.branchId);
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

  // == Refresh labels after streaming settles ==
  function refreshLabels() {
    var changed = false;
    nodes.forEach(function(node) {
      // Skip nodes with custom (user-renamed) labels
      if (node.custom) return;
      var fresh = getLabel(node.userEl);
      if (fresh !== node.label && fresh !== 'Turn') {
        node.label = fresh;
        changed = true;
      }
    });
    if (changed) renderGraph();
  }

  // == URL change detection (SPA navigation) ==
  function checkUrlChange() {
    if (location.href !== lastUrl) {
      console.log('[Aether] URL changed: ' + lastUrl + ' -> ' + location.href);
      lastUrl = location.href;
      resetState();
    }
  }

  function resetState() {
    // Clear all aether tags from DOM
    document.querySelectorAll('[' + PROCESSED + ']').forEach(function(el) {
      el.removeAttribute(PROCESSED);
      el.removeAttribute(GROUP_ATTR);
      el.removeAttribute(BRANCH_ATTR);
      el.classList.remove(UNIT_CLS, KEEP_CLS, HIDEABLE, HIDDEN_CLS, COLLAPSED, 'aether-branch-hidden');
    });
    document.querySelectorAll('.aether-action-bar, .aether-branch-bar').forEach(function(el) {
      el.remove();
    });
    // Reset JS state
    groupCount = 0;
    nodes.length = 0;
    branches.length = 0;
    branches.push({ id: 0, name: 'main', color: COLORS[0], fromNode: null });
    activeBranchId = 0;
    activeNodeId = null;
    visibleSet.clear();
    updateStatusBar();
    renderGraph();
    // Re-scan with retries for SPA lazy-load
    initialScan();
  }

  // == Initial scan with retries ==
  function initialScan() {
    var attempts = 0;
    var maxAttempts = 8;
    function tryOnce() {
      run();
      refreshLabels();
      attempts++;
      if (nodes.length === 0 && attempts < maxAttempts) {
        setTimeout(tryOnce, 800 * attempts);
      } else {
        console.log('[Aether] Initial scan done: ' + nodes.length + ' nodes after ' + attempts + ' attempt(s)');
      }
    }
    tryOnce();
  }

  // == Main ==
  function run() {
    var groups = buildGroups();
    if (groups.length) groups.forEach(tagGroup);
    captureOrphans();
  }

  // Debounced run — waits for streaming to settle
  function scheduleRun() {
    if (runTimer) clearTimeout(runTimer);
    runTimer = setTimeout(function() {
      runTimer = null;
      run();
      refreshLabels();
    }, RUN_DEBOUNCE);
  }

  createSidebar();
  setupIntersection();

  var mutObs = new MutationObserver(function(muts) {
    var hasNew = false;
    for (var i = 0; i < muts.length; i++) {
      if (muts[i].addedNodes.length) { hasNew = true; break; }
    }
    if (hasNew) scheduleRun();
    checkUrlChange();
  });
  mutObs.observe(document.body, { childList: true, subtree: true });

  // Also detect History API navigation (pushState/replaceState)
  var origPush = history.pushState;
  var origReplace = history.replaceState;
  history.pushState = function() {
    origPush.apply(this, arguments);
    setTimeout(checkUrlChange, 100);
  };
  history.replaceState = function() {
    origReplace.apply(this, arguments);
    setTimeout(checkUrlChange, 100);
  };
  window.addEventListener('popstate', function() { setTimeout(checkUrlChange, 100); });

  console.log('[Aether] Loaded on ' + location.href);
  createStatusBar();
  createCtxMenu();
  // Load persisted data, then scan
  loadCustomLabels(function() {
    loadBranches(function() {
      initialScan();
      updateStatusBar();
    });
  });
  setTimeout(function() { refreshLabels(); diagnose(); }, 5000);
})();
