/**
 * AetherMind Embeddings Module (MAIN world)
 * Uses locally-bundled Transformers.js (loaded via manifest before this file).
 * Listens for bridge events from content.js (ISOLATED world).
 * Stores 384-dim vectors in IndexedDB, computes cosine similarity.
 */
(function () {
  'use strict';

  console.log('[AetherEmbed] Module loaded (MAIN world)');

  // ── Bridge listeners (attached FIRST, before anything else) ──
  document.addEventListener('aether:init-embeddings', function () {
    console.log('[AetherEmbed] Received init-embeddings event');
    initPipeline();
  });

  document.addEventListener('aether:process-nodes', function (e) {
    var detail = e.detail;
    console.log('[AetherEmbed] Received process-nodes event, nodeCount=' +
      (detail && detail.nodes ? detail.nodes.length : 0));
    if (!detail || !detail.nodes) return;
    processAllNodes(detail.nodes).then(function (links) {
      console.log('[AetherEmbed] Processing complete, semanticLinks=' + links.length);
      // Notify the page that semantic links are ready
      document.dispatchEvent(new CustomEvent('aether:embeddings-ready', {
        detail: { links: links }
      }));
    }).catch(function (err) {
      console.error('[AetherEmbed] processAllNodes error:', err);
      document.dispatchEvent(new CustomEvent('aether:embeddings-ready', {
        detail: { links: [], error: err.message }
      }));
    });
  });

  // ── Config ──
  var MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
  var SIMILARITY_THRESHOLD = 0.78;
  var DB_NAME = 'AetherEmbeddings';
  var DB_VERSION = 1;
  var STORE_NAME = 'vectors';

  // ── State ──
  var state = {
    ready: false,
    loading: false,
    pipeline: null,
    db: null,
    cache: {},         // nodeId -> Float32Array
    semanticLinks: [], // { sourceId, targetId, score }
  };

  // ══════════════════════════════════════════════════════════════
  //  IndexedDB helpers
  // ══════════════════════════════════════════════════════════════

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (state.db) { resolve(state.db); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = function (e) { state.db = e.target.result; resolve(state.db); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbPut(nodeId, vector) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ id: nodeId, vec: Array.from(vector) });
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function dbGet(nodeId) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var req = tx.objectStore(STORE_NAME).get(nodeId);
        req.onsuccess = function () {
          if (req.result) resolve(new Float32Array(req.result.vec));
          else resolve(null);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function dbGetAll() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  Transformers.js pipeline (local library, no CDN)
  // ══════════════════════════════════════════════════════════════

  function findPipelineFn() {
    // The locally-loaded transformers.min.js exposes its API on the global scope.
    // Try various known export patterns:
    if (typeof window.pipeline === 'function') return window.pipeline;
    if (window.transformers && typeof window.transformers.pipeline === 'function') return window.transformers.pipeline;
    if (window.Transformers && typeof window.Transformers.pipeline === 'function') return window.Transformers.pipeline;
    // The @xenova/transformers CDN build uses `self.pipeline`
    if (typeof self !== 'undefined' && typeof self.pipeline === 'function') return self.pipeline;
    return null;
  }

  function initPipeline() {
    if (state.loading || state.ready) {
      console.log('[AetherEmbed] Pipeline already ' + (state.ready ? 'ready' : 'loading'));
      if (state.ready) {
        document.dispatchEvent(new CustomEvent('aether:embeddings-status', {
          detail: { status: 'ready' }
        }));
      }
      return Promise.resolve();
    }
    state.loading = true;
    console.log('[AetherEmbed] Initializing pipeline with model: ' + MODEL_ID);

    var pipelineFn = findPipelineFn();
    if (!pipelineFn) {
      var msg = 'Transformers.js pipeline function not found. Library may not have loaded.';
      console.error('[AetherEmbed] ' + msg);
      console.log('[AetherEmbed] Available globals:', Object.keys(window).filter(function(k) {
        return k.toLowerCase().indexOf('transform') >= 0 || k.toLowerCase().indexOf('pipeline') >= 0;
      }));
      state.loading = false;
      document.dispatchEvent(new CustomEvent('aether:embeddings-status', {
        detail: { status: 'error', error: msg }
      }));
      return Promise.reject(new Error(msg));
    }

    console.log('[AetherEmbed] pipeline function found, loading model...');
    return pipelineFn('feature-extraction', MODEL_ID, { quantized: true })
      .then(function (pipe) {
        state.pipeline = pipe;
        state.ready = true;
        state.loading = false;
        console.log('[AetherEmbed] Model ready: ' + MODEL_ID);
        // Warm cache from IndexedDB
        return dbGetAll();
      })
      .then(function (rows) {
        rows.forEach(function (r) { state.cache[r.id] = new Float32Array(r.vec); });
        console.log('[AetherEmbed] Loaded ' + rows.length + ' cached vectors from IndexedDB');
        document.dispatchEvent(new CustomEvent('aether:embeddings-status', {
          detail: { status: 'ready', cachedCount: rows.length }
        }));
      })
      .catch(function (err) {
        state.loading = false;
        console.error('[AetherEmbed] Init failed:', err);
        document.dispatchEvent(new CustomEvent('aether:embeddings-status', {
          detail: { status: 'error', error: err.message }
        }));
      });
  }

  // ══════════════════════════════════════════════════════════════
  //  Embedding computation
  // ══════════════════════════════════════════════════════════════

  function embed(text) {
    if (!state.pipeline) return Promise.reject(new Error('Pipeline not ready'));
    return state.pipeline(text, { pooling: 'mean', normalize: true }).then(function (output) {
      return new Float32Array(output.data);
    });
  }

  function getOrComputeEmbedding(nodeId, text) {
    if (state.cache[nodeId]) return Promise.resolve(state.cache[nodeId]);
    return embed(text).then(function (vec) {
      state.cache[nodeId] = vec;
      return dbPut(nodeId, vec).then(function () { return vec; });
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  Cosine similarity
  // ══════════════════════════════════════════════════════════════

  function calculateSimilarity(vec1, vec2) {
    if (!vec1 || !vec2 || vec1.length !== vec2.length) return 0;
    var dot = 0, mag1 = 0, mag2 = 0;
    for (var i = 0; i < vec1.length; i++) {
      dot += vec1[i] * vec2[i];
      mag1 += vec1[i] * vec1[i];
      mag2 += vec2[i] * vec2[i];
    }
    mag1 = Math.sqrt(mag1);
    mag2 = Math.sqrt(mag2);
    if (mag1 === 0 || mag2 === 0) return 0;
    return dot / (mag1 * mag2);
  }

  // ══════════════════════════════════════════════════════════════
  //  Semantic link detection
  // ══════════════════════════════════════════════════════════════

  function computeSemanticLinks(aetherNodes) {
    var links = [];
    var ids = Object.keys(state.cache).map(Number);
    var parentChildPairs = new Set();
    aetherNodes.forEach(function (n) {
      if (n.parentId != null) {
        parentChildPairs.add(n.id + ':' + n.parentId);
        parentChildPairs.add(n.parentId + ':' + n.id);
      }
    });
    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) {
        var a = ids[i], b = ids[j];
        if (parentChildPairs.has(a + ':' + b)) continue;
        var score = calculateSimilarity(state.cache[a], state.cache[b]);
        if (score > SIMILARITY_THRESHOLD) {
          links.push({ sourceId: a, targetId: b, score: score });
        }
      }
    }
    state.semanticLinks = links;
    return links;
  }

  function processAllNodes(aetherNodes) {
    if (!state.ready) {
      console.warn('[AetherEmbed] processAllNodes called but pipeline not ready, initializing...');
      return initPipeline().then(function () {
        if (!state.ready) return [];
        return processAllNodes(aetherNodes);
      });
    }
    var total = aetherNodes.length;
    var done = 0;
    var tasks = aetherNodes.map(function (n) {
      var text = n.text || n.label || 'Turn';
      if (text.length > 512) text = text.substring(0, 512);
      return getOrComputeEmbedding(n.id, text).then(function (vec) {
        done++;
        if (done % 5 === 0 || done === total) {
          console.log('[AetherEmbed] Progress: ' + done + '/' + total);
          document.dispatchEvent(new CustomEvent('aether:embed-progress', {
            detail: { done: done, total: total }
          }));
        }
        return vec;
      }).catch(function (err) {
        console.warn('[AetherEmbed] Failed to embed node #' + n.id + ':', err.message);
        done++;
        return null;
      });
    });
    return Promise.all(tasks).then(function () {
      return computeSemanticLinks(aetherNodes);
    });
  }

  // ── Expose on window for network.js (same MAIN world) ──
  window.AetherEmbed = {
    init: initPipeline,
    getOrComputeEmbedding: getOrComputeEmbedding,
    calculateSimilarity: calculateSimilarity,
    computeSemanticLinks: computeSemanticLinks,
    processAllNodes: processAllNodes,
    getState: function () { return state; },
    getLinks: function () { return state.semanticLinks; },
    getCache: function () { return state.cache; },
    isReady: function () { return state.ready; },
    THRESHOLD: SIMILARITY_THRESHOLD,
  };

  console.log('[AetherEmbed] Event listeners attached, module ready to receive commands');
})();
