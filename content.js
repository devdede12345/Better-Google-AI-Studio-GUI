/**
 * Aether — Google AI Studio Enhancer
 * Pure tagging approach — NO DOM wrapping / appendChild.
 * Tags user turns with .aether-turn-unit + .aether-keep-visible
 * Tags model turns with .aether-can-hide
 * Fold toggles .aether-hidden on model siblings via shared group ID.
 */
(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────
  const UNIT_CLS   = 'aether-turn-unit';      // anchor class on user element
  const KEEP_CLS   = 'aether-keep-visible';    // user content — never hidden
  const HIDEABLE   = 'aether-can-hide';        // model content — hideable
  const HIDDEN_CLS = 'aether-hidden';          // actively hidden right now
  const COLLAPSED  = 'is-collapsed';           // state flag on user element
  const PROCESSED  = 'data-aether-processed';
  const GROUP_ATTR = 'data-aether-group';
  let groupCount   = 0;

  // Turn-level selectors (first with ≥2 hits wins)
  const TURN_SELECTORS = [
    'ms-chat-turn',
    '.conversation-turn',
    '.turn-container',
    '.chat-turn',
    '[data-turn-index]',
  ];

  // ── Role detection ─────────────────────────────────────────────────────────
  function isUserEl(el) {
    const hints = [
      el.getAttribute('role'),
      el.getAttribute('data-role'),
      el.getAttribute('ng-reflect-role'),
      el.className,
    ].filter(Boolean).join(' ').toLowerCase();
    if (/user|human|prompt/.test(hints)) return true;
    for (const c of el.children) {
      const ch = (c.className + ' ' + (c.getAttribute('role') || '')).toLowerCase();
      if (/user|human|prompt/.test(ch)) return true;
    }
    return false;
  }

  // ── Find turn-level elements ──────────────────────────────────────────────
  function findTurns() {
    for (const sel of TURN_SELECTORS) {
      const els = document.querySelectorAll(sel);
      if (els.length >= 2) return Array.from(els);
    }
    return [];
  }

  // ── Build groups: [userEl, ...modelEls] ─────────────────────────────────
  function buildGroups() {
    const turns = findTurns().filter(el => !el.hasAttribute(PROCESSED));
    if (turns.length < 2) return [];

    const groups = [];
    let current = null;

    for (const el of turns) {
      if (isUserEl(el)) {
        if (current && current.length > 1) groups.push(current);
        current = [el];
      } else if (current) {
        current.push(el);
      }
    }
    if (current && current.length > 1) groups.push(current);
    return groups;
  }

  // ── Action bar (injected into user element) ─────────────────────────────
  function createActionBar(userEl, groupId) {
    const bar = document.createElement('div');
    bar.className = 'aether-action-bar';

    // ─ Fold button
    const fold = document.createElement('button');
    fold.className = 'aether-fold-btn';
    fold.title = 'Collapse this turn';
    fold.setAttribute('aria-label', 'Collapse turn');
    fold.innerHTML = '<span class="aether-fold-icon">🔽</span>';
    fold.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      const collapsed = userEl.classList.toggle(COLLAPSED);
      // Toggle visibility on all model parts in this group
      document.querySelectorAll(
        `.${HIDEABLE}[${GROUP_ATTR}="${groupId}"]`
      ).forEach(m => m.classList.toggle(HIDDEN_CLS, collapsed));
      fold.querySelector('.aether-fold-icon').textContent = collapsed ? '◀️' : '🔽';
      fold.title = collapsed ? 'Expand this turn' : 'Collapse this turn';
    });

    // ─ Branch button
    const branch = document.createElement('button');
    branch.className = 'aether-branch-btn';
    branch.title = 'Branch from here';
    branch.setAttribute('aria-label', 'Branch conversation');
    branch.innerHTML = '<span class="aether-branch-icon">🌱</span><span class="aether-branch-label">Branch</span>';
    branch.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      branch.classList.add('aether-branch-btn--active');
      setTimeout(() => branch.classList.remove('aether-branch-btn--active'), 500);
      console.info('[Aether] Branch from group', groupId);
      document.dispatchEvent(new CustomEvent('aether:branch', {
        detail: { groupId, userEl }, bubbles: true,
      }));
    });

    bar.appendChild(fold);
    bar.appendChild(branch);
    return bar;
  }

  // ── Tag a group (no DOM movement) ──────────────────────────────────────
  function tagGroup(members) {
    const id = ++groupCount;
    const userEl = members[0];

    // Tag user element
    userEl.classList.add(UNIT_CLS, KEEP_CLS);
    userEl.setAttribute(PROCESSED, 'true');
    userEl.setAttribute(GROUP_ATTR, String(id));
    if (getComputedStyle(userEl).position === 'static') {
      userEl.style.position = 'relative';
    }

    // Tag all model elements
    for (let i = 1; i < members.length; i++) {
      members[i].classList.add(HIDEABLE);
      members[i].setAttribute(PROCESSED, 'true');
      members[i].setAttribute(GROUP_ATTR, String(id));
    }

    // Inject action bar into user element (top-right)
    userEl.appendChild(createActionBar(userEl, id));

    console.log(`[Aether] ✅ Tagged group ${id}: 1 user + ${members.length - 1} model part(s)`);
  }

  // ── Capture streaming orphans ─────────────────────────────────────────────
  // After tagging, new model/output elements may stream in as siblings
  // after the last known model element of a group. Tag them too.
  function captureOrphans() {
    const unitEls = document.querySelectorAll('.' + UNIT_CLS);

    unitEls.forEach(userEl => {
      const groupId = userEl.getAttribute(GROUP_ATTR);
      let next = userEl.nextElementSibling;

      while (next) {
        // Stop at another user turn-unit
        if (next.classList.contains(UNIT_CLS)) break;
        // Skip already-processed
        if (next.hasAttribute(PROCESSED)) { next = next.nextElementSibling; continue; }

        // Check if it's a turn-level element
        const isTurn = TURN_SELECTORS.some(sel => {
          try { return next.matches(sel); } catch { return false; }
        });

        if (isTurn && isUserEl(next)) break; // new user → stop

        if (isTurn) {
          next.classList.add(HIDEABLE);
          next.setAttribute(PROCESSED, 'true');
          next.setAttribute(GROUP_ATTR, groupId);
          // If group is currently collapsed, hide this new arrival too
          if (userEl.classList.contains(COLLAPSED)) {
            next.classList.add(HIDDEN_CLS);
          }
          console.log('[Aether] 📥 Tagged orphan for group', groupId);
        }
        next = next.nextElementSibling;
      }
    });
  }

  // ── Diagnostics ────────────────────────────────────────────────────────────
  function diagnose() {
    console.groupCollapsed('[Aether] 🔍 DOM Diagnostic');

    const tags = new Set();
    document.querySelectorAll('*').forEach(el => {
      const t = el.tagName.toLowerCase();
      if (t.startsWith('ms-') || t.startsWith('mat-')) tags.add(t);
    });
    console.log('Custom elements:', [...tags].sort());

    TURN_SELECTORS.forEach(sel => {
      const n = document.querySelectorAll(sel).length;
      console.log(`${n ? '✅' : '❌'} "${sel}" → ${n}`);
    });

    const roleEls = document.querySelectorAll('[role], [data-role], [ng-reflect-role]');
    if (roleEls.length) {
      console.log(`Role-bearing elements: ${roleEls.length}`);
      Array.from(roleEls).slice(0, 10).forEach(el =>
        console.log('  ', el.tagName.toLowerCase(), {
          role: el.getAttribute('role'),
          dataRole: el.getAttribute('data-role'),
          ngRole: el.getAttribute('ng-reflect-role'),
          class: (el.className || '').toString().slice(0, 80),
        })
      );
    }

    console.log('Groups tagged:', groupCount);
    const units = document.querySelectorAll('.' + UNIT_CLS);
    units.forEach(u => {
      const gid = u.getAttribute(GROUP_ATTR);
      const parts = document.querySelectorAll(`.${HIDEABLE}[${GROUP_ATTR}="${gid}"]`);
      console.log(`  Group ${gid}: user ✅, model parts: ${parts.length}`);
    });
    console.groupEnd();
  }

  // ── Main ───────────────────────────────────────────────────────────────────
  function run() {
    const groups = buildGroups();
    if (groups.length) groups.forEach(tagGroup);
    captureOrphans();
  }

  const observer = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.addedNodes.length) { requestAnimationFrame(run); return; }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  console.log('[Aether] 🌱 Content script loaded on', location.href);
  run();
  setTimeout(run, 2000);
  setTimeout(() => { run(); diagnose(); }, 5000);
})();
