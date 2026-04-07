/**
 * Aether — Google AI Studio Enhancer
 * Wraps User + Thoughts + Output into a structural master container.
 * Provides Branch + Fold controls. Captures streaming orphans.
 */
(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────
  const CONTAINER  = 'aether-master-container';
  const COLLAPSED  = 'is-collapsed';
  const PROCESSED  = 'data-aether-processed';
  const USER_PART  = 'aether-user-part';
  const MODEL_PART = 'aether-model-part';
  let groupCount   = 0;

  // Turn-level selectors (tried in order; first with ≥2 hits wins)
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

  // ── Build groups: User + everything until next User ───────────────────
  function buildGroups() {
    const turns = findTurns().filter(
      el => !el.hasAttribute(PROCESSED) && !el.closest('.' + CONTAINER)
    );
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

  // ── Action bar ────────────────────────────────────────────────────────────
  function createActionBar(container) {
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
      const collapsed = container.classList.toggle(COLLAPSED);
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
      console.info('[Aether] Branch from group', container.getAttribute('data-aether-group'));
      document.dispatchEvent(new CustomEvent('aether:branch', {
        detail: { container }, bubbles: true,
      }));
    });

    bar.appendChild(fold);
    bar.appendChild(branch);
    return bar;
  }

  // ── Wrap a group ───────────────────────────────────────────────────────────
  function wrapGroup(members) {
    const id = ++groupCount;
    const first = members[0];
    const parent = first.parentNode;

    const container = document.createElement('div');
    container.className = CONTAINER;
    container.setAttribute('data-aether-group', String(id));

    // Insert container at first member’s position
    parent.insertBefore(container, first);

    // Move all members into the container, tagging user vs model
    members.forEach((el, idx) => {
      el.setAttribute(PROCESSED, 'true');
      if (idx === 0 && isUserEl(el)) {
        el.classList.add(USER_PART);
      } else {
        el.classList.add(MODEL_PART);
      }
      container.appendChild(el);
    });

    // Action bar → inside the user-part element so it survives collapse
    const userPart = container.querySelector('.' + USER_PART);
    if (userPart) {
      if (getComputedStyle(userPart).position === 'static') userPart.style.position = 'relative';
      userPart.appendChild(createActionBar(container));
    } else {
      container.appendChild(createActionBar(container));
    }

    console.log(`[Aether] ✅ Wrapped group ${id} with ${members.length} part(s)`);
  }

  // ── Capture streaming orphans ─────────────────────────────────────────────
  // After wrapping, new model/output elements may stream in as siblings
  // of the container. Pull them inside.
  function captureOrphans() {
    const containers = document.querySelectorAll('.' + CONTAINER);
    containers.forEach(c => {
      const actionBar = c.querySelector('.aether-action-bar');
      let next = c.nextElementSibling;

      while (next) {
        // Stop at another container or a new user turn
        if (next.classList.contains(CONTAINER)) break;
        if (next.hasAttribute(PROCESSED)) { next = next.nextElementSibling; continue; }

        // Check if this is a turn-level element
        const isTurn = TURN_SELECTORS.some(sel => {
          try { return next.matches(sel); } catch { return false; }
        });

        if (isTurn && isUserEl(next)) break; // next user → stop

        if (isTurn) {
          // Orphan model/thoughts/output → capture
          const grab = next;
          next = next.nextElementSibling;
          grab.setAttribute(PROCESSED, 'true');
          grab.classList.add(MODEL_PART);
          c.insertBefore(grab, actionBar);
          console.log('[Aether] 📥 Captured orphan into group', c.getAttribute('data-aether-group'));
        } else {
          next = next.nextElementSibling;
        }
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

    console.log('Groups wrapped:', groupCount);
    console.groupEnd();
  }

  // ── Main ───────────────────────────────────────────────────────────────────
  function run() {
    const groups = buildGroups();
    if (groups.length) groups.forEach(wrapGroup);
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
