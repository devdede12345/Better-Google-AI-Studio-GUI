# AetherMind: Better Google AI Studio GUI

> **Visualize, Branch, and Connect your 2M+ Token Context with Ease.**

![4ac62a4f635690f24669ca7243f88cb7.png](https://i.mji.rip/2026/04/12/4ac62a4f635690f24669ca7243f88cb7.png)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Version](https://img.shields.io/badge/Version-1.1.0-blue.svg)
![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest_V3-brightgreen.svg)

---

## Core Features

### 🌿 Git-Style Conversation Branching

- **Manage Chat Like Code:** Create a "New Branch" at any conversation turn to explore alternative paths while keeping the main thread clean.
- **Spatial Navigation:** Click any node in the sidebar graph to instantly scroll the main window to that conversation block.
- **Drag & Drop Reordering:** Move nodes between branches with a "Predictive Ghost Line" preview to reshape your thinking topology in real-time.
- **Fold / Unfold:** Collapse conversation sections to focus on what matters.

### 🎲 Semantic Network Graph [Under Development]

- **2D Force-Directed Network:** Toggle the network view from the sidebar header to see all conversation nodes as an interactive force graph.
- **Semantic Links:** Powered by on-device embeddings (all-MiniLM-L6-v2), automatically discovers and visualizes hidden connections between prompts based on meaning — not just sequence.
- **Branch-Colored Topology:** Links and nodes inherit their branch colors, making it easy to distinguish the main trunk from side branches at a glance.

### 🎨 High-End Interaction Design

- **Smooth Animations:** Sidebar expand/collapse, "explosion" network entrance, and node hover effects all use carefully tuned transitions.
- **Per-Conversation Persistence:** Your graph, branches, and custom labels are saved per chat URL via Chrome Storage API and automatically restored on revisit.
- **Light & Dark Mode:** Adapts to your system color scheme preference.

---

## 🛠️ Tech Stack

- **Runtime:** Vanilla JavaScript (Chrome Extension, Manifest V3)
- **Graphics Engine:** [D3.js v7](https://d3js.org/) — Force-directed layout with collision detection, radial forces, and branch-sector angular distribution
- **Natural Language Processing:** [Transformers.js](https://github.com/xenova/transformers.js) — On-device inference with `all-MiniLM-L6-v2` for 384-dim sentence embeddings
- **Storage:** Chrome Storage API (state persistence) + IndexedDB (vector cache for embeddings)
- **Injection Architecture:** Dual-world content scripts — `ISOLATED` world for DOM manipulation, `MAIN` world for D3/Transformers.js libraries, bridged via CustomEvents

---

## 📦 Installation

1. **Clone the Repository:**
```bash
git clone https://github.com/devdede12345/Better-Google-AI-Studio-GUI.git
```
2. **Load the Extension:**
    - Open Chrome and navigate to `chrome://extensions/`
    - Enable **"Developer mode"** in the top right corner
    - Click **"Load unpacked"**
    - Select the project folder you just cloned
3. **Launch:**
    - Visit [Google AI Studio](https://aistudio.google.com/)
    - Click the **🌿** tab on the left edge to open the AetherMind sidebar
    - Use the **🎲** toggle switch in the panel header to activate the Network Graph

---

## 🗺️ Roadmap

See [`todo.todo`](./todo.todo) for the full prioritized list. Highlights:

- **Dynamic force tuning** — auto-scale physics parameters based on conversation size
- **Keyboard shortcuts** — `Ctrl+B` to branch, `Ctrl+/` to toggle sidebar
- **Search & filter** — find nodes by keyword in long conversations
- **Export/Import** — save your conversation tree as JSON or Markdown
- **Similarity slider** — let users tune semantic link density in real-time
- **Code modularization** — split the monolithic content.js into focused modules