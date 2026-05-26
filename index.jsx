/**
 * knowledge-tree-agent.jsx  ·  知识树 Agent  ·  单文件四层架构
 * ══════════════════════════════════════════════════════════════
 *
 *  § 1  KnowledgeTreeAgent   纯 JS Agent，Node.js / 浏览器均可运行
 *  § 2  useKnowledgeTree     React Hook（Agent × React 状态桥）
 *  § 3  KnowledgeTreeView    纯展示组件（SVG 树 + 详情面板 + 日志区）
 *  § 4  KnowledgeTreeWidget  默认导出，开箱即用完整组件
 *
 * ─── 前端 React 直接使用 ───────────────────────────────────────
 *  import KnowledgeTreeWidget from './knowledge-tree-agent'
 *  <KnowledgeTreeWidget apiKey="sk-ant-..." />
 *
 * ─── 前端自定义 UI ─────────────────────────────────────────────
 *  import { useKnowledgeTree, KnowledgeTreeView } from './knowledge-tree-agent'
 *  const kt = useKnowledgeTree({ apiKey: 'sk-ant-...' })
 *  return <KnowledgeTreeView {...kt} onNodeSelect={kt.setSelectedNode} />
 *
 * ─── 纯后端 Node.js / Bun / Deno ──────────────────────────────
 *  import { KnowledgeTreeAgent } from './knowledge-tree-agent'
 *  const agent = new KnowledgeTreeAgent({ apiKey: process.env.ANTHROPIC_API_KEY })
 *  for await (const ev of agent.explore('量子纠缠')) {
 *    if (ev.type === 'node:done') console.log(ev.node.label, ev.node.explanation)
 *  }
 *  // 或一次性获取完整树：
 *  const tree = await agent.run('量子纠缠')
 */

import { useState, useRef, useCallback, useEffect } from "react";

// ══════════════════════════════════════════════════════════════════
// § 1  AGENT CORE  —  纯 JS，零框架依赖
// ══════════════════════════════════════════════════════════════════

/** Agent 默认配置，可在构造时按需覆盖 */
export const AGENT_DEFAULTS = {
  apiUrl:       "https://api.anthropic.com/v1/messages",
  model:        "claude-sonnet-4-20250514",
  maxLevel:     2,          // 树深度（根=0，二级=2）
  maxTokens:    1200,
  retries:      2,
  branchFactor: [3, 2],     // 各层最大子节点数
};

const _SYS = `你是一位费曼式知识图谱构建者。对于每个概念，请用中文完成以下任务：
- 写一段生动具体的历史故事或令人惊讶的起源叙述（2-3句话，叙事风格，不要枯燥定义，要让人印象深刻）
- 如果需要子概念，提供真正从该概念延伸出来的具体有趣术语

【重要】所有输出必须使用中文，包括 explanation 和 subconcepts 字段。
仅输出合法 JSON，不要 markdown 代码块，不要 JSON 之外的任何内容。`;

let _uid = 0;
const _mkNode = (label, level) => ({
  id: _uid++, label, level, explanation: "", children: [], status: "pending", x: 0, y: 0,
});

const _extractJSON = (text) => {
  text = text.replace(/```json\s*|```\s*/g, "").trim();
  try { return JSON.parse(text); } catch (_) {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error("No JSON in response: " + text.slice(0, 120));
};

/** 计算 SVG 布局坐标（原地修改节点的 x / y） */
export const treeLayout = (root, svgW = 840, pad = 32) => {
  const yPos = [55, 210, 365];
  const go = (node, x1, x2) => {
    node.x = (x1 + x2) / 2;
    node.y = yPos[node.level] ?? (node.level * 155 + 55);
    if (!node.children.length) return;
    const w = (x2 - x1) / node.children.length;
    node.children.forEach((c, i) => go(c, x1 + i * w, x1 + (i + 1) * w));
  };
  go(root, pad, svgW - pad);
};

export const flattenTree  = (node, out = []) => { out.push(node); node.children.forEach(c => flattenTree(c, out));  return out; };
export const getTreeEdges = (node, out = []) => { node.children.forEach(c => { out.push([node, c]); getTreeEdges(c, out); }); return out; };

/**
 * KnowledgeTreeAgent
 *
 * 框架无关的知识树构建 Agent。通过异步生成器逐步 yield 事件，
 * 适合后端流式输出（SSE / WebSocket）或直接在 Node.js 中使用。
 *
 * 事件结构：
 *   { type: "start",        node, tree }
 *   { type: "node:loading", node, tree }
 *   { type: "node:done",    node, tree }
 *   { type: "node:error",   node, tree, error }
 *   { type: "complete",           tree }
 */
export class KnowledgeTreeAgent {
  /** @param {Partial<typeof AGENT_DEFAULTS> & { apiKey?: string }} cfg */
  constructor(cfg = {}) {
    this.cfg = { ...AGENT_DEFAULTS, ...cfg };
    // Node.js 环境自动读取环境变量
    if (!this.cfg.apiKey && typeof process !== "undefined")
      this.cfg.apiKey = process.env?.ANTHROPIC_API_KEY ?? "";
  }

  /** 以异步生成器形式探索概念，边构建边 yield 事件 */
  async *explore(concept) {
    _uid = 0;
    const root = _mkNode(concept.trim(), 0);
    treeLayout(root);
    yield { type: "start", node: root, tree: root };

    const queue = [root];
    while (queue.length) {
      const node = queue.shift();
      node.status = "loading";
      treeLayout(root);
      yield { type: "node:loading", node, tree: root };

      try {
        const data = await this._call(node.label, node.level);
        node.explanation = data.explanation ?? "";
        node.status = "done";
        if (Array.isArray(data.subconcepts) && node.level < this.cfg.maxLevel) {
          const limit = this.cfg.branchFactor[node.level] ?? 2;
          data.subconcepts.slice(0, limit).forEach(lbl => {
            const child = _mkNode(String(lbl).trim(), node.level + 1);
            node.children.push(child);
            queue.push(child);
          });
        }
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

  /** 一次性运行到完成，返回最终树结构（适合批处理场景） */
  async run(concept) {
    let tree;
    for await (const ev of this.explore(concept)) tree = ev.tree;
    return tree;
  }

  async _call(label, level) {
    const { apiUrl, model, maxTokens, apiKey, retries, maxLevel, branchFactor } = this.cfg;
    const isLeaf = level >= maxLevel;
    const n = branchFactor[level] ?? 2;
    const fmt = isLeaf
      ? `{"explanation":"生动的2-3句历史故事（中文）"}`
      : `{"explanation":"生动的2-3句历史故事（中文）","subconcepts":[${Array(n).fill('"4-8字中文子概念"').join(",")}]}`;

    const body = JSON.stringify({
      model, max_tokens: maxTokens, system: _SYS,
      messages: [{ role: "user", content: `概念：「${label}」\n\n只输出 JSON，格式：\n${fmt}` }],
    });
    const headers = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    };

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(apiUrl, { method: "POST", headers, body });
        const d = await res.json();
        if (d.error) throw new Error(d.error.message);
        return _extractJSON(d.content.map(b => b.text ?? "").join(""));
      } catch (err) {
        if (attempt === retries) throw err;
        await new Promise(r => setTimeout(r, 900 * (attempt + 1)));
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// § 2  REACT HOOK  —  Agent × React 状态桥
// ══════════════════════════════════════════════════════════════════

/**
 * useKnowledgeTree
 *
 * 将 KnowledgeTreeAgent 的异步事件流接入 React 状态。
 * agentConfig 通过 ref 跟踪，避免 useCallback 因对象引用变化而重建。
 *
 * @param {Partial<typeof AGENT_DEFAULTS> & { apiKey?: string }} agentConfig
 * @returns {{ nodes, edges, log, busy, selectedNode, setSelectedNode, explore }}
 */
export function useKnowledgeTree(agentConfig = {}) {
  const cfgRef   = useRef(agentConfig);
  const runIdRef = useRef(0);
  useEffect(() => { cfgRef.current = agentConfig; });

  const [tree,         setTree]         = useState(null);
  const [log,          setLog]          = useState([]);
  const [busy,         setBusy]         = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);

  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  const explore = useCallback(async (concept) => {
    if (!concept?.trim() || busyRef.current) return;
    const runId = ++runIdRef.current;

    setBusy(true);
    setTree(null);
    setLog([`◎ 开始探索: "${concept.trim()}"`]);
    setSelectedNode(null);

    const agent = new KnowledgeTreeAgent(cfgRef.current);
    for await (const ev of agent.explore(concept)) {
      if (runIdRef.current !== runId) break; // 组件卸载或新一轮探索已启动
      switch (ev.type) {
        case "start":
          setTree({ ...ev.tree }); break;
        case "node:loading":
          setTree({ ...ev.tree });
          setLog(p => [...p, `  · 分析: "${ev.node.label}"`]); break;
        case "node:done":
          setTree({ ...ev.tree });
          setLog(p => [...p, `  ✓ "${ev.node.label}" → ${ev.node.children.length} 子概念`]); break;
        case "node:error":
          setTree({ ...ev.tree });
          setLog(p => [...p, `  ✗ "${ev.node.label}": ${ev.error?.message?.slice(0, 60)}`]); break;
        case "complete":
          setLog(p => [...p, "✨ 知识树构建完成 — 点击节点查看故事"]); break;
      }
    }
    if (runIdRef.current === runId) setBusy(false);
  }, []); // 无外部依赖，通过 ref 读取最新值

  const nodes = tree ? flattenTree(tree)  : [];
  const edges = tree ? getTreeEdges(tree) : [];

  return { tree, nodes, edges, log, busy, selectedNode, setSelectedNode, explore };
}

// ══════════════════════════════════════════════════════════════════
// § 3  REACT VIEW  —  纯展示层，无副作用（log 自动滚动除外）
// ══════════════════════════════════════════════════════════════════

// SVG 尺寸与节点半径（与 treeLayout 的 yPos 对应）
const _W = 840, _H = 420, _R = [28, 22, 17];
const _LV = ["根概念", "一级分支", "二级概念"];

// 内联 SVG 图标，零外部依赖
const _SvgIcon = ({ size, vb = "0 0 24 24", children }) => (
  <svg viewBox={vb} width={size} height={size} fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IconBranch  = () => <_SvgIcon size={18}><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/></_SvgIcon>;
const IconArrowR  = () => <_SvgIcon size={12}><path d="M5 12h14M12 5l7 7-7 7"/></_SvgIcon>;
const IconArrowL  = () => <_SvgIcon size={12}><path d="M19 12H5M12 19l-7-7 7-7"/></_SvgIcon>;
const IconSparkle = () => <_SvgIcon size={14}><path d="M9.937 15.5A2 2 0 008.5 14.063l-6.135-1.582a.5.5 0 010-.962L8.5 9.937A2 2 0 009.937 8.5l1.582-6.135a.5.5 0 01.963 0L14.063 8.5A2 2 0 0015.5 9.937l6.135 1.582a.5.5 0 010 .962L15.5 14.063a2 2 0 00-1.437 1.437l-1.582 6.135a.5.5 0 01-.963 0z"/></_SvgIcon>;

/**
 * KnowledgeTreeView  —  知识树纯展示组件
 *
 * @param {{
 *   nodes:        object[],
 *   edges:        [object, object][],
 *   log:          string[],
 *   selectedNode: object | null,
 *   onNodeSelect: (node: object) => void,
 *   svgW?:        number,
 *   svgH?:        number,
 * }} props
 */
export function KnowledgeTreeView({
  nodes = [], edges = [], log = [],
  selectedNode, onNodeSelect,
  svgW = _W, svgH = _H,
}) {
  const logEl = useRef(null);
  useEffect(() => { if (logEl.current) logEl.current.scrollTop = 9999; }, [log]);

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

      {/* ── SVG 树 ───────────────────────────────── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {nodes.length ? (
          <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: "100%", height: "100%" }}
            preserveAspectRatio="xMidYMid meet" aria-label="知识树图谱">
            {edges.map(([a, b], i) => {
              const active = b.status !== "pending";
              return <line key={i}
                x1={a.x} y1={a.y + _R[a.level]} x2={b.x} y2={b.y - _R[b.level]}
                stroke={active ? `var(--kt-l${b.level}-bd)` : "var(--kt-border)"}
                strokeWidth={active ? 1 : 0.5} strokeOpacity={active ? 0.35 : 0.4}
                strokeDasharray={active ? undefined : "4 3"} />;
            })}
            {nodes.map(n => <_TreeNode key={n.id} node={n} selected={selectedNode?.id === n.id} onSelect={onNodeSelect} />)}
          </svg>
        ) : (
          <div style={{ opacity: 0.3, textAlign: "center", color: "var(--kt-text-muted)", userSelect: "none" }}>
            <svg viewBox="0 0 80 64" width="80" height="64" fill="none">
              <circle cx="40" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="16" cy="50" r="8"  stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="40" cy="50" r="8"  stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="64" cy="50" r="8"  stroke="currentColor" strokeWidth="1.5"/>
              <line x1="40" y1="22" x2="16" y2="42" stroke="currentColor" strokeWidth="1"/>
              <line x1="40" y1="22" x2="40" y2="42" stroke="currentColor" strokeWidth="1"/>
              <line x1="40" y1="22" x2="64" y2="42" stroke="currentColor" strokeWidth="1"/>
            </svg>
            <p style={{ fontSize: 14, marginTop: 12 }}>输入概念，开始构建知识树</p>
          </div>
        )}
      </div>

      {/* ── 右侧面板：节点详情 + 日志 ───────────── */}
      <div style={{ width: 296, borderLeft: "0.5px solid var(--kt-border)", display: "flex", flexDirection: "column", background: "var(--kt-bg-primary)", flexShrink: 0 }}>

        {/* 节点详情区 */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {selectedNode
            ? <_NodeDetail node={selectedNode} nodes={nodes} onSelect={onNodeSelect} />
            : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8, opacity: 0.3, userSelect: "none" }}>
                <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="var(--kt-text-muted)" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M15 15l6 6m-11-4a7 7 0 110-14 7 7 0 010 14z"/>
                </svg>
                <p style={{ fontSize: 13, color: "var(--kt-text-muted)", textAlign: "center", lineHeight: 1.6, margin: 0 }}>
                  点击树上的节点<br />查看历史故事与解释
                </p>
              </div>
            )
          }
        </div>

        {/* 日志区 */}
        <div ref={logEl} style={{ height: 128, overflowY: "auto", borderTop: "0.5px solid var(--kt-border)", padding: "8px 12px", background: "var(--kt-bg-secondary)", flexShrink: 0 }}>
          {log.length === 0
            ? <p style={{ fontSize: 12, color: "var(--kt-text-muted)", margin: 0, fontStyle: "italic" }}>Agent 运行日志…</p>
            : log.map((m, i) => (
              <p key={i} className="kt-log" style={{ fontSize: 12, color: "var(--kt-text-secondary)", margin: "0 0 2px", lineHeight: 1.5, fontFamily: "var(--kt-font-mono)" }}>{m}</p>
            ))
          }
        </div>
      </div>
    </div>
  );
}

// 单个节点 SVG 元素
function _TreeNode({ node, selected, onSelect }) {
  const r = _R[node.level], lv = node.level;
  const isDone = node.status === "done";
  const isLoad = node.status === "loading";
  const isPend = node.status === "pending";
  const arcR = r - 6;
  const label = node.label.length > 10 ? node.label.slice(0, 9) + "…" : node.label;

  return (
    <g onClick={() => isDone && onSelect?.(node)} style={{ cursor: isDone ? "pointer" : "default" }}>
      {selected && <circle cx={node.x} cy={node.y} r={r + 10} fill="none" stroke={`var(--kt-l${lv}-bd)`} strokeWidth="1.5" strokeOpacity="0.45" strokeDasharray="3 3" />}
      {isDone    && <circle cx={node.x} cy={node.y} r={r + 4}  fill={`var(--kt-l${lv}-bg)`} opacity="0.35" />}
      <circle cx={node.x} cy={node.y} r={r}
        fill={isDone ? `var(--kt-l${lv}-bg)` : "var(--kt-bg-secondary)"}
        stroke={`var(--kt-l${lv}-bd)`}
        strokeWidth={isDone ? 1.5 : isPend ? 0.5 : 1}
        opacity={isPend ? 0.3 : 1} />
      {isLoad && (
        <circle cx={node.x} cy={node.y} r={arcR} fill="none" stroke={`var(--kt-l${lv}-bd)`} strokeWidth="1.5"
          strokeDasharray={`${arcR * 2.2} ${arcR * 4}`}>
          <animateTransform attributeName="transform" type="rotate"
            from={`0 ${node.x} ${node.y}`} to={`360 ${node.x} ${node.y}`} dur="1.1s" repeatCount="indefinite" />
        </circle>
      )}
      {isDone && lv === 0 && <text x={node.x} y={node.y + 1} textAnchor="middle" dominantBaseline="central" fontSize="13" fill={`var(--kt-l${lv}-bd)`} opacity="0.6">✦</text>}
      {!isPend && (
        <text x={node.x} y={node.y + r + 15} textAnchor="middle"
          fill={isDone ? `var(--kt-l${lv}-text)` : "var(--kt-text-secondary)"}
          fontSize={lv === 0 ? 13 : lv === 1 ? 11 : 10}
          fontWeight={lv === 0 ? "500" : "400"}
          fontFamily="var(--kt-font-sans)"
          opacity={isLoad ? 0.65 : 1}>{label}</text>
      )}
      <title>{node.label}</title>
    </g>
  );
}

// 右侧节点详情面板
function _NodeDetail({ node, nodes, onSelect }) {
  return (
    <div className="kt-fade">
      {/* 层级标签 */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11,
        padding: "3px 10px", borderRadius: "var(--kt-radius)", marginBottom: 12,
        background: `var(--kt-l${node.level}-bg)`,
        border: `0.5px solid var(--kt-l${node.level}-bd)`,
        color: `var(--kt-l${node.level}-text)`,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: `var(--kt-l${node.level}-bd)`, display: "inline-block" }} />
        {_LV[node.level]}
      </div>

      {/* 概念名 */}
      <h2 style={{ fontSize: 18, fontWeight: 500, color: "var(--kt-text-primary)", margin: "0 0 10px", lineHeight: 1.3 }}>
        {node.label}
      </h2>

      {/* 费曼故事 */}
      <div style={{ borderLeft: `2px solid var(--kt-l${node.level}-bd)`, paddingLeft: 12, marginBottom: 16 }}>
        <p style={{ fontSize: 14, lineHeight: 1.8, color: "var(--kt-text-secondary)", margin: 0 }}>{node.explanation}</p>
      </div>

      {/* 子概念导航 */}
      {node.children.length > 0 && (
        <>
          <p style={{ fontSize: 11, color: "var(--kt-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 8px" }}>子概念</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {node.children.map(c => (
              <button key={c.id} onClick={() => onSelect?.(c)} style={{
                textAlign: "left", display: "flex", alignItems: "center", gap: 8,
                padding: "7px 10px", borderRadius: "var(--kt-radius)",
                border: `0.5px solid var(--kt-l${c.level}-bd)`,
                background: `var(--kt-l${c.level}-bg)`,
                color: `var(--kt-l${c.level}-text)`,
                fontSize: 13, cursor: "pointer",
              }}>
                <IconArrowR />{c.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* 返回父节点 */}
      {node.level > 0 && (() => {
        const parent = nodes.find(n => n.children.some(c => c.id === node.id));
        return parent ? (
          <button onClick={() => onSelect?.(parent)} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, fontSize: 12, color: "var(--kt-text-muted)", cursor: "pointer", background: "none", border: "none", padding: 0 }}>
            <IconArrowL />返回 {parent.label}
          </button>
        ) : null;
      })()}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// § 4  WIDGET  —  开箱即用完整组件（默认导出）
// ══════════════════════════════════════════════════════════════════

// 自包含主题，使用 --kt- 前缀避免与宿主样式冲突
const _CSS = `
  :root {
    --kt-l0-bg:#FAEEDA; --kt-l0-text:#633806; --kt-l0-bd:#BA7517;
    --kt-l1-bg:#E1F5EE; --kt-l1-text:#085041; --kt-l1-bd:#0F6E56;
    --kt-l2-bg:#EEEDFE; --kt-l2-text:#3C3489; --kt-l2-bd:#534AB7;
    --kt-bg-primary:#fff; --kt-bg-secondary:#f5f5f7; --kt-bg-tertiary:#ebebed;
    --kt-border:#e0e0e5; --kt-text-primary:#1a1a1a; --kt-text-secondary:#555;
    --kt-text-muted:#999;
    --kt-font-sans:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    --kt-font-mono:'SF Mono','Fira Code',monospace;
    --kt-radius:6px;
  }
  @media (prefers-color-scheme: dark) { :root {
    --kt-l0-bg:#412402; --kt-l0-text:#FAC775; --kt-l0-bd:#EF9F27;
    --kt-l1-bg:#04342C; --kt-l1-text:#9FE1CB; --kt-l1-bd:#1D9E75;
    --kt-l2-bg:#26215C; --kt-l2-text:#CECBF6; --kt-l2-bd:#7F77DD;
    --kt-bg-primary:#1a1a1a; --kt-bg-secondary:#242424; --kt-bg-tertiary:#2e2e2e;
    --kt-border:#3a3a3a; --kt-text-primary:#f0f0f0; --kt-text-secondary:#bbb;
    --kt-text-muted:#666;
  }}
  @keyframes kt-fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
  .kt-fade { animation: kt-fadeUp .3s ease; }
  .kt-log  { animation: kt-fadeUp .15s ease; }
  .kt-input {
    font-family: var(--kt-font-sans); padding: 8px 12px;
    border-radius: var(--kt-radius); border: 1px solid var(--kt-border);
    background: var(--kt-bg-primary); color: var(--kt-text-primary);
    font-size: 14px; outline: none;
  }
  .kt-btn {
    display: flex; align-items: center; gap: 6px; padding: 8px 16px;
    border-radius: var(--kt-radius); border: 1px solid var(--kt-border);
    background: var(--kt-bg-secondary); color: var(--kt-text-primary);
    font-family: var(--kt-font-sans); cursor: pointer; font-size: 14px;
    transition: background .15s; white-space: nowrap;
  }
  .kt-btn:hover    { background: var(--kt-border); }
  .kt-btn:disabled { opacity: .5; cursor: not-allowed; }
`;

/**
 * KnowledgeTreeWidget  —  开箱即用的完整知识树探索器
 *
 * @param {{
 *   apiKey?:      string,   Anthropic API Key（使用 Vite 代理时可省略）
 *   agentConfig?: object,   覆盖 AGENT_DEFAULTS 的任意配置项
 * }} props
 */
export default function KnowledgeTreeWidget({ apiKey, agentConfig = {} }) {
  const [query, setQuery] = useState("");
  const cfg = { ...(apiKey ? { apiKey } : {}), ...agentConfig };
  const { nodes, edges, log, busy, selectedNode, setSelectedNode, explore } = useKnowledgeTree(cfg);

  return (
    <>
      <style>{_CSS}</style>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "var(--kt-bg-tertiary)", fontFamily: "var(--kt-font-sans)" }}>

        {/* ── 顶栏 ─────────────────────────────── */}
        <div style={{ padding: "10px 20px", borderBottom: "0.5px solid var(--kt-border)", background: "var(--kt-bg-primary)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <IconBranch />
          <span style={{ fontSize: 16, fontWeight: 500, color: "var(--kt-text-primary)" }}>知识图谱探索者</span>
          <span style={{ fontSize: 12, color: "var(--kt-text-muted)" }}>费曼学习法 · AI Agent · 2–3 层知识树</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 16, alignItems: "center" }}>
            {[["var(--kt-l0-bd)", "根概念"], ["var(--kt-l1-bd)", "一级分支"], ["var(--kt-l2-bd)", "二级概念"]].map(([c, l]) => (
              <span key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--kt-text-muted)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block" }} />{l}
              </span>
            ))}
          </div>
        </div>

        {/* ── 输入栏 ───────────────────────────── */}
        <div style={{ padding: "10px 20px", background: "var(--kt-bg-primary)", borderBottom: "0.5px solid var(--kt-border)", display: "flex", gap: 10, flexShrink: 0 }}>
          <input className="kt-input" style={{ flex: 1 }}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && explore(query)}
            disabled={busy}
            placeholder="输入一个概念 — 丝绸之路、量子纠缠、活字印刷、货币、民主…"
          />
          <button className="kt-btn" onClick={() => explore(query)} disabled={busy}>
            <IconSparkle />
            {busy ? "探索中…" : "开始探索"}
          </button>
        </div>

        {/* ── 主视图 ───────────────────────────── */}
        <KnowledgeTreeView
          nodes={nodes} edges={edges} log={log}
          selectedNode={selectedNode} onNodeSelect={setSelectedNode}
        />
      </div>
    </>
  );
}
