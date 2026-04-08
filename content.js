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
  let customLabels = {};
  var saveIndicator;
  var saveTimer = null;

  // == Chat ID & Unified Storage ==
  function getChatId() {
    var m = location.pathname.match(/\/prompts?\/([^\/\?#]+)/);
    if (m) return m[1];
    return location.pathname.replace(/\//g, '_') || '_root';
  }

  function stateKey() { return 'aether_state:' + getChatId(); }

  function serializeNodes() {
    return nodes.map(function(n) {
      var snippet = '';
      try { snippet = getLabel(n.userEl); } catch(e) {}
      return {
        id: n.id, branchId: n.branchId, parentId: n.parentId,
        label: n.label, custom: n.custom, textSnippet: snippet
      };
    });
  }

  function saveState() {
    var key = stateKey();
    var state = {
      nodes: serializeNodes(),
      branches: branches.filter(function(b) { return b !== null; }).map(function(b) {
        return { id: b.id, name: b.name, color: b.color, fromNode: b.fromNode };
      }),
      activeBranchId: activeBranchId,
      customLabels: customLabels,
      savedAt: Date.now()
    };
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      var obj = {}; obj[key] = state;
      chrome.storage.local.set(obj, function() { showSaveIndicator(); });
    } else {
      try { localStorage.setItem(key, JSON.stringify(state)); } catch(e) {}
      showSaveIndicator();
    }
  }

  function autoSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function() { saveTimer = null; saveState(); }, 300);
  }

  function loadState(cb) {
    var key = stateKey();
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(key, function(result) { cb(result[key] || null); });
    } else {
      try {
        var raw = localStorage.getItem(key);
        cb(raw ? JSON.parse(raw) : null);
      } catch(e) { cb(null); }
    }
  }

  function showSaveIndicator() {
    if (!saveIndicator) return;
    saveIndicator.textContent = '\u2713 saved';
    saveIndicator.classList.add('aether-save--visible');
    clearTimeout(saveIndicator._hideTimer);
    saveIndicator._hideTimer = setTimeout(function() {
      saveIndicator.classList.remove('aether-save--visible');
    }, 1500);
  }

  function getCustomLabel(nodeId) {
    return customLabels[String(nodeId)] || null;
  }

  function setCustomLabel(nodeId, text) {
    if (text) customLabels[String(nodeId)] = text;
    else delete customLabels[String(nodeId)];
    autoSave();
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
      e.preventDefault();
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
      e.preventDefault();
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
    autoSave();
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

  // == Rehydration ==
  function rehydrate(saved) {
    if (!saved || !saved.nodes || !saved.nodes.length) return false;
    console.log('[Aether] Rehydrating ' + saved.nodes.length + ' node(s), ' +
                (saved.branches ? saved.branches.length : 0) + ' branch(es)');

    // Restore branches
    if (saved.branches && saved.branches.length) {
      branches.length = 0;
      saved.branches.forEach(function(b) { branches.push(b); });
    }
    // Restore custom labels
    if (saved.customLabels) customLabels = saved.customLabels;
    // Restore active branch
    if (typeof saved.activeBranchId === 'number' && saved.activeBranchId < branches.length) {
      activeBranchId = saved.activeBranchId;
    }

    // Scan DOM for current turn groups
    var allTurns = findTurns();
    if (allTurns.length < 2) return false;

    var domGroups = [];
    var curG = null;
    for (var i = 0; i < allTurns.length; i++) {
      var el = allTurns[i];
      if (isUserEl(el)) {
        if (curG && curG.length > 1) domGroups.push(curG);
        curG = [el];
      } else if (curG) curG.push(el);
    }
    if (curG && curG.length > 1) domGroups.push(curG);
    if (domGroups.length === 0) return false;

    // Match saved nodes to DOM groups
    var usedDom = new Set();
    var matched = 0, lost = 0;

    for (var si = 0; si < saved.nodes.length; si++) {
      var sn = saved.nodes[si];
      var bestIdx = -1;

      // 1) Positional match
      if (si < domGroups.length && !usedDom.has(si)) {
        bestIdx = si;
      }

      // 2) Text-based fallback if positional text doesn't match
      if (bestIdx >= 0 && sn.textSnippet && sn.textSnippet !== 'Turn') {
        var posText = getLabel(domGroups[bestIdx][0]);
        var needle = sn.textSnippet.slice(0, 12);
        if (posText.indexOf(needle) < 0) {
          // Positional mismatch — search by text
          bestIdx = -1;
          for (var di = 0; di < domGroups.length; di++) {
            if (usedDom.has(di)) continue;
            var txt = getLabel(domGroups[di][0]);
            if (txt.indexOf(needle) >= 0) { bestIdx = di; break; }
          }
        }
      }

      // 3) Accept positional if no better option
      if (bestIdx < 0 && si < domGroups.length && !usedDom.has(si)) {
        bestIdx = si;
      }

      if (bestIdx >= 0) {
        usedDom.add(bestIdx);
        tagGroupFromSaved(domGroups[bestIdx], sn);
        matched++;
      } else {
        console.warn('[Aether] Lost node #' + sn.id + ' "' + sn.label + '"');
        lost++;
      }
    }

    // Tag any new DOM groups not in saved state (new messages added while plugin was off)
    for (var di = 0; di < domGroups.length; di++) {
      if (!usedDom.has(di) && !domGroups[di][0].hasAttribute(PROCESSED)) {
        tagGroup(domGroups[di]);
      }
    }

    console.log('[Aether] Rehydrated: ' + matched + ' matched, ' + lost + ' lost, ' + nodes.length + ' total');
    applyFocusMode();
    updateStatusBar();
    renderGraph();
    return true;
  }

  function tagGroupFromSaved(members, savedNode) {
    var id = savedNode.id;
    if (id > groupCount) groupCount = id;

    var userEl = members[0];
    userEl.classList.add(UNIT_CLS, KEEP_CLS);
    userEl.setAttribute(PROCESSED, 'true');
    userEl.setAttribute(GROUP_ATTR, String(id));
    if (getComputedStyle(userEl).position === 'static') userEl.style.position = 'relative';

    var modelEls = [];
    for (var i = 1; i < members.length; i++) {
      var m = members[i];
      m.classList.add(HIDEABLE);
      m.setAttribute(PROCESSED, 'true');
      m.setAttribute(GROUP_ATTR, String(id));
      if (getComputedStyle(m).position === 'static') m.style.position = 'relative';
      modelEls.push(m);
    }

    // Inject UI
    var bar = document.createElement('div');
    bar.className = 'aether-action-bar';
    bar.appendChild(makeFoldBtn(userEl, id));
    userEl.appendChild(bar);

    if (modelEls.length > 0) {
      var last = modelEls[modelEls.length - 1];
      var bbar = document.createElement('div');
      bbar.className = 'aether-branch-bar';
      bbar.appendChild(makeBranchBtn(id));
      last.appendChild(bbar);
    }

    // Restore node with saved metadata
    var node = {
      id: id,
      branchId: savedNode.branchId,
      parentId: savedNode.parentId,
      userEl: userEl,
      modelEls: modelEls,
      label: savedNode.custom ? savedNode.label : getLabel(userEl),
      custom: !!savedNode.custom
    };
    userEl.setAttribute(BRANCH_ATTR, String(node.branchId));
    modelEls.forEach(function(m) { m.setAttribute(BRANCH_ATTR, String(node.branchId)); });
    nodes.push(node);
    if (intersectionObs) intersectionObs.observe(userEl);
  }

  function initFromStorage() {
    loadState(function(saved) {
      if (saved && saved.nodes && saved.nodes.length) {
        var attempts = 0;
        var maxAttempts = 8;
        function tryRehydrate() {
          attempts++;
          if (rehydrate(saved)) {
            console.log('[Aether] Rehydration OK on attempt ' + attempts);
          } else if (attempts < maxAttempts) {
            setTimeout(tryRehydrate, 800 * attempts);
          } else {
            console.log('[Aether] Rehydration failed, falling back to scan');
            if (saved.branches && saved.branches.length) {
              branches.length = 0;
              saved.branches.forEach(function(b) { branches.push(b); });
            }
            if (saved.customLabels) customLabels = saved.customLabels;
            if (typeof saved.activeBranchId === 'number') activeBranchId = saved.activeBranchId;
            initialScan();
            updateStatusBar();
          }
        }
        tryRehydrate();
      } else {
        initialScan();
        updateStatusBar();
      }
    });
  }

  // == Branching ==
  function doBranch(fromNodeId, branchName) {
    const bid = branches.length;
    const color = COLORS[bid % COLORS.length];
    const name = branchName || ('Branch_' + bid);
    branches.push({ id: bid, name: name, color: color, fromNode: fromNodeId });
    autoSave();
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
    autoSave();
    console.log('[Aether] Switched to branch: ' + (branches[bid] ? branches[bid].name : bid));
  }

  function isBranchEmpty(branchId) {
    if (branchId === 0) return false; // never delete main
    return !nodes.some(function(n) { return n.branchId === branchId; });
  }

  function deleteBranch(branchId) {
    if (branchId === 0) return;
    var br = branches[branchId];
    if (!br) return;
    // Switch away if currently on this branch
    if (activeBranchId === branchId) switchBranch(0);
    // Remove branch (set to null to preserve indices for other branch ids)
    branches[branchId] = null;
    // Also remove any branches whose fromNode belongs to a node on the deleted branch
    // (rare, but keeps tree consistent)
    console.log('[Aether] Deleted branch "' + br.name + '" (id=' + branchId + ')');
    renderGraph();
    autoSave();
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

  // == Drag & Drop ==
  var customDrag = null;
  var dropZoneContainer = null;
  var ghostLayer = null;       // SVG <g> for prediction lines
  var predictionPath = null;   // SVG <path> for the animated ghost line
  var subtreeGhostG = null;    // SVG <g> for cloned subtree ghost
  var subtreeGhostLabels = null; // HTML container for ghost labels
  var detachedLines = [];      // Original lines dimmed during drag
  var rafId = null;            // requestAnimationFrame handle
  var dragSourceNodeId = null; // Currently dragged node id (shared by both mechanisms)
  var lastDragSvgPt = null;    // Last mouse position in SVG coords
  var snapBranchId = -1;       // Current snap target
  var SNAP_DIST = 28;          // px threshold for snap-to

  function setupDropZones() {
    if (!dropZoneContainer) {
      dropZoneContainer = document.createElement('div');
      dropZoneContainer.className = 'aether-dropzone-container';
      var scroll = sidebar.querySelector('.aether-sidebar-scroll');
      scroll.appendChild(dropZoneContainer);
    }
  }

  function showDropZones(excludeBranchId, srcNodeId) {
    if (!dropZoneContainer) return;
    dropZoneContainer.innerHTML = '';
    dropZoneContainer.classList.add('aether-dropzone--active');
    dragSourceNodeId = srcNodeId != null ? srcNodeId : null;
    initGhostLayer();
    applyDetachFeedback(srcNodeId);
    var totalH = G.pT + Math.max(1, nodes.length) * G.gap + 40;
    var zoneW = Math.max(G.colW * 2, 32);
    branches.forEach(function(br) {
      if (!br || br.id === excludeBranchId) return;
      var zone = document.createElement('div');
      zone.className = 'aether-dropzone';
      zone.style.left = (G.pL + br.id * G.colW - zoneW / 2) + 'px';
      zone.style.top = '0';
      zone.style.width = zoneW + 'px';
      zone.style.height = totalH + 'px';
      zone.dataset.branchId = String(br.id);
      var lbl = document.createElement('div');
      lbl.className = 'aether-dropzone-label';
      lbl.textContent = br.name;
      lbl.style.color = br.color;
      zone.appendChild(lbl);
      // HTML5 DnD targets
      zone.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        zone.classList.add('aether-dropzone--hover');
        schedulePredict(e.clientX, e.clientY, parseInt(zone.dataset.branchId));
      });
      zone.addEventListener('dragleave', function() {
        zone.classList.remove('aether-dropzone--hover');
        if (predictionPath) predictionPath.setAttribute('d', '');
      });
      zone.addEventListener('drop', function(e) {
        e.preventDefault();
        zone.classList.remove('aether-dropzone--hover');
        var nid = parseInt(e.dataTransfer.getData('text/plain'));
        if (!isNaN(nid)) handleNodeDrop(nid, br.id);
      });
      dropZoneContainer.appendChild(zone);
    });
  }

  function hideDropZones() {
    if (!dropZoneContainer) return;
    dropZoneContainer.classList.remove('aether-dropzone--active');
    dropZoneContainer.innerHTML = '';
    clearPrediction();
  }

  function getSubtreeNodes(nodeId) {
    var node = nodes.find(function(n) { return n.id === nodeId; });
    if (!node) return [];
    var srcBid = node.branchId;
    var startIdx = nodes.indexOf(node);
    var sub = [];
    for (var i = startIdx; i < nodes.length; i++) {
      if (nodes[i].branchId === srcBid) sub.push(nodes[i]);
    }
    return sub;
  }

  function isDescendantOf(candidateId, ancestorId) {
    // Prevent dropping a node onto one of its own subtree children
    var sub = getSubtreeNodes(ancestorId);
    return sub.some(function(n) { return n.id === candidateId; });
  }

  function handleNodeDrop(nodeId, targetBranchId) {
    var node = nodes.find(function(n) { return n.id === nodeId; });
    if (!node) return;
    var srcBid = node.branchId;
    if (srcBid === targetBranchId) return;
    // Cascade: this node + all subsequent nodes on same source branch
    var startIdx = nodes.indexOf(node);
    var toMove = [];
    for (var i = startIdx; i < nodes.length; i++) {
      if (nodes[i].branchId === srcBid) toMove.push(nodes[i]);
    }
    toMove.forEach(function(n) {
      n.branchId = targetBranchId;
      n.userEl.setAttribute(BRANCH_ATTR, String(targetBranchId));
      n.modelEls.forEach(function(m) { m.setAttribute(BRANCH_ATTR, String(targetBranchId)); });
    });
    console.log('[Aether] Moved ' + toMove.length + ' node(s) branch ' + srcBid + ' \u2192 ' + targetBranchId);
    applyFocusMode();
    renderGraph();
    autoSave();
  }

  // == Prediction Line Helpers ==
  function initGhostLayer() {
    if (!svgEl) return;
    if (ghostLayer) ghostLayer.remove();
    if (subtreeGhostG) subtreeGhostG.remove();
    if (subtreeGhostLabels) subtreeGhostLabels.remove();

    ghostLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    ghostLayer.setAttribute('class', 'aether-ghost-layer');
    predictionPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    predictionPath.setAttribute('class', 'aether-prediction-path');
    predictionPath.setAttribute('fill', 'none');
    predictionPath.setAttribute('stroke-width', '1.5');
    predictionPath.setAttribute('stroke-linecap', 'round');
    predictionPath.setAttribute('stroke-dasharray', '5,5');
    predictionPath.setAttribute('stroke', 'rgba(255,255,255,0.35)');
    ghostLayer.appendChild(predictionPath);

    // Build subtree ghost clone
    subtreeGhostG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    subtreeGhostG.setAttribute('class', 'aether-subtree-ghost');
    ghostLayer.appendChild(subtreeGhostG);

    subtreeGhostLabels = document.createElement('div');
    subtreeGhostLabels.className = 'aether-subtree-ghost-labels';

    if (dragSourceNodeId != null) {
      var sub = getSubtreeNodes(dragSourceNodeId);
      if (sub.length > 0) {
        // Clone circles
        var srcBr = branches[sub[0].branchId] || branches[0];
        for (var i = 0; i < sub.length; i++) {
          var pos = nXY(sub[i]);
          var gc = mkCircle(pos.x, pos.y, G.r, 'none', srcBr.color, '1.5', null);
          gc.setAttribute('data-ghost-idx', String(i));
          subtreeGhostG.appendChild(gc);
          // Vertical line between consecutive ghost nodes
          if (i > 0) {
            var prev = nXY(sub[i - 1]);
            var gl = mkLine(prev.x, prev.y, pos.x, pos.y, srcBr.color, '1');
            gl.setAttribute('data-ghost-line', '1');
            subtreeGhostG.appendChild(gl);
          }
          // Ghost label
          var gLbl = document.createElement('div');
          gLbl.className = 'aether-ghost-label';
          gLbl.textContent = sub[i].label;
          gLbl.style.top = (pos.y - 7) + 'px';
          var maxCol = 0;
          for (var b = 0; b < branches.length; b++) if (branches[b] && branches[b].id > maxCol) maxCol = branches[b].id;
          gLbl.style.left = (G.pL + (maxCol + 1) * G.colW + 14) + 'px';
          subtreeGhostLabels.appendChild(gLbl);
        }
      }
    }

    svgEl.appendChild(ghostLayer);
    labelBox.appendChild(subtreeGhostLabels);
    snapBranchId = -1;
  }

  function clearPrediction() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (ghostLayer) { ghostLayer.remove(); ghostLayer = null; predictionPath = null; subtreeGhostG = null; }
    if (subtreeGhostLabels) { subtreeGhostLabels.remove(); subtreeGhostLabels = null; }
    detachedLines.forEach(function(el) {
      el.removeAttribute('opacity');
      el.style.strokeDasharray = '';
    });
    detachedLines = [];
    dragSourceNodeId = null;
    lastDragSvgPt = null;
    snapBranchId = -1;
  }

  function applyDetachFeedback(srcNodeId) {
    if (srcNodeId == null || !svgEl) return;
    // Find all vertical lines and connectors, dim those attached to the source node
    var srcNode = nodes.find(function(n) { return n.id === srcNodeId; });
    if (!srcNode) return;
    var srcPos = nXY(srcNode);
    // Dim any SVG line/path that touches the source node position
    var elems = svgEl.querySelectorAll('line, path');
    elems.forEach(function(el) {
      if (el === predictionPath || (ghostLayer && ghostLayer.contains(el))) return;
      var touches = false;
      if (el.tagName === 'line') {
        var ly1 = parseFloat(el.getAttribute('y1'));
        var ly2 = parseFloat(el.getAttribute('y2'));
        var lx = parseFloat(el.getAttribute('x1'));
        if (Math.abs(lx - srcPos.x) < 2 && srcPos.y >= ly1 - 1 && srcPos.y <= ly2 + 1) touches = true;
      }
      if (touches) {
        el.setAttribute('opacity', '0.25');
        el.style.strokeDasharray = '4,4';
        detachedLines.push(el);
      }
    });
  }

  function findNearestNodeOnBranch(branchId, mouseY) {
    var best = null, bestDist = Infinity;
    nodes.forEach(function(n) {
      if (n.branchId !== branchId) return;
      var pos = nXY(n);
      var d = Math.abs(pos.y - mouseY);
      if (d < bestDist) { bestDist = d; best = n; }
    });
    return best;
  }

  function updatePredictionLine(clientX, clientY, hoverBranchId) {
    if (!predictionPath || !svgEl) return;
    var svgRect = svgEl.getBoundingClientRect();
    var mx = clientX - svgRect.left;
    var my = clientY - svgRect.top;
    lastDragSvgPt = { x: mx, y: my };

    // Guard: can't drop on own subtree
    if (hoverBranchId >= 0 && dragSourceNodeId != null) {
      var nearTgt = findNearestNodeOnBranch(hoverBranchId, my);
      if (nearTgt && isDescendantOf(nearTgt.id, dragSourceNodeId)) {
        hoverBranchId = -1; // invalid target
      }
    }

    if (hoverBranchId == null || hoverBranchId < 0) {
      predictionPath.setAttribute('d', '');
      resetSubtreeGhostPosition();
      snapBranchId = -1;
      return;
    }

    var targetBr = branches[hoverBranchId];
    if (!targetBr) { predictionPath.setAttribute('d', ''); resetSubtreeGhostPosition(); snapBranchId = -1; return; }

    // Find nearest node on target branch as anchor
    var anchor = findNearestNodeOnBranch(hoverBranchId, my);
    var ax, ay;
    if (anchor) {
      var ap = nXY(anchor);
      ax = ap.x; ay = ap.y;
    } else {
      ax = G.pL + hoverBranchId * G.colW;
      ay = my - 30;
    }

    // Build Bézier from anchor to snap target (not raw mouse)
    var targetX = G.pL + hoverBranchId * G.colW;
    var targetY = ay + G.gap;
    var cpOff = Math.abs(targetY - ay) * 0.45;
    var d = 'M' + ax + ',' + ay +
            ' C' + ax + ',' + (ay + cpOff) +
            ' ' + targetX + ',' + (targetY - cpOff) +
            ' ' + targetX + ',' + targetY;
    predictionPath.setAttribute('d', d);
    predictionPath.setAttribute('stroke', targetBr.color);
    predictionPath.style.opacity = '0.6';

    // Snap subtree ghost to target position
    snapSubtreeGhost(hoverBranchId, targetX, targetY, targetBr.color);
    snapBranchId = hoverBranchId;
  }

  function snapSubtreeGhost(branchId, baseX, baseY, color) {
    if (!subtreeGhostG || dragSourceNodeId == null) return;
    var sub = getSubtreeNodes(dragSourceNodeId);
    if (sub.length === 0) return;
    // Compute offset: position first ghost node at (baseX, baseY)
    var origFirst = nXY(sub[0]);
    var dx = baseX - origFirst.x;
    var dy = baseY - origFirst.y;
    subtreeGhostG.setAttribute('transform', 'translate(' + dx + ',' + dy + ')');
    // Recolor
    var circles = subtreeGhostG.querySelectorAll('circle');
    circles.forEach(function(c) { c.setAttribute('stroke', color); });
    var lines = subtreeGhostG.querySelectorAll('line');
    lines.forEach(function(l) { l.setAttribute('stroke', color); });
    subtreeGhostG.style.opacity = '0.5';
    // Move ghost labels
    if (subtreeGhostLabels) {
      var lbls = subtreeGhostLabels.querySelectorAll('.aether-ghost-label');
      for (var i = 0; i < lbls.length && i < sub.length; i++) {
        var origP = nXY(sub[i]);
        lbls[i].style.top = (origP.y + dy - 7) + 'px';
        lbls[i].style.color = color;
      }
      subtreeGhostLabels.style.opacity = '1';
    }
  }

  function resetSubtreeGhostPosition() {
    if (subtreeGhostG) {
      subtreeGhostG.setAttribute('transform', '');
      subtreeGhostG.style.opacity = '0';
    }
    if (subtreeGhostLabels) subtreeGhostLabels.style.opacity = '0';
  }

  function schedulePredict(clientX, clientY, hoverBranchId) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(function() {
      rafId = null;
      updatePredictionLine(clientX, clientY, hoverBranchId);
    });
  }

  function getHoverBranchId(clientX, clientY) {
    if (!dropZoneContainer) return -1;
    var zones = dropZoneContainer.querySelectorAll('.aether-dropzone');
    var bid = -1;
    zones.forEach(function(z) {
      var r = z.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right &&
          clientY >= r.top && clientY <= r.bottom) {
        bid = parseInt(z.dataset.branchId);
      }
    });
    return bid;
  }

  // Esc key cancels any drag
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if (customDrag) {
        customDrag.ghost.remove();
        customDrag = null;
      }
      hideDropZones();
    }
  });

  // Custom drag for SVG circles (no native HTML5 DnD on SVG)
  // Uses a 5px movement threshold to distinguish click from drag.
  var DRAG_THRESHOLD = 5;

  function startCustomDrag(nodeId, e) {
    var nd = nodes.find(function(n) { return n.id === nodeId; });
    if (!nd) return;
    e.preventDefault();
    var startX = e.clientX, startY = e.clientY;
    var dragging = false;

    function onMove(ev) {
      var dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        // Threshold met — start real drag
        dragging = true;
        setActiveNode(nodeId);
        showDropZones(nd.branchId, nodeId);
        var ghost = document.createElement('div');
        ghost.className = 'aether-drag-ghost';
        ghost.textContent = nd.label;
        document.body.appendChild(ghost);
        customDrag = { nodeId: nodeId, ghost: ghost, branchId: nd.branchId };
      }
      customDrag.ghost.style.left = (ev.clientX + 12) + 'px';
      customDrag.ghost.style.top = (ev.clientY - 10) + 'px';
      var hovBid = getHoverBranchId(ev.clientX, ev.clientY);
      if (dropZoneContainer) {
        var zones = dropZoneContainer.querySelectorAll('.aether-dropzone');
        zones.forEach(function(z) {
          z.classList.toggle('aether-dropzone--hover',
            parseInt(z.dataset.branchId) === hovBid);
        });
      }
      schedulePredict(ev.clientX, ev.clientY, hovBid);
    }

    function onUp(ev) {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      if (!dragging) {
        // Was a simple click, not a drag — let click handler fire
        return;
      }
      var targetBid = -1;
      if (dropZoneContainer) {
        var zones = dropZoneContainer.querySelectorAll('.aether-dropzone');
        zones.forEach(function(z) {
          var r = z.getBoundingClientRect();
          if (ev.clientX >= r.left && ev.clientX <= r.right &&
              ev.clientY >= r.top && ev.clientY <= r.bottom) {
            targetBid = parseInt(z.dataset.branchId);
          }
        });
      }
      if (customDrag) customDrag.ghost.remove();
      hideDropZones();
      if (targetBid >= 0 && customDrag && targetBid !== customDrag.branchId) {
        handleNodeDrop(customDrag.nodeId, targetBid);
      }
      customDrag = null;
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
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
      '<div class="aether-ctx-item" data-action="rename">\uD83D\uDCDD Rename Node</div>' +
      '<div class="aether-ctx-item" data-action="switch-main">\u2B95 Switch to main</div>';
    document.body.appendChild(ctxMenu);
    // Close on click-away — use capture:false so it doesn't interfere with native inputs
    document.addEventListener('click', function(e) {
      if (ctxMenu && !ctxMenu.contains(e.target)) ctxMenu.style.display = 'none';
    });
  }

  function showCtxMenu(x, y, nodeId) {
    if (!ctxMenu) createCtxMenu();
    // Auto-highlight the right-clicked node
    setActiveNode(nodeId);
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
    ctxMenu.style.display = '';
    // Rebind actions for this node — clone to clear old listeners
    var staticItems = ctxMenu.querySelectorAll('.aether-ctx-item:not(.aether-ctx-item--dynamic)');
    staticItems.forEach(function(item) {
      var clone = item.cloneNode(true);
      item.parentNode.replaceChild(clone, item);
    });
    var branchItem = ctxMenu.querySelector('[data-action="branch"]');
    var renameItem = ctxMenu.querySelector('[data-action="rename"]');
    var switchItem = ctxMenu.querySelector('[data-action="switch-main"]');
    branchItem.addEventListener('click', function(e) {
      e.preventDefault();
      ctxMenu.style.display = 'none';
      showBranchDialog(nodeId);
    });
    renameItem.addEventListener('click', function(e) {
      e.preventDefault();
      ctxMenu.style.display = 'none';
      // Find the label element and trigger inline edit
      triggerRenameForNode(nodeId);
    });
    switchItem.addEventListener('click', function(e) {
      e.preventDefault();
      ctxMenu.style.display = 'none';
      switchBranch(0);
    });
    // Add branch-specific switch options
    var existingExtras = ctxMenu.querySelectorAll('.aether-ctx-item--dynamic');
    existingExtras.forEach(function(el) { el.remove(); });
    branches.forEach(function(br) {
      if (!br || br.id === 0) return;
      var d = document.createElement('div');
      d.className = 'aether-ctx-item aether-ctx-item--dynamic';
      d.textContent = '\u2B95 Switch to ' + br.name;
      if (br.id === activeBranchId) { d.style.fontWeight = '600'; d.style.color = br.color; }
      d.addEventListener('click', function(e) {
        e.preventDefault();
        ctxMenu.style.display = 'none';
        switchBranch(br.id);
      });
      ctxMenu.appendChild(d);
      // Offer delete if branch is empty
      if (isBranchEmpty(br.id)) {
        var del = document.createElement('div');
        del.className = 'aether-ctx-item aether-ctx-item--dynamic aether-ctx-item--danger';
        del.textContent = '\uD83D\uDDD1\uFE0F Delete \u201C' + br.name + '\u201D (empty)';
        del.addEventListener('click', function(e) {
          e.preventDefault();
          ctxMenu.style.display = 'none';
          deleteBranch(br.id);
        });
        ctxMenu.appendChild(del);
      }
    });
  }

  function triggerRenameForNode(nodeId) {
    // Find label element in current render
    var labels = labelBox.querySelectorAll('.aether-graph-label');
    var idx = nodes.findIndex(function(n) { return n.id === nodeId; });
    if (idx >= 0 && labels[idx]) {
      startInlineEdit(labels[idx], nodeId);
    }
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
        '<span class="aether-save-indicator"></span>' +
        '<span class="aether-sidebar-count"></span>' +
      '</div>' +
      '<div class="aether-sidebar-scroll"></div>';
    document.body.appendChild(sidebar);
    saveIndicator = sidebar.querySelector('.aether-save-indicator');

    const scroll = sidebar.querySelector('.aether-sidebar-scroll');
    svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.setAttribute('class', 'aether-graph-svg');
    scroll.appendChild(svgEl);
    labelBox = document.createElement('div');
    labelBox.className = 'aether-graph-labels';
    scroll.appendChild(labelBox);
    setupDropZones();
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
    for (var b = 0; b < branches.length; b++) if (branches[b] && branches[b].id > maxCol) maxCol = branches[b].id;
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
      if (!br) return;
      var bn = nodes.filter(function(n) { return n.branchId === br.id; });
      if (bn.length < 2) return;
      var f = nXY(bn[0]), l = nXY(bn[bn.length - 1]);
      svgEl.appendChild(mkLine(f.x, f.y, f.x, l.y, br.color, '1.5'));
    });

    // Branch connectors
    branches.forEach(function(br) {
      if (!br || br.fromNode === null) return;
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
      c.style.cursor = 'grab';
      c.addEventListener('click', function() {
        scrollToNode(node.id);
        if (node.branchId !== activeBranchId) switchBranch(node.branchId);
      });
      c.addEventListener('contextmenu', function(e) {
        e.preventDefault(); e.stopPropagation();
        showCtxMenu(e.pageX, e.pageY, node.id);
      });
      c.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        startCustomDrag(node.id, e);
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
    d.title = 'Drag to move \u2022 Double-click to rename';
    d.style.top = top + 'px';
    d.style.left = left + 'px';
    // Double-click to inline-edit
    d.addEventListener('dblclick', function(e) {
      e.stopPropagation();
      startInlineEdit(d, nodeId);
    });
    // HTML5 Drag & Drop
    d.setAttribute('draggable', 'true');
    d.addEventListener('dragstart', function(e) {
      e.dataTransfer.setData('text/plain', String(nodeId));
      e.dataTransfer.effectAllowed = 'move';
      d.classList.add('aether-label--dragging');
      setActiveNode(nodeId);
      var nd = nodes.find(function(n) { return n.id === nodeId; });
      if (nd) showDropZones(nd.branchId, nodeId);
    });
    d.addEventListener('dragend', function() {
      d.classList.remove('aether-label--dragging');
      hideDropZones();
    });
    return d;
  }

  // == Inline editing ==
  function startInlineEdit(labelEl, nodeId) {
    if (labelEl.querySelector('input')) return; // already editing
    var node = nodes.find(function(n) { return n.id === nodeId; });
    if (!node) return;
    // Highlight the node being edited
    setActiveNode(nodeId);
    var origText = node.label;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'aether-label-input';
    input.value = origText;
    // Prevent clicks inside the input from triggering external handlers
    input.addEventListener('click', function(e) { e.stopPropagation(); });
    labelEl.textContent = '';
    labelEl.appendChild(input);
    input.focus();
    // Place cursor at end of text
    input.setSelectionRange(origText.length, origText.length);

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
    // Re-load state for new URL
    initFromStorage();
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
  // Load persisted state, then rehydrate or scan
  initFromStorage();
  setTimeout(function() { refreshLabels(); diagnose(); }, 5000);
})();
