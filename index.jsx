/**
 * knowledge-tree-agent.jsx  v3
 * ════════════════════════════════════════════════════════════════
 *
 *  § 1  颜色系统 & 常量
 *  § 2  树布局算法
 *  § 3  LLM Prompt 引擎
 *  § 4  KnowledgeTreeAgent
 *  § 5  useKnowledgeTree    (单树 Hook，向下兼容)
 *  § 6  useMultiRoots       (多根 Hook — 核心新功能)
 *  § 7  SoundSystem         (Web Audio API 音效)
 *  § 8  TreeCanvas          (SVG 画布，支持多树)
 *  § 9  NodeDetail          (节点详情面板)
 *  § 10 KnowledgeTreeWidget (完整组件)
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
gsap.registerPlugin(useGSAP)

// ══════════════════════════════════════════════════════════════════
// § 1  Color System & Constants
// ══════════════════════════════════════════════════════════════════

export const LEVEL_COLORS = [
  { fill: "#1c0d00", stroke: "#f59e0b", text: "#fcd34d" }, // L0 琥珀 root
  { fill: "#001910", stroke: "#10b981", text: "#6ee7b7" }, // L1 翡翠
  { fill: "#10001e", stroke: "#8b5cf6", text: "#c4b5fd" }, // L2 紫罗兰
  { fill: "#001618", stroke: "#06b6d4", text: "#67e8f9" }, // L3 青蓝
  { fill: "#190008", stroke: "#f43f5e", text: "#fda4af" }, // L4+ 玫瑰
];

// 每棵树的根节点主题色（多树区分）
const ROOT_THEME_COLORS = [
  "#f59e0b", // 琥珀
  "#38bdf8", // 天蓝
  "#fb7185", // 玫瑰红
  "#a78bfa", // 紫色
];

const LC = (level) => LEVEL_COLORS[Math.min(level, LEVEL_COLORS.length - 1)];
const NR = (level) => [34, 26, 20, 16, 14][Math.min(level, 4)];

export const AGENT_DEFAULTS = {
  apiUrl:       "https://api.anthropic.com/v1/messages",
  model:        "claude-sonnet-4-20250514",
  maxLevel:     2,
  maxTokens:    1500,
  retries:      2,
  branchFactor: [3, 3, 2],
  minRelevance: 6,
};

const MAX_ROOTS = 4; // 垂直根数量上限

// ══════════════════════════════════════════════════════════════════
// LANG — Bilingual translation table (zh / en)
// ══════════════════════════════════════════════════════════════════

const LANG = {
  zh: {
    appName:  "知识图谱探索者",
    tagline:  "费曼学习法 · 反幻觉 · 多根关联",
    sound:    { on: "♪ 音效", off: "♪ 静音", titleOn: "关闭音效", titleOff: "开启音效" },
    admin: "后台", logout: "退出",
    input: {
      maxReached: "已达到最多 4 棵知识树",
      busy:       "探索中，可点击「中断搜索」停止…",
      default:    "输入概念，添加新知识树 — 李白、王维、量子纠缠…",
    },
    depth:            "深度",
    cancelBtn:        "⊘ 中断搜索",
    addRoot:          "添加根",
    analyzing:        "分析中…",
    analyzeRelations: "⟷ 分析关联",
    clear:            "✕ 清空",
    treesLabel:       "知识树",
    crossInfo:        (n) => `— ${n} 条跨树关联（虚线）`,
    emptyCanvas:      "在上方搜索栏添加第一棵知识树",
    nodeHint:         ["点击节点查看详情", "点击 + 按钮深度探索", "多树可分析跨树关联"],
    logEmpty:         "Agent 运行日志…",
    levelNames:       ["根概念", "一级分支", "二级概念", "三级概念", "四级概念"],
    relevance:        "相关度",
    loadingText:      "加载中…",
    noSubTitle:       "⊘ 未找到强相关子概念",
    noSubDesc:        "该概念在此层级已足够细粒度，知识图谱在此终止延伸。",
    subconcepts:      "子概念",
    backTo:           (l) => `← 返回 ${l}`,
    links: [
      { label: "维基百科", url: (l) => `https://zh.wikipedia.org/wiki/${encodeURIComponent(l)}`,    color: "#3b82f6" },
      { label: "百度百科", url: (l) => `https://baike.baidu.com/item/${encodeURIComponent(l)}`,    color: "#06b6d4" },
      { label: "Google",   url: (l) => `https://www.google.com/search?q=${encodeURIComponent(l)}`, color: "#8b5cf6" },
    ],
    canvasEmpty: "输入概念，构建知识图谱",
    zoomIn: "放大", zoomOut: "缩小", fitView: "适应屏幕",
    assoc: {
      btn:              "⟷ 关联模式",
      btnActive:        "⟷ 退出关联",
      pickNode:         "点击节点加入关联分析（最多4个）",
      selectedLabel:    (n, max) => `已选 ${n}/${max} 个节点`,
      minNodes:         "至少选择 2 个节点",
      analyzeBtn:       "分析关联",
      analyzing:        "正在分析关联…",
      cancelBtn:        "取消分析",
      clearSelection:   "清空选择",
      resultTitle:      "关联分析",
      pairsTitle:       "节点对关联",
      themesTitle:      "共同点",
      summaryTitle:     "整体分析",
      extractBtn:       "↳ 提取为新知识树",
      extractClearTitle:"画布已满",
      extractClearDesc: (n) => `当前有 ${n} 棵树，提取将清空画布并创建关联树`,
      extractClearConfirm: "清空并提取",
      extractPickTitle: "选择要移除的树",
      extractPickDesc:  "画布已满，请选择一棵移除后添加关联树",
      extractCancel:    "取消",
      strength:         "关联强度",
      relation:         "关联类型",
      reason:           "关联说明",
      themes:           "共同主题",
      close:            "关闭",
      noResult:         "关联强度较弱",
      autoBtn:          "⟷ 自动查找关联",
      autoBusy:         "查找中…",
      autoEmpty:        "未找到强关联节点（≥7分）",
      autoResults:      "自动关联结果",
      viewPair:         "查看节点对",
    },
    log: {
      start:       (c) => `◎ 开始探索: "${c}"`,
      loading:     (l) => `  ⟳ 分析: "${l}"`,
      doneNoChild: (l) => `  ⊘ "${l}" — 无强相关子概念`,
      done:        (l, n) => `  ✓ "${l}" → ${n} 子概念`,
      error:       (l, m) => `  ✗ "${l}": ${m}`,
      complete:    "✨ 构建完成",
      cancelled:   "⊘ 探索已中断",
    },
    settings: {
      title:       "个人偏好",
      style:       "叙事风格",
      styleOpts:   { feynman: "费曼式", academic: "学术式", concise: "简明式", beginner: "启蒙式" },
      styleDescs:  { feynman: "历史故事 & 惊人事实", academic: "严格定义 & 专业术语", concise: "一句话核心要义", beginner: "类比 & 生活化例子" },
      background:  "我的背景",
      bgPh:        "如：程序员 / 历史爱好者 / 大学生",
      llmLang:     "LLM 输出语言",
      langOpts:    { auto: "跟随界面", zh: "中文", en: "English" },
      save:        "保存",
      saved:       "已保存 ✓",
      cancel:      "取消",
    },
  },
  en: {
    appName:  "Knowledge Graph Explorer",
    tagline:  "Feynman Method · Anti-hallucination · Multi-root",
    sound:    { on: "♪ Sound", off: "♪ Mute", titleOn: "Disable sound", titleOff: "Enable sound" },
    admin: "Admin", logout: "Logout",
    input: {
      maxReached: "Max 4 trees reached",
      busy:       "Exploring… click 'Stop' to cancel",
      default:    "Enter a concept — Newton, Quantum, Democracy…",
    },
    depth:            "Depth",
    cancelBtn:        "⊘ Stop",
    addRoot:          "Add Root",
    analyzing:        "Analyzing…",
    analyzeRelations: "⟷ Relations",
    clear:            "✕ Clear",
    treesLabel:       "Trees",
    crossInfo:        (n) => `— ${n} cross-tree link${n > 1 ? "s" : ""} (dashed)`,
    emptyCanvas:      "Add your first knowledge tree above",
    nodeHint:         ["Click a node to view details", "Click + to explore deeper", "Analyze cross-tree relations"],
    logEmpty:         "Agent log…",
    levelNames:       ["Root", "L1 Branch", "L2 Concept", "L3 Concept", "L4 Concept"],
    relevance:        "Relevance",
    loadingText:      "Loading…",
    noSubTitle:       "⊘ No strong sub-concepts",
    noSubDesc:        "This concept is atomic at this level; the knowledge tree terminates here.",
    subconcepts:      "Sub-concepts",
    backTo:           (l) => `← Back to ${l}`,
    links: [
      { label: "Wikipedia", url: (l) => `https://en.wikipedia.org/wiki/${encodeURIComponent(l)}`,   color: "#3b82f6" },
      { label: "Baidu",     url: (l) => `https://baike.baidu.com/item/${encodeURIComponent(l)}`,    color: "#06b6d4" },
      { label: "Google",    url: (l) => `https://www.google.com/search?q=${encodeURIComponent(l)}`, color: "#8b5cf6" },
    ],
    canvasEmpty: "Enter a concept to build a knowledge graph",
    zoomIn: "Zoom In", zoomOut: "Zoom Out", fitView: "Fit View",
    assoc: {
      btn:              "⟷ Assoc Mode",
      btnActive:        "⟷ Exit Assoc",
      pickNode:         "Click nodes to add (max 4)",
      selectedLabel:    (n, max) => `${n}/${max} nodes selected`,
      minNodes:         "Select at least 2 nodes",
      analyzeBtn:       "Analyze",
      analyzing:        "Analyzing relations…",
      cancelBtn:        "Cancel",
      clearSelection:   "Clear",
      resultTitle:      "Association Analysis",
      pairsTitle:       "Pairwise Relations",
      themesTitle:      "Common Traits",
      summaryTitle:     "Summary",
      extractBtn:       "↳ Extract as New Tree",
      extractClearTitle:"Canvas Full",
      extractClearDesc: (n) => `${n} trees on canvas. Extracting will clear all and add the association tree.`,
      extractClearConfirm: "Clear & Extract",
      extractPickTitle: "Choose Tree to Remove",
      extractPickDesc:  "Canvas is full — remove one tree to add the association tree.",
      extractCancel:    "Cancel",
      strength:         "Strength",
      relation:         "Relation Type",
      reason:           "Explanation",
      themes:           "Shared Themes",
      close:            "Close",
      noResult:         "Weak relation",
      autoBtn:          "⟷ Auto-find Relations",
      autoBusy:         "Searching…",
      autoEmpty:        "No strong relations found (≥7)",
      autoResults:      "Auto-relation Results",
      viewPair:         "View Pair",
    },
    log: {
      start:       (c) => `◎ Exploring: "${c}"`,
      loading:     (l) => `  ⟳ Analyzing: "${l}"`,
      doneNoChild: (l) => `  ⊘ "${l}" — no strong sub-concepts`,
      done:        (l, n) => `  ✓ "${l}" → ${n} sub-concepts`,
      error:       (l, m) => `  ✗ "${l}": ${m}`,
      complete:    "✨ Complete",
      cancelled:   "⊘ Exploration stopped",
    },
    settings: {
      title:       "Preferences",
      style:       "Narrative Style",
      styleOpts:   { feynman: "Feynman", academic: "Academic", concise: "Concise", beginner: "Beginner" },
      styleDescs:  { feynman: "Stories & surprising facts", academic: "Strict definitions & terminology", concise: "One-line core essence", beginner: "Analogies & everyday examples" },
      background:  "My Background",
      bgPh:        "e.g. programmer / history buff / student",
      llmLang:     "LLM Output Language",
      langOpts:    { auto: "Follow UI", zh: "中文", en: "English" },
      save:        "Save",
      saved:       "Saved ✓",
      cancel:      "Cancel",
    },
  },
};

// ══════════════════════════════════════════════════════════════════
// § 2  Tree Layout
// ══════════════════════════════════════════════════════════════════

let _uid = 0;

export const mkNode = (label, level, relevance = null) => ({
  id: _uid++,
  label,
  level,
  explanation: "",
  relevance,
  hasStrongRelations: null,
  children: [],
  status: "pending",
  x: 0,
  y: 0,
});

function _countLeaves(n) {
  if (!n.children.length) return 1;
  return n.children.reduce((s, c) => s + _countLeaves(c), 0);
}

function _assignX(node, x0, spacing) {
  if (!node.children.length) {
    node.x = x0 + spacing / 2;
    return x0 + spacing;
  }
  let x = x0;
  for (const c of node.children) x = _assignX(c, x, spacing);
  node.x = (node.children[0].x + node.children[node.children.length - 1].x) / 2;
  return x;
}

function _assignY(node, d) {
  node.y = d * 165 + 85;
  for (const c of node.children) _assignY(c, d + 1);
}

export function treeLayout(root, W = 1100) {
  const leaves  = _countLeaves(root);
  const spacing = Math.max(95, (W - 120) / leaves);
  const totalW  = leaves * spacing;
  _assignX(root, Math.max(60, (W - totalW) / 2), spacing);
  _assignY(root, 0);
}

export const flattenTree = (n, o = []) => {
  o.push(n);
  n.children.forEach(c => flattenTree(c, o));
  return o;
};

export const getTreeEdges = (n, o = []) => {
  n.children.forEach(c => {
    o.push([n, c]);
    getTreeEdges(c, o);
  });
  return o;
};

// ══════════════════════════════════════════════════════════════════
// § 3  LLM Prompt Engine
// ══════════════════════════════════════════════════════════════════

const _STYLE_INSTR = {
  feynman:  "explanation：用 2-3 句生动的历史故事或令人惊讶的事实（叙事风格，非枯燥定义）",
  academic: "explanation：采用学术式语言，给出严格定义和专业术语，语言简练正式",
  concise:  "explanation：用一句话概括核心要义，直指本质，不加故事与冗余",
  beginner: "explanation：假设读者是好奇的高中生，用简单类比和生活化例子解释",
};

const _LANG_INSTR = { zh: "所有文字中文", en: "All text in English" };

function buildSystemPrompt(prefs = {}, uiLang = "zh") {
  const style   = _STYLE_INSTR[prefs?.style] || _STYLE_INSTR.feynman;
  const bg      = typeof prefs?.background === "string" ? prefs.background.trim() : "";
  const lang    = prefs?.llmLang === "auto" || !prefs?.llmLang ? uiLang : prefs.llmLang;
  const langStr = _LANG_INSTR[lang] || _LANG_INSTR.zh;
  const bgStr   = bg ? `\n用户背景：「${bg}」。explanation 须结合此背景视角，让解释对该用户更有共鸣。` : "";

  return `你是一位严谨的知识图谱构建者。${bgStr}

【子概念定义 — 极其重要】
子概念 = 父概念的「直接组成部分」「核心属性」「内部机制」。
严禁将以下情形列为子概念：
- 与父概念并列的同类概念（如"李白"→"杜甫"，"牛顿"→"爱因斯坦"）
- 父概念所属的更大范畴（如"李白"→"唐朝"，"苹果"→"水果"）
- 仅因历史/地理/时代关联而相关的概念

正确示例：「李白」→ 子概念：浪漫主义诗风、道教人生观、饮酒意象、绝句创作技法
错误示例：「李白」→ 子概念：杜甫、唐朝、长安（这些是平行或父级概念）

【输出规则】
1. ${style}
   若有父概念语境，须描述与父概念的具体关联，不要泛泛而谈
2. subconcepts：只列直接子概念，须标注 relevance（1-10）
   - relevance ≥ 7：强相关，必须收录
   - relevance 5-6：中等相关，谨慎收录
   - relevance < 5：弱相关，禁止收录
3. has_strong_relations：能找到 relevance ≥ 5 的直接子概念则 true，否则 false
4. 最细粒度知识点无法合理拆分时，has_strong_relations = false

【反幻觉原则 — 极其重要】
- 宁可返回空数组，也不编造关系
- 子概念必须「属于」父概念，而非仅仅「与」父概念相关联

${langStr}。仅输出合法 JSON，无 markdown。`;
}

const _buildPrompt = (label, level, isLeaf, n, parentLabel = null) => {
  const fmt = isLeaf
    ? `{"explanation":"...（中文叙事）...","has_strong_relations":false,"subconcepts":[]}`
    : `{"explanation":"...（中文叙事）...","has_strong_relations":true,"subconcepts":[{"label":"子概念名","relevance":8}]}`;
  const ctx = parentLabel
    ? `上下文：「${label}」是「${parentLabel}」的直接子概念，explanation 须体现与「${parentLabel}」的具体关联\n`
    : "";
  return `${ctx}概念：「${label}」（层级 ${level}，${isLeaf ? "叶节点" : `期望最多 ${n} 个子概念`}）\n\n只输出 JSON，格式参考：\n${fmt}`;
};

const _parseJSON = (text) => {
  text = text.replace(/```json\s*|```\s*/g, "").trim();
  try { return JSON.parse(text); } catch (_) {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error("JSON 解析失败: " + text.slice(0, 100));
};

// ══════════════════════════════════════════════════════════════════
// § 4  KnowledgeTreeAgent
// ══════════════════════════════════════════════════════════════════

export class KnowledgeTreeAgent {
  constructor(cfg = {}) {
    this.cfg = { ...AGENT_DEFAULTS, ...cfg };
    if (!this.cfg.apiKey && typeof process !== "undefined")
      this.cfg.apiKey = process.env?.ANTHROPIC_API_KEY ?? "";
  }

  async *explore(concept) {
    // Do NOT reset _uid here — useKnowledgeTree resets it for single-tree mode,
    // and useMultiRoots needs globally unique IDs across all trees.
    const root = mkNode(concept.trim(), 0);
    treeLayout(root);
    yield { type: "start", node: root, tree: root };

    const queue = [root];
    while (queue.length) {
      const node = queue.shift();
      node.status = "loading";
      treeLayout(root);
      yield { type: "node:loading", node, tree: root };

      try {
        const data = await this._call(node.label, node.level, node._parentLabel ?? null);
        node.explanation = data.explanation ?? "";
        node.hasStrongRelations = data.has_strong_relations ?? (data.subconcepts?.length > 0);

        if (node.hasStrongRelations && Array.isArray(data.subconcepts) && node.level < this.cfg.maxLevel) {
          const limit = this.cfg.branchFactor[node.level] ?? 2;
          data.subconcepts.filter(s => (s.relevance ?? 10) >= this.cfg.minRelevance).slice(0, limit).forEach(s => {
            const child = mkNode(String(s.label).trim(), node.level + 1, s.relevance);
            child._parentLabel = node.label;
            node.children.push(child);
            queue.push(child);
          });
        }
        node.status = "done";
        treeLayout(root);
        yield { type: "node:done", node, tree: root };
      } catch (err) {
        node.status = "error";
        treeLayout(root);
        yield { type: "node:error", node, tree: root, error: err };
      }
    }
    yield { type: "complete", tree: root };
  }

  async run(concept) {
    let t;
    for await (const ev of this.explore(concept)) t = ev.tree;
    return t;
  }

  async _call(label, level, parentLabel = null) {
    const { apiUrl, model, maxTokens, apiKey, retries, maxLevel, branchFactor, prefs, lang } = this.cfg;
    const isLeaf = level >= maxLevel;
    const body   = JSON.stringify({ model, max_tokens: maxTokens, system: buildSystemPrompt(prefs, lang), messages: [{ role: "user", content: _buildPrompt(label, level, isLeaf, branchFactor[level] ?? 2, parentLabel) }] });
    const headers = { "Content-Type": "application/json", "anthropic-version": "2023-06-01", ...(apiKey ? { "x-api-key": apiKey } : {}) };
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await fetch(apiUrl, { method: "POST", headers, body });
        const d = await r.json();
        if (d.error) throw new Error(d.error.message);
        return _parseJSON(d.content?.map(b => b.text ?? "").join("") ?? "");
      } catch (err) {
        if (i === retries) throw err;
        await new Promise(r => setTimeout(r, 900 * (i + 1)));
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// § 5  useKnowledgeTree  (单树 Hook，向下兼容)
// ══════════════════════════════════════════════════════════════════

export function useKnowledgeTree(agentConfig = {}, lang = "zh") {
  const cfgRef  = useRef(agentConfig);
  const langRef = useRef(lang);
  const runIdRef = useRef(0);
  const treeRef = useRef(null);
  useEffect(() => { cfgRef.current = agentConfig; });
  useEffect(() => { langRef.current = lang; }, [lang]);

  const [tree, setTree]           = useState(null);
  const [log, setLog]             = useState([]);
  const [busy, setBusy]           = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  const explore = useCallback(async (concept) => {
    if (!concept?.trim() || busyRef.current) return;
    const runId = ++runIdRef.current;
    _uid = 0;
    setBusy(true); setTree(null); setSelectedNode(null);
    treeRef.current = null;
    const tl = () => LANG[langRef.current].log;
    setLog([tl().start(concept.trim())]);
    const agent = new KnowledgeTreeAgent(cfgRef.current);
    for await (const ev of agent.explore(concept)) {
      if (runIdRef.current !== runId) break;
      treeRef.current = ev.tree;
      const TR = { ...ev.tree };
      switch (ev.type) {
        case "start":        setTree(TR); break;
        case "node:loading": setTree(TR); setLog(p => [...p, tl().loading(ev.node.label)]); break;
        case "node:done":    setTree(TR); setLog(p => [...p, ev.node.hasStrongRelations === false ? tl().doneNoChild(ev.node.label) : tl().done(ev.node.label, ev.node.children.length)]); break;
        case "node:error":   setTree(TR); setLog(p => [...p, tl().error(ev.node.label, ev.error?.message?.slice(0, 55) ?? "")]); break;
        case "complete":     setLog(p => [...p, tl().complete]); break;
      }
    }
    if (runIdRef.current === runId) setBusy(false);
  }, []);

  const expand = useCallback(async (nodeId) => {
    if (!treeRef.current) return;
    const node = flattenTree(treeRef.current).find(n => n.id === nodeId);
    if (!node || node.status !== "done" || node.children.length > 0 || node.hasStrongRelations === false) return;
    setBusy(true);
    node.status = "loading"; treeLayout(treeRef.current); setTree({ ...treeRef.current });
    try {
      const agent = new KnowledgeTreeAgent(cfgRef.current);
      const allNodes = flattenTree(treeRef.current);
      const nodeParent = allNodes.find(n => n.children.some(c => c.id === nodeId));
      const data = await agent._call(node.label, node.level, nodeParent?.label ?? null);
      node.explanation = data.explanation ?? node.explanation;
      node.hasStrongRelations = data.has_strong_relations ?? (data.subconcepts?.length > 0);
      node.status = "done";
      const minR = cfgRef.current.minRelevance ?? AGENT_DEFAULTS.minRelevance;
      const eligible = (data.subconcepts ?? []).filter(s => (s.relevance ?? 10) >= minR).slice(0, 3);
      if (!eligible.length) { treeLayout(treeRef.current); setTree({ ...treeRef.current }); setBusy(false); return; }
      const children = eligible.map(s => { const c = mkNode(String(s.label).trim(), node.level + 1, s.relevance); c.status = "loading"; node.children.push(c); return c; });
      treeLayout(treeRef.current); setTree({ ...treeRef.current });
      await Promise.all(children.map(async child => {
        try {
          const d = await agent._call(child.label, child.level, node.label);
          child.explanation = d.explanation ?? ""; child.hasStrongRelations = d.has_strong_relations ?? false; child.status = "done";
        } catch { child.status = "error"; }
        treeLayout(treeRef.current); setTree({ ...treeRef.current });
      }));
    } catch (err) {
      node.status = "error"; treeLayout(treeRef.current); setTree({ ...treeRef.current });
    }
    setBusy(false);
  }, []);

  const nodes = tree ? flattenTree(tree) : [];
  const edges = tree ? getTreeEdges(tree) : [];
  return { tree, nodes, edges, log, busy, selectedNode, setSelectedNode, explore, expand };
}

// ══════════════════════════════════════════════════════════════════
// § 6  useMultiRoots  —  多根知识树管理 Hook
// ══════════════════════════════════════════════════════════════════

export function useMultiRoots(agentConfig = {}, lang = "zh", maxRootsLimit = MAX_ROOTS) {
  const cfgRef   = useRef(agentConfig);
  const langRef  = useRef(lang);
  const maxRef   = useRef(maxRootsLimit);
  const rootsRef = useRef([]); // 最新 roots 快照（用于 expand 等回调）
  useEffect(() => { cfgRef.current = agentConfig; });
  useEffect(() => { langRef.current = lang; }, [lang]);
  useEffect(() => { maxRef.current = maxRootsLimit; }, [maxRootsLimit]);

  const [roots, setRoots]               = useState([]); // [{id, concept, tree, nodes, edges, log, busy, color}]
  const [crossEdges, setCrossEdges]     = useState([]); // [{fromNodeLabel, toNodeLabel, fromRootId, toRootId, strength, reason}]
  const [crossBusy, setCrossBusy]       = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedRootId, setSelectedRootId] = useState(null);

  useEffect(() => { rootsRef.current = roots; }, [roots]);

  const _updateRoot = useCallback((rootId, patch) => {
    setRoots(prev => prev.map(r => r.id === rootId ? { ...r, ...patch } : r));
  }, []);

  // cancel flag map: rootId → true means "please stop"
  const cancelFlagsRef = useRef(new Map());

  // ── 中断当前探索 ────────────────────────────────────────────────
  const cancelSearch = useCallback(() => {
    const busyRoot = rootsRef.current.find(r => r.busy);
    if (!busyRoot) return;
    cancelFlagsRef.current.set(busyRoot.id, true);
    setRoots(prev => prev.map(r =>
      r.id === busyRoot.id ? { ...r, busy: false, log: [...r.log, LANG[langRef.current].log.cancelled] } : r
    ));
  }, []);

  // ── 添加新根 ────────────────────────────────────────────────────
  const addRoot = useCallback(async (concept) => {
    if (!concept?.trim()) return;
    const currentRoots = rootsRef.current;
    if (currentRoots.length >= maxRef.current) return;
    if (currentRoots.some(r => r.busy)) return;

    const rootId   = Date.now();
    const colorIdx = currentRoots.length % ROOT_THEME_COLORS.length;
    const color    = ROOT_THEME_COLORS[colorIdx];
    const newRoot  = { id: rootId, concept: concept.trim(), tree: null, nodes: [], edges: [], log: [LANG[langRef.current].log.start(concept.trim())], busy: true, color };

    setRoots(prev => [...prev, newRoot]);
    setSelectedRootId(rootId);

    const agent = new KnowledgeTreeAgent({ ...cfgRef.current });

    for await (const ev of agent.explore(concept)) {
      // Cancelled or root removed by user
      if (cancelFlagsRef.current.get(rootId)) { cancelFlagsRef.current.delete(rootId); break; }
      if (!rootsRef.current.find(r => r.id === rootId)) break;

      const tl = LANG[langRef.current].log;
      const logMsg = (() => {
        switch (ev.type) {
          case "node:loading": return tl.loading(ev.node.label);
          case "node:done":    return ev.node.hasStrongRelations === false ? tl.doneNoChild(ev.node.label) : tl.done(ev.node.label, ev.node.children.length);
          case "node:error":   return tl.error(ev.node.label, "");
          case "complete":     return tl.complete;
          default: return null;
        }
      })();

      setRoots(prev => prev.map(r => {
        if (r.id !== rootId) return r;
        const T = ev.tree ? { ...ev.tree } : r.tree;
        return {
          ...r,
          tree:  T,
          nodes: T ? flattenTree(T) : r.nodes,
          edges: T ? getTreeEdges(T) : r.edges,
          log:   logMsg ? [...r.log, logMsg] : r.log,
          busy:  ev.type !== "complete",
        };
      }));
    }
    // 确保最终 busy=false
    setRoots(prev => prev.map(r => r.id === rootId ? { ...r, busy: false } : r));
  }, []);

  // ── 移除某棵树 ──────────────────────────────────────────────────
  const removeRoot = useCallback((rootId) => {
    setRoots(prev => prev.filter(r => r.id !== rootId));
    setCrossEdges(prev => prev.filter(e => e.fromRootId !== rootId && e.toRootId !== rootId));
    setSelectedNode(n => n?._rootId === rootId ? null : n);
    setSelectedRootId(prev => prev === rootId ? null : prev);
  }, []);

  // ── 清空所有树 ──────────────────────────────────────────────────
  const clearAll = useCallback(() => {
    setRoots([]);
    setCrossEdges([]);
    setSelectedNode(null);
    setSelectedRootId(null);
  }, []);

  // ── 深度探索 ────────────────────────────────────────────────────
  const expand = useCallback(async (nodeId, rootId) => {
    const rootEntry = rootsRef.current.find(r => r.id === rootId);
    if (!rootEntry?.tree || rootEntry.busy) return;
    const node = flattenTree(rootEntry.tree).find(n => n.id === nodeId);
    if (!node || node.status !== "done" || node.children.length > 0 || node.hasStrongRelations === false) return;

    _updateRoot(rootId, { busy: true });
    node.status = "loading";
    treeLayout(rootEntry.tree);
    _updateRoot(rootId, { tree: { ...rootEntry.tree }, nodes: flattenTree(rootEntry.tree), edges: getTreeEdges(rootEntry.tree) });

    try {
      const agent     = new KnowledgeTreeAgent(cfgRef.current);
      const allNodes  = flattenTree(rootEntry.tree);
      const parent    = allNodes.find(n => n.children.some(c => c.id === nodeId));
      const data      = await agent._call(node.label, node.level, parent?.label ?? null);
      node.explanation = data.explanation ?? node.explanation;
      node.hasStrongRelations = data.has_strong_relations ?? (data.subconcepts?.length > 0);
      node.status = "done";
      const minR     = cfgRef.current.minRelevance ?? AGENT_DEFAULTS.minRelevance;
      const eligible = (data.subconcepts ?? []).filter(s => (s.relevance ?? 10) >= minR).slice(0, 3);
      if (eligible.length) {
        const children = eligible.map(s => { const c = mkNode(s.label, node.level + 1, s.relevance); c.status = "loading"; node.children.push(c); return c; });
        treeLayout(rootEntry.tree);
        _updateRoot(rootId, { tree: { ...rootEntry.tree }, nodes: flattenTree(rootEntry.tree), edges: getTreeEdges(rootEntry.tree) });
        await Promise.all(children.map(async child => {
          try { const d = await agent._call(child.label, child.level, node.label); child.explanation = d.explanation ?? ""; child.hasStrongRelations = d.has_strong_relations ?? false; child.status = "done"; }
          catch { child.status = "error"; }
          treeLayout(rootEntry.tree);
          _updateRoot(rootId, { tree: { ...rootEntry.tree }, nodes: flattenTree(rootEntry.tree), edges: getTreeEdges(rootEntry.tree) });
        }));
      }
    } catch { node.status = "error"; }
    treeLayout(rootEntry.tree);
    _updateRoot(rootId, { busy: false, tree: { ...rootEntry.tree }, nodes: flattenTree(rootEntry.tree), edges: getTreeEdges(rootEntry.tree) });
  }, [_updateRoot]);

  // ── 添加预构建树（关联提取用）──────────────────────────────────
  const addPrebuiltRoot = useCallback((tree, concept, color) => {
    const rootId   = Date.now() + Math.floor(Math.random() * 1000);
    const colorIdx = rootsRef.current.length % ROOT_THEME_COLORS.length;
    const c        = color || ROOT_THEME_COLORS[colorIdx];
    treeLayout(tree);
    const nodes = flattenTree(tree);
    const edges = getTreeEdges(tree);
    setRoots(prev => [...prev, { id: rootId, concept, tree, nodes, edges, log: ["✨ 关联树已提取"], busy: false, color: c }]);
    setSelectedRootId(rootId);
  }, []);

  // ── 清空所有树并添加一棵预构建树 ─────────────────────────────
  const clearAndAdd = useCallback((tree, concept, color) => {
    const rootId   = Date.now() + Math.floor(Math.random() * 1000);
    const c        = color || ROOT_THEME_COLORS[0];
    treeLayout(tree);
    const nodes = flattenTree(tree);
    const edges = getTreeEdges(tree);
    setCrossEdges([]);
    setSelectedNode(null);
    setRoots([{ id: rootId, concept, tree, nodes, edges, log: ["✨ 关联树已提取"], busy: false, color: c }]);
    setSelectedRootId(rootId);
  }, []);

  // ── 跨树关联分析 ────────────────────────────────────────────────
  const findCrossRelations = useCallback(async () => {
    const doneTrees = rootsRef.current.filter(r => !r.busy && r.nodes.length > 0);
    if (doneTrees.length < 2) return;
    setCrossBusy(true);
    try {
      const payload = doneTrees.map(r => ({
        concept:    r.concept,
        nodeLabels: r.nodes.filter(n => n.status === "done").map(n => n.label),
      }));
      const res = await fetch("/api/cross-relations", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ roots: payload }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (Array.isArray(data.connections)) {
        // 将标签名映射到节点 ID
        const newEdges = data.connections.flatMap(conn => {
          const fromRoot = doneTrees[conn.fromTree - 1];
          const toRoot   = doneTrees[conn.toTree   - 1];
          if (!fromRoot || !toRoot) return [];
          const fromNode = fromRoot.nodes.find(n => n.label === conn.from);
          const toNode   = toRoot.nodes.find(n => n.label === conn.to);
          if (!fromNode || !toNode) return [];
          return [{ fromNodeId: fromNode.id, toNodeId: toNode.id, fromRootId: fromRoot.id, toRootId: toRoot.id, strength: conn.strength, reason: conn.reason }];
        });
        setCrossEdges(newEdges);
      }
    } catch (err) {
      console.error("跨树关联分析失败:", err.message);
    }
    setCrossBusy(false);
  }, []);

  const anyBusy = roots.some(r => r.busy);

  return {
    roots,
    crossEdges,
    crossBusy,
    anyBusy,
    selectedNode,
    setSelectedNode,
    selectedRootId,
    setSelectedRootId,
    addRoot,
    addPrebuiltRoot,
    clearAndAdd,
    removeRoot,
    clearAll,
    cancelSearch,
    expand,
    findCrossRelations,
    maxRootsReached: roots.length >= maxRef.current,
  };
}

// ══════════════════════════════════════════════════════════════════
// § 7  SoundSystem  —  Web Audio API 音效
// ══════════════════════════════════════════════════════════════════

export const SoundSystem = {
  _ctx:          null,
  _enabled:      true,
  _ambientNodes: null,   // ambient drone nodes
  _masterGain:   null,

  getCtx() {
    if (!this._ctx) {
      try { this._ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
    }
    // Resume suspended context (browser autoplay policy)
    if (this._ctx?.state === "suspended") this._ctx.resume();
    return this._ctx;
  },

  setEnabled(v) {
    this._enabled = v;
    if (!v) this.stopAmbient();
    else if (!this._ambientNodes) this.startAmbient();
  },

  // ── Ambient: generative space drone ─────────────────────────────
  startAmbient() {
    if (!this._enabled) return;
    const ctx = this.getCtx();
    if (!ctx || this._ambientNodes) return;

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this._masterGain = master;

    // Two detuned sine oscillators for beating
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = "sine"; osc1.frequency.value = 82.4;   // E2
    osc2.type = "sine"; osc2.frequency.value = 82.9;   // slightly detuned → beat ~0.5 Hz

    // High harmonics overtone
    const osc3 = ctx.createOscillator();
    osc3.type = "sine"; osc3.frequency.value = 164.8;  // E3 octave

    // LFO for slow filter sweep
    const lfo = ctx.createOscillator();
    lfo.type = "sine"; lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 180;
    lfo.connect(lfoGain);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass"; filter.frequency.value = 400; filter.Q.value = 1.8;
    lfoGain.connect(filter.frequency);

    const g1 = ctx.createGain(); g1.gain.value = 0.55;
    const g2 = ctx.createGain(); g2.gain.value = 0.55;
    const g3 = ctx.createGain(); g3.gain.value = 0.18;

    osc1.connect(g1); osc2.connect(g2); osc3.connect(g3);
    g1.connect(filter); g2.connect(filter); g3.connect(filter);
    filter.connect(master);

    osc1.start(); osc2.start(); osc3.start(); lfo.start();

    // Fade in over 3 seconds
    master.gain.linearRampToValueAtTime(0.028, ctx.currentTime + 3);
    this._ambientNodes = { osc1, osc2, osc3, lfo, master };
  },

  stopAmbient() {
    if (!this._ambientNodes) return;
    const { osc1, osc2, osc3, lfo, master } = this._ambientNodes;
    const ctx = this.getCtx();
    if (ctx) {
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
      setTimeout(() => { try { osc1.stop(); osc2.stop(); osc3.stop(); lfo.stop(); } catch (_) {} }, 1600);
    }
    this._ambientNodes = null;
    this._masterGain   = null;
  },

  // Momentarily swell ambient when tree completes
  _ambientSwell() {
    if (!this._masterGain) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    this._masterGain.gain.cancelScheduledValues(t);
    this._masterGain.gain.setValueAtTime(this._masterGain.gain.value, t);
    this._masterGain.gain.linearRampToValueAtTime(0.055, t + 0.4);
    this._masterGain.gain.linearRampToValueAtTime(0.028, t + 2.5);
  },

  // ── One-shot tone ────────────────────────────────────────────────
  _tone(freq, type, duration, vol = 0.12, delay = 0, detune = 0) {
    if (!this._enabled) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    const t   = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gn  = ctx.createGain();
    osc.connect(gn); gn.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (detune) osc.detune.setValueAtTime(detune, t);
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(vol, t + 0.012);
    gn.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.start(t); osc.stop(t + duration + 0.05);
  },

  // Bell-like tone with 2 partials
  _bell(freq, vol = 0.09, delay = 0) {
    this._tone(freq,        "sine",     0.6, vol,      delay);
    this._tone(freq * 2.76, "sine",     0.35, vol * 0.4, delay);
  },

  play(type) {
    switch (type) {
      case "node:done":
        this._bell(880, 0.07); break;

      case "tree:complete":
        // C major chord arpeggio
        this._bell(523.25, 0.09, 0);
        this._bell(659.25, 0.09, 0.14);
        this._bell(783.99, 0.10, 0.28);
        this._bell(1046.5, 0.07, 0.42);
        this._ambientSwell();
        break;

      case "node:error":
        this._tone(180, "sawtooth", 0.3, 0.07);
        this._tone(160, "sawtooth", 0.2, 0.05, 0.18);
        break;

      case "click":
        this._tone(1200, "sine", 0.06, 0.05);
        this._tone(900,  "sine", 0.08, 0.03, 0.04);
        break;

      case "expand":
        this._bell(440, 0.07, 0);
        this._bell(554, 0.06, 0.1);
        break;

      case "add-root":
        this._bell(329.63, 0.09, 0);    // E4
        this._bell(415.30, 0.09, 0.12); // Ab4
        this._bell(523.25, 0.08, 0.24); // C5
        break;

      case "clear":
        this._tone(440, "sine", 0.12, 0.07, 0);
        this._tone(330, "sine", 0.18, 0.06, 0.1);
        this._tone(220, "sine", 0.3,  0.05, 0.22);
        break;

      case "cancel":
        this._tone(300, "triangle", 0.25, 0.07, 0);
        this._tone(240, "triangle", 0.2,  0.05, 0.12);
        break;

      case "cross-found":
        // Dreamy parallel motion
        this._bell(528,   0.09, 0);
        this._bell(660,   0.09, 0.1);
        this._bell(396,   0.08, 0.22);
        this._bell(528,   0.07, 0.34);
        this._ambientSwell();
        break;
    }
  },
};

// ══════════════════════════════════════════════════════════════════
// § 8  TreeCanvas  —  SVG 多树画布
// ══════════════════════════════════════════════════════════════════

function _bezier(x1, y1, x2, y2) {
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

function _TreeNodeSVG({ node, selected, assocSelected, onSelect, onExpand, themeColor }) {
  const c    = LC(node.level);
  const r    = NR(node.level);
  const strokeOverride = node.level === 0 && themeColor ? themeColor : c.stroke;
  const isDone = node.status === "done";
  const isLoad = node.status === "loading";
  const isPend = node.status === "pending";
  const isErr  = node.status === "error";
  const canExp = isDone && !node.children.length && node.hasStrongRelations !== false;
  const lowRel = node.relevance !== null && node.relevance < 7;
  const label  = node.label.length > 9 ? node.label.slice(0, 8) + "…" : node.label;
  const arcR   = r - 7;

  // Ripple state: stores a unique key each click to restart animation
  const [rippleKey, setRippleKey] = useState(null);
  const handleClick = () => {
    if (!isDone) return;
    setRippleKey(Date.now());
    onSelect?.(node);
  };

  return (
    <g>
      {/* Click ripple — restarted via key trick */}
      {rippleKey && (
        <circle key={rippleKey} cx={node.x} cy={node.y} r={r} fill="none" stroke={strokeOverride} strokeWidth={1.5} opacity={0}>
          <animate attributeName="r"       from={r} to={r * 5}  dur="0.55s" fill="freeze" />
          <animate attributeName="opacity" from="0.55" to="0"   dur="0.55s" fill="freeze" />
        </circle>
      )}

      {(isDone || isLoad) && (
        <>
          <circle cx={node.x} cy={node.y} r={r + 16} fill={strokeOverride} opacity={0.07} />
          <circle cx={node.x} cy={node.y} r={r + 9}  fill={strokeOverride} opacity={0.1} />
        </>
      )}
      {selected && (
        <circle cx={node.x} cy={node.y} r={r + 6} fill="none" stroke={strokeOverride} strokeWidth={1.5} strokeOpacity={0.65} strokeDasharray="5 3">
          <animateTransform attributeName="transform" type="rotate" from={`0 ${node.x} ${node.y}`} to={`360 ${node.x} ${node.y}`} dur="6s" repeatCount="indefinite" />
        </circle>
      )}
      {assocSelected && (
        <>
          <circle cx={node.x} cy={node.y} r={r + 10} fill="none" stroke="#8b5cf6" strokeWidth={2} opacity={0.7}>
            <animate attributeName="r" values={`${r+8};${r+16};${r+8}`} dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.7;0.2;0.7" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <circle cx={node.x} cy={node.y} r={r + 6} fill="rgba(139,92,246,0.1)" stroke="#8b5cf6" strokeWidth={1.5} opacity={0.5} />
        </>
      )}
      <circle cx={node.x} cy={node.y} r={r} fill={isDone || isLoad ? c.fill : "#0b0b16"} stroke={strokeOverride} strokeWidth={isDone ? 1.5 : isPend ? 0.5 : 1} opacity={isPend ? 0.28 : 1}
        style={{ cursor: isDone ? "pointer" : "default", transition: "opacity .35s" }} onClick={handleClick} />
      {isLoad && arcR > 0 && (
        <circle cx={node.x} cy={node.y} r={arcR} fill="none" stroke={strokeOverride} strokeWidth={2} strokeDasharray={`${arcR * 1.6} ${arcR * 10}`} strokeLinecap="round">
          <animateTransform attributeName="transform" type="rotate" from={`0 ${node.x} ${node.y}`} to={`360 ${node.x} ${node.y}`} dur="0.9s" repeatCount="indefinite" />
        </circle>
      )}
      {isDone && node.level === 0 && <text x={node.x} y={node.y + 1} textAnchor="middle" dominantBaseline="central" fontSize={16} fill={strokeOverride} opacity={0.65} style={{ pointerEvents: "none", userSelect: "none" }}>✦</text>}
      {isDone && node.hasStrongRelations === false && node.level > 0 && <text x={node.x} y={node.y + 1} textAnchor="middle" dominantBaseline="central" fontSize={11} fill={c.stroke} opacity={0.45} style={{ pointerEvents: "none", userSelect: "none" }}>∅</text>}
      {lowRel && isDone && <circle cx={node.x + r - 3} cy={node.y - r + 3} r={5} fill="#f59e0b" stroke="#07070d" strokeWidth={1.2} />}
      {isErr && <text x={node.x} y={node.y + 1} textAnchor="middle" dominantBaseline="central" fontSize={15} fill="#f43f5e" style={{ pointerEvents: "none" }}>!</text>}
      {!isPend && (
        <text x={node.x} y={node.y + r + 18} textAnchor="middle" fill={isLoad ? strokeOverride : c.text} fontSize={node.level === 0 ? 13 : node.level === 1 ? 12 : 11} fontWeight={node.level === 0 ? "500" : "400"} fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" opacity={isLoad ? 0.65 : 1} style={{ pointerEvents: "none", userSelect: "none" }}>
          {label}
        </text>
      )}
      {canExp && (
        <g style={{ cursor: "pointer" }} onClick={e => { e.stopPropagation(); onExpand?.(node.id); }}>
          <circle cx={node.x} cy={node.y + r + 36} r={18} fill="transparent" />
          <circle cx={node.x} cy={node.y + r + 36} r={9} fill={c.fill} stroke={strokeOverride} strokeWidth={1} opacity={0.85} />
          <text x={node.x} y={node.y + r + 37} textAnchor="middle" dominantBaseline="central" fontSize={14} fill={strokeOverride} style={{ userSelect: "none", pointerEvents: "none" }}>+</text>
        </g>
      )}
      <title>{node.label}</title>
    </g>
  );
}

export function KnowledgeTreeView({ nodes = [], edges = [], selectedNode, assocNodeIds = null, onNodeSelect, onNodeExpand, themeColor, xOffset = 0, yOffset = 0, lang = "zh" }) {
  const svgRef   = useRef(null);
  const groupRef = useRef(null);
  const dragRef  = useRef({ active: false, ox: 0, oy: 0 });
  const transRef = useRef({ x: 0, y: 0, s: 1 });
  const prevNodeCount = useRef(0);

  const applyT = () => {
    const { x, y, s } = transRef.current;
    groupRef.current?.setAttribute("transform", `translate(${x},${y}) scale(${s})`);
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = e => {
      e.preventDefault();
      const { x, y, s } = transRef.current;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const ns = Math.max(0.08, Math.min(6, s * (e.deltaY < 0 ? 1.12 : 0.9)));
      const rv = ns / s;
      transRef.current = { x: mx - (mx - x) * rv, y: my - (my - y) * rv, s: ns };
      applyT();
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const doneCount = nodes.filter(n => n.status !== "pending").length;
    if (!doneCount || !svgRef.current) return;
    if (doneCount === prevNodeCount.current) return;
    prevNodeCount.current = doneCount;
    _fitView(nodes, svgRef.current, transRef, applyT);
  }, [nodes]);

  return (
    <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
      <svg ref={svgRef} width="100%" height="100%" style={{ display: "block", background: "transparent" }}
        onMouseDown={e => { if (e.target.closest("[data-node-btn]")) return; dragRef.current = { active: true, ox: e.clientX - transRef.current.x, oy: e.clientY - transRef.current.y }; svgRef.current.style.cursor = "grabbing"; }}
        onMouseMove={e => { if (!dragRef.current.active) return; transRef.current.x = e.clientX - dragRef.current.ox; transRef.current.y = e.clientY - dragRef.current.oy; applyT(); }}
        onMouseUp={() => { dragRef.current.active = false; svgRef.current.style.cursor = "grab"; }}
        onMouseLeave={() => { dragRef.current.active = false; svgRef.current.style.cursor = "grab"; }}
      >
        <defs>
          <pattern id="kt3-dots" width="34" height="34" patternUnits="userSpaceOnUse">
            <circle cx="17" cy="17" r="0.7" fill="#ffffff" opacity="0.055" />
          </pattern>
          <radialGradient id="kt3-bg" cx="50%" cy="38%" r="65%">
            <stop offset="0%" stopColor="#0d0d1c" /><stop offset="100%" stopColor="#07070d" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#kt3-bg)" style={{ cursor: "grab" }} />
        <rect width="100%" height="100%" fill="url(#kt3-dots)" style={{ cursor: "grab" }} />
        <g ref={groupRef}>
          {edges.map(([a, b], i) => {
            const bc = LC(b.level);
            const active = b.status !== "pending";
            return <path key={i} d={_bezier(a.x + xOffset, a.y + NR(a.level) + yOffset, b.x + xOffset, b.y - NR(b.level) - 2 + yOffset)} fill="none" stroke={active ? bc.stroke : "#1e1e2e"} strokeWidth={active ? 1.5 : 0.8} strokeOpacity={active ? 0.38 : 0.2} strokeDasharray={active ? undefined : "6 4"} />;
          })}
          {nodes.map(n => <_TreeNodeSVG key={n.id} node={{ ...n, x: n.x + xOffset, y: n.y + yOffset }} selected={selectedNode?.id === n.id} assocSelected={assocNodeIds?.has(n.id) ?? false} onSelect={onNodeSelect} onExpand={onNodeExpand} themeColor={themeColor} />)}
        </g>
      </svg>
      <div style={{ position: "absolute", bottom: 16, left: 16, display: "flex", gap: 5 }}>
        {[{icon:"+",title:LANG[lang].zoomIn,fn:()=>{transRef.current.s=Math.min(6,transRef.current.s*1.32);applyT()}},{icon:"−",title:LANG[lang].zoomOut,fn:()=>{transRef.current.s=Math.max(0.08,transRef.current.s*0.76);applyT()}},{icon:"⊡",title:LANG[lang].fitView,fn:()=>{ if(svgRef.current) _fitView(nodes,svgRef.current,transRef,applyT) }}].map(b => (
          <button key={b.icon} title={b.title} onClick={b.fn} style={{ width:30, height:30, borderRadius:7, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.09)", color:"#556", fontSize: b.icon==="⊡"?14:18, lineHeight:"1", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(4px)" }} onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(255,255,255,0.2)"} onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(255,255,255,0.09)"}>{b.icon}</button>
        ))}
      </div>
    </div>
  );
}

// 辅助：计算适应视图
function _fitView(nodes, svgEl, transRef, applyT) {
  const active = nodes.filter(n => n.x !== 0);
  if (!active.length) return;
  const W = svgEl.clientWidth || 800, H = svgEl.clientHeight || 500;
  const minX = Math.min(...active.map(n => n.x)), maxX = Math.max(...active.map(n => n.x));
  const minY = Math.min(...active.map(n => n.y)), maxY = Math.max(...active.map(n => n.y));
  const tw = maxX - minX + 220, th = maxY - minY + 200;
  const s  = Math.min((W / tw) * 0.9, (H / th) * 0.85, 1.5);
  transRef.current = { x: (W - tw * s) / 2 - minX * s + 110 * s, y: (H - th * s) / 2 - minY * s + 65 * s, s };
  applyT();
}

// ══════════════════════════════════════════════════════════════════
// § 9  NodeDetail
// ══════════════════════════════════════════════════════════════════

function _NodeDetail({ node, allNodes, onSelect, themeColor, lang = "zh", onAutoRelation, autoRelationBusy, autoRelationResults, onViewPair }) {
  const containerRef = useRef(null)
  useGSAP(() => {
    gsap.from(containerRef.current, { x: 14, opacity: 0, duration: 0.26, ease: 'power2.out' })
  }, { scope: containerRef, dependencies: [node.id], revertOnUpdate: true })

  const tl = LANG[lang];
  const c = LC(node.level);
  const strokeOverride = node.level === 0 && themeColor ? themeColor : c.stroke;
  const parent = node.level > 0 ? allNodes.find(n => n.children.some(ch => ch.id === node.id)) : null;

  return (
    <div ref={containerRef} style={{ padding: 16 }}>
      <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, padding:"2px 10px", borderRadius:20, marginBottom:10, background:`${strokeOverride}18`, border:`1px solid ${strokeOverride}45`, color:c.text }}>
        <span style={{ width:5, height:5, borderRadius:"50%", background:strokeOverride, display:"inline-block" }} />
        {tl.levelNames[Math.min(node.level, 4)]}
        {node.relevance !== null && <span style={{ marginLeft:5, padding:"1px 6px", borderRadius:10, fontSize:10, background:node.relevance>=7?"#10b98122":"#f59e0b22", color:node.relevance>=7?"#6ee7b7":"#fcd34d", border:`1px solid ${node.relevance>=7?"#10b98140":"#f59e0b40"}` }}>{tl.relevance} {node.relevance}/10</span>}
      </div>
      <h2 style={{ fontSize:17, fontWeight:500, color:"#eeeeff", margin:"0 0 11px", lineHeight:1.35 }}>{node.label}</h2>
      {node.explanation ? (
        <div style={{ borderLeft:`2px solid ${strokeOverride}60`, paddingLeft:11, marginBottom:14 }}>
          <p style={{ fontSize:13, lineHeight:1.9, color:"#9090aa", margin:0 }}>{node.explanation}</p>
        </div>
      ) : <div style={{ fontSize:12, color:"#3a3a5a", marginBottom:14, fontStyle:"italic" }}>{tl.loadingText}</div>}
      {node.hasStrongRelations === false && (
        <div style={{ padding:"10px 12px", borderRadius:9, marginBottom:14, background:"rgba(99,102,241,0.07)", border:"1px solid rgba(99,102,241,0.22)", fontSize:12, color:"#7070aa", lineHeight:1.7 }}>
          <div style={{ fontWeight:500, color:"#9090cc", marginBottom:4 }}>{tl.noSubTitle}</div>
          {tl.noSubDesc}
        </div>
      )}
      {node.children.length > 0 && (
        <>
          <p style={{ fontSize:10, color:"#3a3a55", letterSpacing:"0.09em", margin:"0 0 6px", textTransform:"uppercase" }}>{tl.subconcepts}</p>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            {node.children.map(ch => {
              const cc = LC(ch.level);
              return (
                <button key={ch.id} onClick={() => ch.status === "done" && onSelect?.(ch)} style={{ textAlign:"left", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 11px", borderRadius:8, border:`1px solid ${cc.stroke}38`, background:`${cc.fill}dd`, color:cc.text, fontSize:13, cursor:ch.status==="done"?"pointer":"default", opacity:ch.status==="done"?1:0.45, fontFamily:"inherit", transition:"border-color .15s" }} onMouseEnter={e=>{ if(ch.status==="done") e.currentTarget.style.borderColor=`${cc.stroke}70` }} onMouseLeave={e=>{ e.currentTarget.style.borderColor=`${cc.stroke}38` }}>
                  <span>→ {ch.label}</span>
                  {ch.relevance !== null && <span style={{ fontSize:10, opacity:0.5 }}>R{ch.relevance}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
      {/* ── 外链 ── */}
      {node.status === "done" && (
        <div style={{ display:"flex", gap:6, marginTop:14, flexWrap:"wrap" }}>
          {tl.links.map(({ label, url, color }) => (
            <a
              key={label}
              href={url(node.label)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize:11, color, textDecoration:"none", padding:"3px 9px", borderRadius:6, border:`1px solid ${color}30`, background:`${color}0d`, transition:"all .15s", display:"inline-flex", alignItems:"center", gap:3 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = `${color}70`; e.currentTarget.style.background = `${color}1a` }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = `${color}30`; e.currentTarget.style.background = `${color}0d` }}
            >
              {label} ↗
            </a>
          ))}
        </div>
      )}

      {/* ── 自动关联 ── */}
      {node.status === "done" && (
        <div style={{ marginTop:14 }}>
          <button
            onClick={() => onAutoRelation?.(node)}
            disabled={autoRelationBusy}
            style={{ width:"100%", padding:"8px 0", borderRadius:8, border:"1px solid rgba(139,92,246,.35)", background:"transparent", color:"#c4b5fd", fontSize:12, cursor:autoRelationBusy?"not-allowed":"pointer", fontFamily:"inherit", opacity:autoRelationBusy?0.5:1, transition:"all .15s" }}
            onMouseEnter={e=>{ if(!autoRelationBusy) e.currentTarget.style.borderColor="rgba(139,92,246,.7)" }}
            onMouseLeave={e=>{ e.currentTarget.style.borderColor="rgba(139,92,246,.35)" }}
          >
            {autoRelationBusy ? tl.assoc.autoBusy : tl.assoc.autoBtn}
          </button>
          {autoRelationResults && (
            <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:5 }}>
              {autoRelationResults.length === 0
                ? <p style={{ fontSize:11, color:"#2a2a45", textAlign:"center", margin:"6px 0", fontStyle:"italic" }}>{tl.assoc.autoEmpty}</p>
                : autoRelationResults.map((r, i) => {
                    const sc = r.strength >= 8 ? "#10b981" : r.strength >= 6 ? "#f59e0b" : "#f43f5e";
                    return (
                      <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:8, border:`1px solid ${sc}30`, background:`${sc}09`, cursor:"pointer" }} onClick={() => onViewPair?.(node, r.label)}>
                        <span style={{ flex:1, fontSize:12, color:"#9090b0" }}>{r.label}</span>
                        <span style={{ fontSize:11, fontWeight:600, color:sc }}>{r.strength}</span>
                        <span style={{ fontSize:10, color:"#4a4a6a" }}>{tl.assoc.viewPair} →</span>
                      </div>
                    );
                  })
              }
            </div>
          )}
        </div>
      )}

      {parent && <button onClick={() => onSelect?.(parent)} style={{ display:"flex", alignItems:"center", gap:6, marginTop:13, fontSize:12, color:"#3a3a55", cursor:"pointer", background:"none", border:"none", padding:0, fontFamily:"inherit" }}>{tl.backTo(parent.label)}</button>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// § 10a  _AssocAnimation  —  关联分析动画覆盖层
// ══════════════════════════════════════════════════════════════════

function _AssocAnimation({ nodes, lang, onCancel }) {
  const overlayRef = useRef(null);
  const analyzingTextRef = useRef(null);
  const tl_l = LANG[lang].assoc;

  const n  = nodes.length;
  const cx = 140, cy = 140;
  const radius = n <= 2 ? 70 : n <= 3 ? 78 : 86;
  const positions = nodes.map((_, i) => ({
    x: cx + radius * Math.cos((i / n) * 2 * Math.PI - Math.PI / 2),
    y: cy + radius * Math.sin((i / n) * 2 * Math.PI - Math.PI / 2),
  }));

  useGSAP(() => {
    gsap.from(overlayRef.current, { opacity: 0, duration: 0.3 });
    positions.forEach((_, i) => {
      gsap.from(`#_aa_chip_${i}`, { scale: 0, opacity: 0, duration: 0.5, delay: i * 0.12, ease: 'back.out(1.8)', transformOrigin: 'center' });
    });
    gsap.to(analyzingTextRef.current, {
      opacity: 0.35, duration: 0.75, ease: 'sine.inOut', yoyo: true, repeat: -1,
    });
  }, { scope: overlayRef });

  return (
    <div ref={overlayRef} style={{ position:"fixed", inset:0, zIndex:2000, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.92)", backdropFilter:"blur(12px)", gap:28 }}>
      <svg width={280} height={280} viewBox="0 0 280 280" style={{ overflow:"visible" }}>
        {/* Outer slow-rotating ring */}
        <circle cx={cx} cy={cy} r={cx - 6} fill="none" stroke="rgba(139,92,246,0.1)" strokeWidth={1} strokeDasharray="7 5">
          <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur="12s" repeatCount="indefinite" />
        </circle>
        {/* Inner fast-rotating ring */}
        <circle cx={cx} cy={cy} r={cx - 22} fill="none" stroke="rgba(139,92,246,0.07)" strokeWidth={1} strokeDasharray="4 6">
          <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`-360 ${cx} ${cy}`} dur="7s" repeatCount="indefinite" />
        </circle>
        {/* Center pulse */}
        <circle cx={cx} cy={cy} r={26} fill="rgba(139,92,246,0.12)" stroke="#8b5cf6" strokeWidth={1.5} opacity={0.65}>
          <animate attributeName="r" values="24;34;24" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.65;0.2;0.65" dur="2s" repeatCount="indefinite" />
        </circle>
        <text x={cx} y={cy + 2} textAnchor="middle" dominantBaseline="central" fontSize={18} fill="#8b5cf6" opacity={0.75} fontFamily="sans-serif">⟷</text>
        {/* Connection lines between all pairs */}
        {positions.map((p, i) => positions.slice(i + 1).map((p2, j) => (
          <line key={`${i}-${j}`} x1={p.x} y1={p.y} x2={p2.x} y2={p2.y} stroke="#8b5cf6" strokeWidth={1.2} opacity={0.28} strokeDasharray="5 4">
            <animate attributeName="stroke-dashoffset" values="0;-18;0" dur={`${1.8 + i * 0.2}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.28;0.55;0.28" dur={`${1.6 + j * 0.25}s`} repeatCount="indefinite" />
          </line>
        )))}
        {/* Node chips */}
        {positions.map((pos, i) => {
          const node = nodes[i];
          const c = LC(node?.level ?? 0);
          const label = node?.label ?? "";
          const short = label.length > 5 ? label.slice(0, 5) + "…" : label;
          return (
            <g id={`_aa_chip_${i}`} key={i}>
              <circle cx={pos.x} cy={pos.y} r={26} fill={c.fill} stroke={c.stroke} strokeWidth={1.8} />
              <circle cx={pos.x} cy={pos.y} r={26} fill="none" stroke={c.stroke} strokeWidth={1} opacity={0.35}>
                <animate attributeName="r" values="26;36;26" dur={`${2.2 + i * 0.3}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.35;0;0.35" dur={`${2.2 + i * 0.3}s`} repeatCount="indefinite" />
              </circle>
              <text x={pos.x} y={pos.y + 1} textAnchor="middle" dominantBaseline="central" fontSize={11} fill={c.text} fontFamily="-apple-system,BlinkMacSystemFont,sans-serif" fontWeight="500">{short}</text>
            </g>
          );
        })}
      </svg>
      <div style={{ textAlign:"center", maxWidth:320 }}>
        <p ref={analyzingTextRef} style={{ fontSize:15, color:"#c4b5fd", margin:"0 0 10px", letterSpacing:"0.02em" }}>{tl_l.analyzing}</p>
        <p style={{ fontSize:12, color:"#4a4a6a", margin:0, lineHeight:1.7 }}>{nodes.map(nd => nd.label).join("  ×  ")}</p>
      </div>
      <button onClick={onCancel}
        style={{ padding:"9px 28px", borderRadius:10, border:"1px solid rgba(251,113,133,.4)", background:"rgba(251,113,133,.06)", color:"#fda4af", fontSize:13, cursor:"pointer", fontFamily:"inherit", transition:"all .15s" }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(251,113,133,.75)"; e.currentTarget.style.background = "rgba(251,113,133,.1)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(251,113,133,.4)";  e.currentTarget.style.background = "rgba(251,113,133,.06)"; }}
      >{tl_l.cancelBtn}</button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// § 10b  _AssocResultModal  —  关联分析结果弹窗
// ══════════════════════════════════════════════════════════════════

function _AssocResultModal({ nodes, result, lang, onClose, onExtract }) {
  const modalRef = useRef(null);
  const tl_l = LANG[lang].assoc;

  useGSAP(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } })
    tl.from(modalRef.current, { scale: 0.92, opacity: 0, y: 16, duration: 0.35, ease: 'back.out(1.5)' })
      .from('.kt3-result-card', { y: 14, opacity: 0, duration: 0.28, stagger: 0.065, immediateRender: false }, '-=0.1')
      .from('.kt3-strength-fill', { scaleX: 0, duration: 0.55, stagger: 0.065, transformOrigin: 'left center', immediateRender: false }, '<0.08')
  }, { scope: modalRef });

  const sc = (s) => s >= 8 ? "#10b981" : s >= 6 ? "#f59e0b" : s >= 4 ? "#f43f5e" : "#4a4a6a";

  return (
    <div style={{ position:"fixed", inset:0, zIndex:1500, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.78)", backdropFilter:"blur(6px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={modalRef} style={{ width:540, maxWidth:"94vw", maxHeight:"82vh", background:"#0c0c1a", border:"1px solid #1e1e32", borderRadius:16, overflow:"hidden", display:"flex", flexDirection:"column", boxShadow:"0 32px 80px rgba(0,0,0,0.85), 0 0 0 1px rgba(139,92,246,0.1)" }}>

        {/* Header */}
        <div style={{ padding:"14px 20px", borderBottom:"1px solid #12121e", display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
          <span style={{ fontSize:13, fontWeight:600, color:"#c4b5fd" }}>{tl_l.resultTitle}</span>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap", flex:1 }}>
            {nodes.map((nd, i) => {
              const c = LC(nd.level);
              return <span key={i} style={{ fontSize:11, padding:"2px 9px", borderRadius:10, border:`1px solid ${c.stroke}40`, background:`${c.fill}dd`, color:c.text }}>{nd.label}</span>;
            })}
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"#3a3a55", fontSize:18, cursor:"pointer", lineHeight:1 }}>×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex:1, overflowY:"auto", padding:"18px 20px", display:"flex", flexDirection:"column", gap:20 }}>

          {/* Pairwise relations */}
          {result.pairs?.length > 0 && (
            <div>
              <p style={{ fontSize:10, color:"#3a3a55", letterSpacing:".08em", textTransform:"uppercase", margin:"0 0 10px" }}>{tl_l.pairsTitle}</p>
              <div style={{ display:"flex", flexDirection:"column", gap:9 }}>
                {result.pairs.map((pair, i) => {
                  const c = sc(pair.strength);
                  return (
                    <div key={i} className="kt3-result-card" style={{ padding:"11px 14px", borderRadius:10, border:`1px solid ${c}28`, background:`${c}08` }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                        <span style={{ fontSize:12, color:"#9090b0", fontWeight:500 }}>{pair.from}</span>
                        <span style={{ fontSize:11, color:"#2a2a45" }}>⟷</span>
                        <span style={{ fontSize:12, color:"#9090b0", fontWeight:500 }}>{pair.to}</span>
                        <span style={{ marginLeft:"auto", fontSize:11, padding:"1px 8px", borderRadius:10, border:`1px solid ${c}40`, color:c, background:`${c}14` }}>{pair.relation}</span>
                        <span style={{ fontSize:13, fontWeight:600, color:c, width:20, textAlign:"right", flexShrink:0 }}>{pair.strength}</span>
                      </div>
                      <div style={{ height:3, background:"#14142a", borderRadius:2, overflow:"hidden", marginBottom:pair.reason ? 8 : 0 }}>
                        <div className="kt3-strength-fill" style={{ height:"100%", width:`${pair.strength * 10}%`, background:c, borderRadius:2 }} />
                      </div>
                      {pair.reason && <p style={{ fontSize:12, color:"#7070a0", lineHeight:1.7, margin:0 }}>{pair.reason}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Common themes */}
          {result.commonThemes?.length > 0 && (
            <div>
              <p style={{ fontSize:10, color:"#3a3a55", letterSpacing:".08em", textTransform:"uppercase", margin:"0 0 10px" }}>{tl_l.themesTitle}</p>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {result.commonThemes.map((theme, i) => (
                  <div key={i} className="kt3-result-card" style={{ padding:"11px 14px", borderRadius:10, border:"1px solid rgba(16,185,129,0.22)", background:"rgba(16,185,129,0.05)" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                      <span style={{ fontSize:13, color:"#6ee7b7", fontWeight:500 }}>✦ {theme.theme}</span>
                      {theme.nodes?.map((nd, j) => (
                        <span key={j} style={{ fontSize:10, padding:"1px 7px", borderRadius:8, border:"1px solid rgba(16,185,129,0.25)", color:"#6ee7b7", opacity:.6 }}>{nd}</span>
                      ))}
                    </div>
                    {theme.description && <p style={{ fontSize:12, color:"#6a8a78", lineHeight:1.65, margin:0 }}>{theme.description}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary */}
          {result.summary && (
            <div>
              <p style={{ fontSize:10, color:"#3a3a55", letterSpacing:".08em", textTransform:"uppercase", margin:"0 0 10px" }}>{tl_l.summaryTitle}</p>
              <p style={{ fontSize:13, color:"#8080a0", lineHeight:1.85, margin:0, borderLeft:"2px solid rgba(139,92,246,0.4)", paddingLeft:12 }}>{result.summary}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:"12px 20px", borderTop:"1px solid #12121e", display:"flex", alignItems:"center", justifyContent:"flex-end", gap:10, flexShrink:0 }}>
          <button onClick={onClose}
            style={{ padding:"8px 16px", borderRadius:8, border:"1px solid #1e1e2e", background:"transparent", color:"#4a4a6a", fontSize:12, cursor:"pointer", fontFamily:"inherit", transition:"border-color .15s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#2a2a4a"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#1e1e2e"}
          >{tl_l.close}</button>
          {(result.commonThemes?.length > 0 || result.pairs?.length > 0) && (
            <button onClick={onExtract}
              style={{ padding:"8px 20px", borderRadius:8, border:"1px solid rgba(245,158,11,.5)", background:"#1c0e00", color:"#fcd34d", fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"inherit", transition:"all .15s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(245,158,11,.9)"; e.currentTarget.style.background = "#221200"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(245,158,11,.5)"; e.currentTarget.style.background = "#1c0e00"; }}
            >{tl_l.extractBtn}</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// § 10c  _ExtractModal  —  提取树时的树数量管理
// ══════════════════════════════════════════════════════════════════

function _ExtractModal({ roots, maxTrees, lang, onPickAndExtract, onClearAndExtract, onCancel }) {
  const modalRef = useRef(null);
  const tl_l = LANG[lang].assoc;
  const isOverLimit = roots.length >= maxTrees;

  useGSAP(() => {
    gsap.from(modalRef.current, { scale: 0.92, opacity: 0, y: 12, duration: 0.28, ease: 'back.out(1.5)' });
  }, { scope: modalRef });

  return (
    <div style={{ position:"fixed", inset:0, zIndex:1600, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.78)", backdropFilter:"blur(6px)" }}>
      <div ref={modalRef} style={{ width:380, maxWidth:"90vw", background:"#0c0c1a", border:"1px solid #1e1e32", borderRadius:16, overflow:"hidden", boxShadow:"0 32px 80px rgba(0,0,0,0.85)" }}>
        <div style={{ padding:"16px 20px", borderBottom:"1px solid #12121e" }}>
          <p style={{ fontSize:13, fontWeight:600, color:"#d0d0e8", margin:0 }}>{isOverLimit ? tl_l.extractClearTitle : tl_l.extractPickTitle}</p>
          <p style={{ fontSize:12, color:"#4a4a6a", margin:"7px 0 0", lineHeight:1.65 }}>
            {isOverLimit ? tl_l.extractClearDesc(roots.length) : tl_l.extractPickDesc}
          </p>
        </div>

        {isOverLimit ? (
          <div style={{ padding:"16px 20px", display:"flex", gap:10, justifyContent:"flex-end" }}>
            <button onClick={onCancel}
              style={{ padding:"8px 16px", borderRadius:8, border:"1px solid #1e1e2e", background:"transparent", color:"#4a4a6a", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
              {tl_l.extractCancel}
            </button>
            <button onClick={onClearAndExtract}
              style={{ padding:"8px 20px", borderRadius:8, border:"1px solid rgba(251,113,133,.5)", background:"rgba(251,113,133,.06)", color:"#fda4af", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
              {tl_l.extractClearConfirm}
            </button>
          </div>
        ) : (
          <div style={{ padding:"12px 20px 18px", display:"flex", flexDirection:"column", gap:6 }}>
            {roots.map(r => (
              <button key={r.id} onClick={() => onPickAndExtract(r.id)}
                style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:10, border:"1px solid #1e1e2e", background:"transparent", cursor:"pointer", fontFamily:"inherit", color:"#9090b0", fontSize:13, textAlign:"left", transition:"all .15s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(244,63,94,.4)"; e.currentTarget.style.color = "#fda4af"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e1e2e"; e.currentTarget.style.color = "#9090b0"; }}
              >
                <span style={{ width:8, height:8, borderRadius:"50%", background:r.color, flexShrink:0, display:"inline-block" }} />
                <span style={{ flex:1 }}>{r.concept}</span>
                <span style={{ fontSize:11, color:"#3a3a55" }}>移除 →</span>
              </button>
            ))}
            <button onClick={onCancel}
              style={{ padding:"8px 0", borderRadius:8, border:"none", background:"transparent", color:"#3a3a55", fontSize:12, cursor:"pointer", fontFamily:"inherit", marginTop:4 }}>
              {tl_l.extractCancel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// § 10 KnowledgeTreeWidget  —  完整组件（多树版）
// ══════════════════════════════════════════════════════════════════

const _CSS = `
  @keyframes kt3-fadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
  @keyframes kt3-pulse  { 0%,100%{opacity:.6} 50%{opacity:1} }
  .kt3-input{flex:1;padding:9px 14px;border-radius:8px;border:1px solid #1e1e2e;background:#0d0d18;color:#d0d0e8;font-size:14px;outline:none;font-family:inherit;transition:border-color .2s}
  .kt3-input:focus{border-color:#3a3a5a}
  .kt3-input:disabled{opacity:.45}
  .kt3-input::placeholder{color:#2a2a45}
  .kt3-btn{display:flex;align-items:center;gap:6px;padding:9px 18px;border-radius:8px;border:1px solid #2a2a3e;background:#0e0e1c;color:#9090b8;font-size:14px;cursor:pointer;white-space:nowrap;font-family:inherit;transition:border-color .18s,background .18s}
  .kt3-btn:hover:not(:disabled){border-color:#4a4a6e;background:#12122a}
  .kt3-btn:disabled{opacity:.4;cursor:not-allowed}
  .kt3-btn-primary{border-color:#f59e0b60;background:#1c0e00;color:#fcd34d;font-weight:500}
  .kt3-btn-primary:hover:not(:disabled){border-color:#f59e0b;background:#221100}
  .kt3-btn-danger{border-color:rgba(244,63,94,.35);background:transparent;color:#fda4af}
  .kt3-btn-danger:hover:not(:disabled){border-color:rgba(244,63,94,.7);background:rgba(244,63,94,.06)}
  .kt3-depth{padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;border:1px solid #1a1a2e;background:transparent;color:#444460;font-family:inherit;transition:all .15s}
  .kt3-depth:hover{color:#7070aa;border-color:#2a2a4a}
  .kt3-depth.on{border-color:#f59e0b60;background:#1c0e00;color:#fcd34d}
  .kt3-root-tab{display:flex;align-items:center;gap:6px;padding:5px 11px;border-radius:8px;border:1px solid transparent;background:transparent;color:#4a4a6a;font-size:12px;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}
  .kt3-root-tab:hover{background:rgba(255,255,255,0.03);border-color:#1e1e2e}
  .kt3-root-tab.active{background:rgba(255,255,255,0.05);border-color:#2a2a3e;color:#d0d0e8}
  .kt3-root-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
  .kt3-cross-btn{padding:7px 14px;border-radius:8px;border:1px solid rgba(139,92,246,.35);background:transparent;color:#c4b5fd;font-size:12px;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}
  .kt3-cross-btn:hover:not(:disabled){border-color:rgba(139,92,246,.7);background:rgba(139,92,246,.07)}
  .kt3-cross-btn:disabled{opacity:.4;cursor:not-allowed}
  .kt3-assoc-btn{padding:7px 14px;border-radius:8px;border:1px solid rgba(251,113,133,.35);background:transparent;color:#fda4af;font-size:12px;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}
  .kt3-assoc-btn:hover:not(:disabled){border-color:rgba(251,113,133,.7);background:rgba(251,113,133,.07)}
  .kt3-assoc-btn.active{border-color:rgba(251,113,133,.8);background:rgba(251,113,133,.12);color:#fda4af}
  .kt3-assoc-banner{padding:5px 16px;background:rgba(251,113,133,.06);border-bottom:1px solid rgba(251,113,133,.18);display:flex;align-items:center;gap:10px;font-size:12px;color:#fda4af;flex-shrink:0}
  ::-webkit-scrollbar{width:4px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:#1e1e2e;border-radius:2px}
  .kt3-input{font-size:16px!important}
  @media(max-width:767px){
    .kt3-topbar{padding:6px 12px!important;gap:8px!important}
    .kt3-topbar-tagline{display:none!important}
    .kt3-topbar-right{gap:6px!important}
    .kt3-searchbar{flex-wrap:wrap!important;padding:6px 12px!important;gap:6px!important}
    .kt3-searchbar-row2{display:flex;align-items:center;gap:6px;flex-wrap:wrap;width:100%}
    .kt3-depth{padding:8px 14px!important;min-height:40px;font-size:13px!important}
    .kt3-btn{padding:8px 14px!important;min-height:40px;font-size:13px!important}
    .kt3-cross-btn,.kt3-assoc-btn{padding:8px 12px!important;min-height:40px;font-size:12px!important}
    .kt3-bottom-sheet{position:fixed;left:0;right:0;bottom:0;z-index:500;background:#09090f;border-top:1px solid #10101a;border-radius:16px 16px 0 0;max-height:65vh;display:flex;flex-direction:column;box-shadow:0 -8px 40px rgba(0,0,0,.7);transform:translateY(105%);transition:transform .32s cubic-bezier(.32,.72,0,1);will-change:transform}
    .kt3-bottom-sheet.open{transform:translateY(0)}
    .kt3-bottom-sheet-handle{width:40px;height:4px;background:#2a2a40;border-radius:2px;margin:10px auto 4px;flex-shrink:0;cursor:pointer}
    .kt3-bottom-sheet-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}
  }
`;

// ── _LogLine: single log entry with mount animation ───────────────

function _LogLine({ text }) {
  const lineRef = useRef(null)
  useGSAP(() => {
    gsap.from(lineRef.current, { y: 6, opacity: 0, duration: 0.18, ease: 'power1.out' })
  }, { scope: lineRef })
  return (
    <p ref={lineRef} style={{ fontSize:11, color:"#303050", margin:"0 0 2px", lineHeight:1.6, fontFamily:"'SF Mono','Fira Code',monospace" }}>{text}</p>
  )
}

// ── _RootTab: root tab button with pop-in animation ───────────────

function _RootTab({ root, active, onSelect, onRemove }) {
  const tabRef = useRef(null)
  useGSAP(() => {
    gsap.from(tabRef.current, { scale: 0.72, opacity: 0, duration: 0.38, ease: 'back.out(2.4)' })
  }, { scope: tabRef })

  return (
    <div ref={tabRef} style={{ display:"flex", alignItems:"center" }}>
      <button className={`kt3-root-tab${active ? " active" : ""}`} onClick={() => onSelect(root.id)}>
        <span className="kt3-root-dot" style={{ background:root.color, boxShadow:root.busy?`0 0 6px ${root.color}`:undefined, animation:root.busy?"kt3-pulse 1s infinite":undefined }} />
        <span>{root.concept}</span>
        {root.busy && <span style={{ fontSize:10, color:root.color, opacity:.7 }}>…</span>}
      </button>
      <button onClick={() => onRemove(root.id)} title="移除此树" style={{ width:16, height:16, borderRadius:"50%", background:"transparent", border:"none", color:"#2a2a40", cursor:"pointer", fontSize:11, display:"flex", alignItems:"center", justifyContent:"center", marginLeft:-2, transition:"color .15s" }} onMouseEnter={e=>e.currentTarget.style.color="#f87171"} onMouseLeave={e=>e.currentTarget.style.color="#2a2a40"}>×</button>
    </div>
  )
}

// ── _AssocChip: single selected node chip with pop-in ─────────────

function _AssocChip({ node, onRemove }) {
  const chipRef = useRef(null)
  useGSAP(() => {
    gsap.from(chipRef.current, { scale: 0.5, opacity: 0, duration: 0.28, ease: 'back.out(2.2)' })
  }, { scope: chipRef })
  const c = LC(node.level)
  return (
    <span ref={chipRef} style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:12, border:`1px solid ${c.stroke}50`, background:`${c.fill}ee`, color:c.text, fontSize:12 }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:c.stroke, display:"inline-block", opacity:.7 }} />
      {node.label}
      <button onClick={onRemove}
        style={{ background:"none", border:"none", color:"inherit", opacity:.55, cursor:"pointer", padding:0, fontSize:15, lineHeight:1, marginLeft:1 }}>×</button>
    </span>
  )
}

// ── _AssocBanner: assoc mode banner with slide-down entrance ──────

function _AssocBanner({ assocNodes, lang, onStart, onClear, onRemoveNode }) {
  const bannerRef = useRef(null)
  const tl_l = LANG[lang].assoc
  useGSAP(() => {
    gsap.from(bannerRef.current, { y: -40, opacity: 0, duration: 0.3, ease: 'power2.out' })
  }, { scope: bannerRef })
  return (
    <div ref={bannerRef} style={{ padding:"8px 16px", background:"rgba(139,92,246,0.05)", borderBottom:"1px solid rgba(139,92,246,0.15)", display:"flex", flexDirection:"column", gap:8, flexShrink:0 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        <span style={{ fontSize:12, color:"#8080a0", flex:1 }}>
          {assocNodes.length < 2 ? tl_l.pickNode : tl_l.selectedLabel(assocNodes.length, 4)}
        </span>
        {assocNodes.length >= 2 && (
          <button onClick={onStart}
            style={{ padding:"5px 16px", borderRadius:8, border:"1px solid rgba(139,92,246,.55)", background:"rgba(139,92,246,.1)", color:"#c4b5fd", fontSize:12, cursor:"pointer", fontFamily:"inherit", transition:"all .15s", fontWeight:500 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor="rgba(139,92,246,.9)"; e.currentTarget.style.background="rgba(139,92,246,.18)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor="rgba(139,92,246,.55)"; e.currentTarget.style.background="rgba(139,92,246,.1)"; }}>
            {tl_l.analyzeBtn}
          </button>
        )}
        {assocNodes.length > 0 && (
          <button onClick={onClear}
            style={{ padding:"5px 10px", borderRadius:8, border:"1px solid #1e1e2e", background:"transparent", color:"#3a3a55", fontSize:11, cursor:"pointer", fontFamily:"inherit", transition:"border-color .15s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor="#2a2a4a"}
            onMouseLeave={e => e.currentTarget.style.borderColor="#1e1e2e"}>
            {tl_l.clearSelection}
          </button>
        )}
      </div>
      {assocNodes.length > 0 && (
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          {assocNodes.map(nd => (
            <_AssocChip key={nd.id} node={nd} onRemove={() => onRemoveNode(nd.id)} />
          ))}
          {assocNodes.length < 4 && (
            <span style={{ fontSize:11, color:"#1e1e30", fontStyle:"italic" }}>+{4 - assocNodes.length}</span>
          )}
        </div>
      )}
    </div>
  )
}

// ── _RightPanelEmpty: floating icon when no node selected ─────────

function _RightPanelEmpty({ lang }) {
  const iconRef = useRef(null)
  const tl_l = LANG[lang]
  useGSAP(() => {
    gsap.to(iconRef.current, { y: -7, duration: 1.8, ease: 'sine.inOut', yoyo: true, repeat: -1 })
  }, { scope: iconRef })

  return (
    <div style={{ height:"100%", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, opacity:0.18, userSelect:"none", padding:24 }}>
      <div ref={iconRef}>
        <svg viewBox="0 0 24 24" width={36} height={36} fill="none" stroke="#aaa" strokeWidth="1.3"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      </div>
      <p style={{ fontSize:12, color:"#888", textAlign:"center", lineHeight:1.8, margin:0 }}>
        {tl_l.nodeHint[0]}<br />{tl_l.nodeHint[1]}<br />{tl_l.nodeHint[2]}
      </p>
    </div>
  )
}

// ── _SettingsModal: preferences modal with GSAP entrance ──────────

function _SettingsModal({ lang, draftPrefs, setDraftPrefs, prefsSaved, onSave, onClose }) {
  const modalRef = useRef(null)
  const tl_l = LANG[lang]
  useGSAP(() => {
    gsap.from(modalRef.current, { scale: 0.9, opacity: 0, y: 12, duration: 0.32, ease: 'back.out(1.7)' })
  }, { scope: modalRef })

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:1100, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={modalRef} style={{ background:"#0c0c1a", border:"1px solid #1e1e2e", borderRadius:16, padding:"28px 30px", width:440, maxWidth:"92vw", boxShadow:"0 32px 80px rgba(0,0,0,0.8)" }}>
        <div style={{ fontSize:15, fontWeight:600, color:"#d0d0e8", marginBottom:22 }}>{tl_l.settings.title}</div>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, color:"#4a4a6a", letterSpacing:".06em", textTransform:"uppercase", marginBottom:10 }}>{tl_l.settings.style}</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {Object.entries(tl_l.settings.styleOpts).map(([k, v]) => (
              <button key={k} onClick={() => setDraftPrefs(p => ({ ...p, style: k }))}
                style={{ padding:"10px 14px", borderRadius:9, border:`1px solid ${draftPrefs.style === k ? "rgba(245,158,11,.6)" : "rgba(255,255,255,0.07)"}`, background:draftPrefs.style === k ? "#1c0e00" : "#080810", color:draftPrefs.style === k ? "#fcd34d" : "#6a6a8a", fontSize:13, cursor:"pointer", textAlign:"left", fontFamily:"inherit", transition:"all .15s" }}>
                <div style={{ fontWeight:500, marginBottom:2 }}>{v}</div>
                <div style={{ fontSize:10, opacity:0.55 }}>{tl_l.settings.styleDescs[k]}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, color:"#4a4a6a", letterSpacing:".06em", textTransform:"uppercase", marginBottom:8 }}>{tl_l.settings.background}</div>
          <input value={draftPrefs.background} onChange={e => setDraftPrefs(p => ({ ...p, background: e.target.value }))} maxLength={200}
            placeholder={tl_l.settings.bgPh}
            style={{ width:"100%", padding:"9px 13px", background:"#080810", border:"1px solid rgba(255,255,255,0.08)", borderRadius:9, color:"#d0d0e8", fontSize:13, outline:"none", fontFamily:"inherit", boxSizing:"border-box", transition:"border-color .2s" }}
            onFocus={e => e.target.style.borderColor = "rgba(255,255,255,0.22)"}
            onBlur={e  => e.target.style.borderColor = "rgba(255,255,255,0.08)"} />
        </div>
        <div style={{ marginBottom:26 }}>
          <div style={{ fontSize:11, color:"#4a4a6a", letterSpacing:".06em", textTransform:"uppercase", marginBottom:8 }}>{tl_l.settings.llmLang}</div>
          <div style={{ display:"flex", gap:8 }}>
            {Object.entries(tl_l.settings.langOpts).map(([k, v]) => (
              <button key={k} onClick={() => setDraftPrefs(p => ({ ...p, llmLang: k }))}
                style={{ padding:"7px 16px", borderRadius:8, border:`1px solid ${draftPrefs.llmLang === k ? "rgba(139,92,246,.6)" : "rgba(255,255,255,0.07)"}`, background:draftPrefs.llmLang === k ? "#100020" : "#080810", color:draftPrefs.llmLang === k ? "#c4b5fd" : "#6a6a8a", fontSize:12, cursor:"pointer", fontFamily:"inherit", transition:"all .15s" }}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
          <button onClick={onClose}
            style={{ padding:"8px 18px", borderRadius:8, border:"1px solid #1e1e2e", background:"transparent", color:"#4a4a6a", fontSize:13, cursor:"pointer", fontFamily:"inherit", transition:"all .15s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#2a2a4a"} onMouseLeave={e => e.currentTarget.style.borderColor = "#1e1e2e"}>
            {tl_l.settings.cancel}
          </button>
          <button onClick={onSave}
            style={{ padding:"8px 22px", borderRadius:8, border:`1px solid ${prefsSaved ? "rgba(16,185,129,.5)" : "rgba(245,158,11,.5)"}`, background:prefsSaved ? "#001a10" : "#1c0e00", color:prefsSaved ? "#6ee7b7" : "#fcd34d", fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:"inherit", transition:"all .25s" }}>
            {prefsSaved ? tl_l.settings.saved : tl_l.settings.save}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function KnowledgeTreeWidget({ apiKey, agentConfig = {}, CanvasComponent }) {
  const wrapRef      = useRef(null)
  const topbarRef    = useRef(null)
  const searchbarRef = useRef(null)
  const sidePanelRef = useRef(null)

  const isMobileRef = useRef(typeof window !== 'undefined' && window.innerWidth < 768)

  useGSAP(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } })
    tl.from(topbarRef.current,    { y: -32, opacity: 0, duration: 0.48 })
      .from(searchbarRef.current, { y: -14, opacity: 0, duration: 0.38 }, '-=0.24')
    if (sidePanelRef.current) {
      tl.from(sidePanelRef.current,
        isMobileRef.current ? { y: 100, opacity: 0, duration: 0.45 }
                            : { x: 30,  opacity: 0, duration: 0.45 },
        '-=0.28')
    }
  }, { scope: wrapRef })

  const [query, setQuery]       = useState("");
  const [depth, setDepth]           = useState(1);
  const [soundOn, setSoundOn]       = useState(true);
  const [username, setUsername]     = useState("");
  const [maxTrees, setMaxTrees]     = useState(4);
  const [lang, setLang]             = useState(() => {
    try { return localStorage.getItem("kt-lang") || "zh"; } catch { return "zh"; }
  });
  const _defPrefs = { style: "feynman", background: "", llmLang: "auto" };
  const [prefs, setPrefs]           = useState(_defPrefs);
  const [draftPrefs, setDraftPrefs] = useState(_defPrefs);
  const [showSettings, setShowSettings] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const logRef = useRef(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);

  // ── 关联模式状态（新版：多节点，最多4个）────────────────────────
  const [assocMode, setAssocMode]           = useState(false);
  const [assocNodes, setAssocNodes]         = useState([]);      // 已选节点数组，最多4个
  const [assocAnalyzing, setAssocAnalyzing] = useState(false);   // 分析进行中
  const assocAbortRef                       = useRef(false);     // 取消标志
  const [assocResult, setAssocResult]       = useState(null);    // {pairs, commonThemes, summary}
  const [showAssocResult, setShowAssocResult] = useState(false); // 结果弹窗
  const [extractData, setExtractData]       = useState(null);    // {tree, concept} 待提取
  const [showExtractModal, setShowExtractModal] = useState(false);
  const [autoAssocBusy, setAutoAssocBusy]   = useState(false);
  const [autoAssocResults, setAutoAssocResults] = useState(null);

  const toggleLang = () => {
    const next = lang === "zh" ? "en" : "zh";
    setLang(next);
    try { localStorage.setItem("kt-lang", next); } catch {}
  };

  const tl = LANG[lang];
  const cfg = { ...(apiKey ? { apiKey } : {}), ...agentConfig, maxLevel: depth, prefs, lang };

  const {
    roots, crossEdges, crossBusy, anyBusy,
    selectedNode, setSelectedNode,
    selectedRootId, setSelectedRootId,
    addRoot, addPrebuiltRoot, clearAndAdd, removeRoot, clearAll, cancelSearch, expand, findCrossRelations,
    maxRootsReached,
  } = useMultiRoots(cfg, lang, maxTrees);

  // 获取当前用户名、偏好设置 & 系统配置
  useEffect(() => {
    fetch("/api/me").then(r => r.json()).then(d => {
      setUsername(d.username || "");
      if (d.preferences) { setPrefs(d.preferences); setDraftPrefs(d.preferences); }
    }).catch(() => {});
    fetch("/api/config").then(r => r.json()).then(d => {
      if (d.maxTrees) setMaxTrees(d.maxTrees);
    }).catch(() => {});
  }, []);

  const savePrefs = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftPrefs),
      });
      if (res.ok) {
        setPrefs(draftPrefs);
        setPrefsSaved(true);
        setTimeout(() => setPrefsSaved(false), 2000);
      }
    } catch {}
  }, [draftPrefs]);

  // 音效 + 背景音乐联动
  const prevRoots = useRef([]);
  useEffect(() => {
    SoundSystem.setEnabled(soundOn);
    if (!soundOn) { SoundSystem.stopAmbient(); return; }

    // Start ambient when first tree is added
    if (roots.length > 0 && !SoundSystem._ambientNodes) SoundSystem.startAmbient();
    // Stop ambient when all trees cleared
    if (roots.length === 0) SoundSystem.stopAmbient();

    const prev = prevRoots.current;
    roots.forEach(r => {
      const wasR = prev.find(p => p.id === r.id);
      // Tree just completed
      if (wasR?.busy && !r.busy && r.nodes.some(n => n.status === "done")) {
        SoundSystem.play("tree:complete");
      }
      // Node count increased (new nodes appeared)
      else if (wasR && r.nodes.length > wasR.nodes.length) {
        SoundSystem.play("node:done");
      }
    });
    // New root added
    if (roots.length > prev.length) SoundSystem.play("add-root");

    prevRoots.current = roots;
  }, [roots, soundOn]);

  const selectedRoot = roots.find(r => r.id === selectedRootId) || roots[roots.length - 1];
  const allNodes     = roots.flatMap(r => r.nodes);

  const activeLog = selectedRoot?.log || [];
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = 9999; }, [activeLog]);

  useEffect(() => {
    const handler = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      isMobileRef.current = mobile;
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    if (isMobile && selectedNode) setBottomSheetOpen(true);
  }, [selectedNode, isMobile]);

  const doAddRoot = () => {
    if (!query.trim() || anyBusy || roots.length >= maxTrees) return;
    SoundSystem.setEnabled(soundOn);
    if (soundOn && !SoundSystem._ambientNodes) SoundSystem.startAmbient();
    addRoot(query);
    setQuery("");
  };

  const doCancel = () => {
    SoundSystem.play("cancel");
    cancelSearch();
  };

  const doClearAll = () => {
    SoundSystem.play("clear");
    SoundSystem.stopAmbient();
    clearAll();
  };

  const doCrossRelations = () => {
    SoundSystem.play("cross-found");
    findCrossRelations();
  };

  const doExpand = (nodeId) => {
    if (!selectedRoot) return;
    SoundSystem.play("expand");
    expand(nodeId, selectedRoot.id);
  };

  // ── 关联模式逻辑（新版）────────────────────────────────────────
  const toggleAssocMode = () => {
    setAssocMode(v => !v);
    setAssocNodes([]);
    setAssocResult(null);
    setShowAssocResult(false);
    setAutoAssocResults(null);
  };

  // 点击节点：切换是否加入关联选择（最多 4 个）
  const handleAssocNodeClick = (node) => {
    if (!assocMode || node.status !== "done" || assocAnalyzing) return;
    setAssocNodes(prev => {
      const exists = prev.find(n => n.id === node.id);
      if (exists) return prev.filter(n => n.id !== node.id);
      if (prev.length >= 4) return prev;
      return [...prev, node];
    });
  };

  // 启动关联分析
  const startAssocAnalysis = async () => {
    if (assocNodes.length < 2 || assocAnalyzing) return;
    assocAbortRef.current = false;
    setAssocAnalyzing(true);
    setAssocResult(null);
    setShowAssocResult(false);
    try {
      const res = await fetch("/api/association", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes: assocNodes.map(n => n.label) }),
      });
      if (assocAbortRef.current) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAssocResult(data);
      setShowAssocResult(true);
    } catch (err) {
      console.error("关联分析失败:", err.message);
    }
    setAssocAnalyzing(false);
  };

  // 取消分析
  const cancelAssocAnalysis = () => {
    assocAbortRef.current = true;
    setAssocAnalyzing(false);
  };

  // 构建关联提取树（以 commonThemes 作 L1，回退到 pairs）
  const _buildAssocTree = () => {
    const rootLabel = assocNodes.length === 2
      ? `${assocNodes[0].label} & ${assocNodes[1].label}`
      : assocNodes.map(n => n.label).join(" & ");
    const root = mkNode(rootLabel, 0);
    root.explanation = assocResult?.summary || "";
    root.status = "done";
    const themes = assocResult?.commonThemes ?? [];
    const pairs  = (assocResult?.pairs ?? []).filter(p => p.strength >= 5);
    root.hasStrongRelations = themes.length > 0 || pairs.length > 0;
    if (themes.length > 0) {
      themes.forEach(theme => {
        const child = mkNode(theme.theme, 1);
        child.explanation = theme.description || "";
        child.status = "done";
        child.hasStrongRelations = false;
        child._parentLabel = rootLabel;
        root.children.push(child);
      });
    } else {
      pairs.forEach(pair => {
        const child = mkNode(`${pair.from} ↔ ${pair.to}`, 1);
        child.explanation = pair.reason || "";
        child.status = "done";
        child.hasStrongRelations = false;
        child._parentLabel = rootLabel;
        root.children.push(child);
      });
    }
    return root;
  };

  // 提取为新树入口
  const handleExtractToTree = () => {
    if (!assocResult) return;
    setShowAssocResult(false);
    const tree    = _buildAssocTree();
    const concept = assocNodes.map(n => n.label).join(" & ");
    if (roots.length >= maxTrees) {
      setExtractData({ tree, concept });
      setShowExtractModal(true);
    } else {
      addPrebuiltRoot(tree, concept);
      setAssocMode(false);
      setAssocNodes([]);
      setAssocResult(null);
    }
  };

  const _finishExtract = () => {
    setShowExtractModal(false);
    setAssocMode(false);
    setAssocNodes([]);
    setAssocResult(null);
    setExtractData(null);
  };

  const confirmClearAndExtract = () => {
    if (!extractData) return;
    clearAndAdd(extractData.tree, extractData.concept);
    _finishExtract();
  };

  const confirmPickAndExtract = (rootIdToRemove) => {
    if (!extractData) return;
    removeRoot(rootIdToRemove);
    // Add after the remove renders
    setTimeout(() => addPrebuiltRoot(extractData.tree, extractData.concept), 30);
    _finishExtract();
  };

  // Auto-find: given selected node, rank all other done nodes
  const handleAutoRelation = async (pivotNode) => {
    const candidates = allNodes
      .filter(n => n.status === "done" && n.id !== pivotNode.id)
      .map(n => n.label);
    if (!candidates.length) { setAutoAssocResults([]); return; }
    setAutoAssocBusy(true);
    setAutoAssocResults(null);
    try {
      const res = await fetch("/api/auto-relations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pivot: pivotNode.label, candidates }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAutoAssocResults(data.relations ?? []);
    } catch (err) {
      console.error("自动关联失败:", err.message);
      setAutoAssocResults([]);
    }
    setAutoAssocBusy(false);
  };

  // "查看节点对": quick-enter assoc mode and pre-select two nodes
  const handleViewPair = (pivotNode, labelB) => {
    const nodeB = allNodes.find(n => n.label === labelB && n.status === "done");
    if (!nodeB) return;
    setAssocMode(true);
    setAssocNodes([pivotNode, nodeB]);
  };

  // 计算所有节点（含偏移量）供多树画布使用
  // 每棵树水平偏移，竖向对齐
  const TREE_H_OFFSET = 1200;
  const multiNodes = useMemo(() => roots.flatMap((r, i) =>
    r.nodes.map(n => ({ ...n, _rootId: r.id, _xOffset: i * TREE_H_OFFSET, _color: r.color }))
  ), [roots]);

  const multiEdges = useMemo(() => roots.flatMap((r, i) =>
    r.edges.map(([a, b]) => [{ ...a, x: a.x + i * TREE_H_OFFSET }, { ...b, x: b.x + i * TREE_H_OFFSET }])
  ), [roots]);

  return (
    <>
      <style>{_CSS}</style>
      <div ref={wrapRef} style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden", background:"#07070d", fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif", color:"#b0b0cc" }}>

        {/* ── 顶栏 ─────────────────────────────── */}
        <div ref={topbarRef} className="kt3-topbar" style={{ padding:"8px 20px", background:"rgba(10,10,18,0.95)", borderBottom:"1px solid #12121e", display:"flex", alignItems:"center", gap:12, flexShrink:0, backdropFilter:"blur(12px)" }}>
          <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="#f59e0b" strokeWidth="1.6">
            <circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="2.5"/><circle cx="12" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/>
            <line x1="12" y1="8" x2="5" y2="16.5"/><line x1="12" y1="8" x2="12" y2="16.5"/><line x1="12" y1="8" x2="19" y2="16.5"/>
          </svg>
          <span style={{ fontSize:14, fontWeight:500, color:"#d0d0e8" }}>{tl.appName}</span>
          <span className="kt3-topbar-tagline" style={{ fontSize:11, color:"#282838" }}>{tl.tagline}</span>

          <div className="kt3-topbar-right" style={{ marginLeft:"auto", display:"flex", gap:10, alignItems:"center" }}>
            {/* 语言切换 / Language toggle */}
            <button onClick={toggleLang} title={lang === "zh" ? "Switch to English" : "切换中文"} style={{ padding:"4px 10px", borderRadius:6, fontSize:12, cursor:"pointer", border:"1px solid #2a2a3e", background:"transparent", color:"#6060a0", fontFamily:"inherit", transition:"all .15s", letterSpacing:".04em" }}
              onMouseEnter={e=>{ e.currentTarget.style.borderColor="#4a4a6e"; e.currentTarget.style.color="#9090c8"; }} onMouseLeave={e=>{ e.currentTarget.style.borderColor="#2a2a3e"; e.currentTarget.style.color="#6060a0"; }}>
              {lang === "zh" ? "EN" : "中文"}
            </button>
            {/* 音效开关 */}
            <button onClick={() => { setSoundOn(v => !v); SoundSystem.setEnabled(!soundOn); }} title={soundOn ? tl.sound.titleOn : tl.sound.titleOff} style={{ padding:"4px 10px", borderRadius:6, fontSize:12, cursor:"pointer", border:`1px solid ${soundOn?"rgba(245,158,11,.3)":"#1a1a2e"}`, background:"transparent", color:soundOn?"#fcd34d":"#444460", fontFamily:"inherit", transition:"all .15s" }}>
              {soundOn ? tl.sound.on : tl.sound.off}
            </button>
            {/* 偏好设置 */}
            <button onClick={() => { setDraftPrefs(prefs); setShowSettings(true); setPrefsSaved(false); }} title={tl.settings.title} style={{ padding:"4px 10px", borderRadius:6, fontSize:12, cursor:"pointer", border:"1px solid #1e1e2e", background:"transparent", color:"#4a4a6a", fontFamily:"inherit", transition:"all .15s" }}
              onMouseEnter={e=>{ e.currentTarget.style.borderColor="#3a3a5a"; e.currentTarget.style.color="#8080a8"; }} onMouseLeave={e=>{ e.currentTarget.style.borderColor="#1e1e2e"; e.currentTarget.style.color="#4a4a6a"; }}>
              ⚙
            </button>
            {/* 用户信息 */}
            {username && (
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                {!isMobile && <span style={{ fontSize:11, color:"#2a2838", padding:"3px 10px", borderRadius:6, border:"1px solid #1a1a2e", background:"transparent" }}>@{username}</span>}
                {username === "admin" && <a href="/admin" style={{ fontSize:11, color:"#8b5cf6", textDecoration:"none", padding:"3px 10px", border:"1px solid rgba(139,92,246,.25)", borderRadius:6, transition:"all .15s" }} onMouseEnter={e=>e.target.style.borderColor="rgba(139,92,246,.6)"} onMouseLeave={e=>e.target.style.borderColor="rgba(139,92,246,.25)"}>{tl.admin}</a>}
                <form method="POST" action="/logout" style={{ display:"inline" }}>
                  <button type="submit" style={{ fontSize:11, color:"#3a3a55", padding:"3px 10px", border:"1px solid #1a1a2e", borderRadius:6, background:"transparent", cursor:"pointer", fontFamily:"inherit" }}>{tl.logout}</button>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* ── 搜索栏 ───────────────────────────── */}
        <div ref={searchbarRef} className="kt3-searchbar" style={{ padding:"8px 20px", background:"rgba(9,9,15,0.9)", borderBottom:"1px solid #10101a", display:"flex", gap:10, alignItems:"center", flexShrink:0 }}>
          <input className="kt3-input" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!anyBusy&&doAddRoot()} disabled={roots.length>=maxTrees} placeholder={roots.length>=maxTrees ? tl.input.maxReached : anyBusy ? tl.input.busy : tl.input.default} />

          <div className="kt3-searchbar-row2" style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
            {/* 深度 / Depth — 仅 L1 */}
            <span style={{ fontSize:11, color:"#282838", marginRight:2 }}>{tl.depth}</span>
            {[1].map(d => <button key={d} className={`kt3-depth${depth===d?" on":""}`} onClick={()=>setDepth(d)} disabled={anyBusy}>L{d}</button>)}

            {/* 添加根 / 中断按钮 */}
            {anyBusy ? (
              <button className="kt3-btn" onClick={doCancel} style={{ borderColor:"rgba(251,113,133,.5)", color:"#fda4af", background:"rgba(251,113,133,.06)", animation:"kt3-pulse 1.4s infinite" }}>
                {tl.cancelBtn}
              </button>
            ) : (
              <button className="kt3-btn kt3-btn-primary" onClick={doAddRoot} disabled={!query.trim()||roots.length>=maxTrees}>
                <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.937 15.5A2 2 0 008.5 14.063l-6.135-1.582a.5.5 0 010-.962L8.5 9.937A2 2 0 009.937 8.5l1.582-6.135a.5.5 0 01.963 0L14.063 8.5A2 2 0 0015.5 9.937l6.135 1.582a.5.5 0 010 .962L15.5 14.063a2 2 0 00-1.437 1.437l-1.582 6.135a.5.5 0 01-.963 0z"/></svg>
                {tl.addRoot}{roots.length > 0 ? ` (${roots.length}/${maxTrees})` : ""}
              </button>
            )}

            {/* 跨树关联 / Cross-tree relations */}
            {roots.length >= 2 && (
              <button className="kt3-cross-btn" onClick={doCrossRelations} disabled={anyBusy||crossBusy||roots.some(r=>r.busy)}>
                {crossBusy ? tl.analyzing : `${tl.analyzeRelations}${crossEdges.length>0?` (${crossEdges.length})`:""}`}
              </button>
            )}

            {/* 关联模式 / Association mode */}
            {roots.length > 0 && (
              <button className={`kt3-assoc-btn${assocMode?" active":""}`} onClick={toggleAssocMode} disabled={anyBusy}>
                {assocMode ? tl.assoc.btnActive : tl.assoc.btn}
              </button>
            )}

            {/* 清空 / Clear */}
            {roots.length > 0 && (
              <button className="kt3-btn kt3-btn-danger" onClick={doClearAll} disabled={anyBusy}>
                {tl.clear}
              </button>
            )}
          </div>
        </div>

        {/* ── 树标签栏 ─────────────────────────── */}
        {roots.length > 0 && (
          <div style={{ padding:"4px 16px", background:"rgba(8,8,14,0.8)", borderBottom:"1px solid #0e0e18", display:"flex", gap:4, alignItems:"center", flexShrink:0, overflowX:"auto" }}>
            <span style={{ fontSize:10, color:"#1e1e30", marginRight:4, whiteSpace:"nowrap" }}>{tl.treesLabel}</span>
            {roots.map(r => (
              <_RootTab
                key={r.id}
                root={r}
                active={selectedRootId === r.id}
                onSelect={setSelectedRootId}
                onRemove={id => { SoundSystem.play("clear"); removeRoot(id) }}
              />
            ))}
            {crossEdges.length > 0 && (
              <span style={{ marginLeft:8, fontSize:11, color:"#8b5cf6", opacity:.7 }}>
                {tl.crossInfo(crossEdges.length)}
              </span>
            )}
          </div>
        )}

        {/* ── 关联模式横幅（新版）─────────────── */}
        {assocMode && !assocAnalyzing && (
          <_AssocBanner
            assocNodes={assocNodes}
            lang={lang}
            onStart={startAssocAnalysis}
            onClear={() => setAssocNodes([])}
            onRemoveNode={id => setAssocNodes(prev => prev.filter(n => n.id !== id))}
          />
        )}

        {/* ── 主区域 ───────────────────────────── */}
        <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
          {/* 画布 */}
          {(() => {
            const CanvasEl = CanvasComponent || KnowledgeTreeView;
            const activeRoot = roots.find(r => r.id === selectedRootId) || roots[roots.length - 1];
            const assocIds = new Set(assocNodes.map(n => n.id));

            if (CanvasComponent) {
              return (
                <CanvasEl
                  nodes={multiNodes}
                  edges={multiEdges}
                  crossEdges={crossEdges}
                  roots={roots}
                  selectedNode={selectedNode}
                  assocNodeIds={assocIds}
                  assocMode={assocMode}
                  lang={lang}
                  onNodeSelect={n => {
                    SoundSystem.play("click");
                    if (assocMode) { handleAssocNodeClick(n); return; }
                    setSelectedNode(n); setSelectedRootId(n._rootId);
                    setAutoAssocResults(null);
                  }}
                  onNodeExpand={nid => {
                    const root = roots.find(r => r.nodes.some(n => n.id === nid));
                    if (root) expand(nid, root.id);
                  }}
                />
              );
            }
            return activeRoot ? (
              <KnowledgeTreeView
                nodes={activeRoot.nodes}
                edges={activeRoot.edges}
                selectedNode={selectedNode}
                assocNodeIds={assocIds}
                onNodeSelect={n => {
                  SoundSystem.play("click");
                  const nn = { ...n, _rootId: activeRoot.id };
                  if (assocMode) { handleAssocNodeClick(nn); return; }
                  setSelectedNode(nn);
                  setAutoAssocResults(null);
                }}
                onNodeExpand={nid => expand(nid, activeRoot.id)}
                themeColor={activeRoot.color}
                lang={lang}
              />
            ) : (
              <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#1e1e30", fontSize:13, userSelect:"none" }}>
                {tl.emptyCanvas}
              </div>
            );
          })()}

          {/* 右侧面板 — 仅桌面 */}
          {!isMobile && (
            <div ref={sidePanelRef} style={{ width:300, flexShrink:0, borderLeft:"1px solid #10101a", background:"#09090f", display:"flex", flexDirection:"column" }}>
              <div style={{ flex:1, overflowY:"auto" }}>
                {selectedNode ? (
                  <_NodeDetail
                    node={selectedNode}
                    allNodes={allNodes}
                    onSelect={n => { setSelectedNode(n); SoundSystem.play("click"); setAutoAssocResults(null); }}
                    themeColor={roots.find(r => r.id === selectedNode._rootId)?.color}
                    lang={lang}
                    onAutoRelation={handleAutoRelation}
                    autoRelationBusy={autoAssocBusy}
                    autoRelationResults={autoAssocResults}
                    onViewPair={handleViewPair}
                  />
                ) : (
                  <_RightPanelEmpty lang={lang} />
                )}
              </div>

              {/* 日志 */}
              <div ref={logRef} style={{ height:128, flexShrink:0, overflowY:"auto", borderTop:"1px solid #10101a", padding:"8px 12px", background:"#07070c" }}>
                {activeLog.length === 0 ? (
                  <p style={{ fontSize:11, color:"#1a1a28", margin:0, fontStyle:"italic" }}>{tl.logEmpty}</p>
                ) : activeLog.map((m, i) => (
                  <_LogLine key={i} text={m} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 移动端底部抽屉 ───────────────────── */}
      {isMobile && bottomSheetOpen && (
        <div
          onClick={() => setBottomSheetOpen(false)}
          style={{ position:"fixed", inset:0, zIndex:499, background:"rgba(0,0,0,0.45)" }}
        />
      )}
      {isMobile && (
        <div ref={sidePanelRef} className={`kt3-bottom-sheet${bottomSheetOpen ? " open" : ""}`}>
          <div className="kt3-bottom-sheet-handle" onClick={() => setBottomSheetOpen(false)} />
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"4px 16px 0", flexShrink:0 }}>
            <span style={{ fontSize:12, color:"#4a4a6a" }}>{selectedNode?.label ?? ""}</span>
            <button
              onClick={() => { setBottomSheetOpen(false); setSelectedNode(null); }}
              style={{ background:"none", border:"none", color:"#3a3a55", fontSize:22, cursor:"pointer", lineHeight:1, padding:"0 4px" }}
            >×</button>
          </div>
          <div className="kt3-bottom-sheet-body">
            {selectedNode ? (
              <_NodeDetail
                node={selectedNode}
                allNodes={allNodes}
                onSelect={n => { setSelectedNode(n); SoundSystem.play("click"); setAutoAssocResults(null); }}
                themeColor={roots.find(r => r.id === selectedNode._rootId)?.color}
                lang={lang}
                onAutoRelation={handleAutoRelation}
                autoRelationBusy={autoAssocBusy}
                autoRelationResults={autoAssocResults}
                onViewPair={handleViewPair}
              />
            ) : (
              <_RightPanelEmpty lang={lang} />
            )}
          </div>
        </div>
      )}

      {/* ── 关联分析动画覆盖 ─────────────────── */}
      {assocAnalyzing && (
        <_AssocAnimation nodes={assocNodes} lang={lang} onCancel={cancelAssocAnalysis} />
      )}

      {/* ── 关联分析结果弹窗 ─────────────────── */}
      {showAssocResult && assocResult && (
        <_AssocResultModal
          nodes={assocNodes}
          result={assocResult}
          lang={lang}
          onClose={() => setShowAssocResult(false)}
          onExtract={handleExtractToTree}
        />
      )}

      {/* ── 提取树：数量管理弹窗 ─────────────── */}
      {showExtractModal && (
        <_ExtractModal
          roots={roots}
          maxTrees={maxTrees}
          lang={lang}
          onPickAndExtract={confirmPickAndExtract}
          onClearAndExtract={confirmClearAndExtract}
          onCancel={() => setShowExtractModal(false)}
        />
      )}

      {/* ── 偏好设置弹窗 ─────────────────────── */}
      {showSettings && (
        <_SettingsModal
          lang={lang}
          draftPrefs={draftPrefs}
          setDraftPrefs={setDraftPrefs}
          prefsSaved={prefsSaved}
          onClose={() => { setDraftPrefs(prefs); setShowSettings(false); }}
          onSave={async () => { await savePrefs(); setShowSettings(false); }}
        />
      )}
    </>
  );
}
