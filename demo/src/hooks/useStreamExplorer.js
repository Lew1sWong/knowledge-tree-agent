/**
 * useStreamExplorer.js  —  服务端流式知识树 Hook
 * ════════════════════════════════════════════════════════════════
 *
 * 消费 POST /api/explore（NDJSON streaming）和 POST /api/expand，
 * 返回与 useKnowledgeTree 相同的接口，可直接替换使用。
 *
 * 架构层次：
 *   Presentation Layer (React 组件)
 *        ↓
 *   State Layer (本 Hook)
 *        ↓
 *   API Layer  (Express /api/explore, /api/expand)
 *        ↓
 *   LLM Layer  (Anthropic / DeepSeek)
 */

import { useState, useRef, useCallback } from "react";
import {
  mkNode,
  treeLayout,
  flattenTree,
  getTreeEdges,
} from "../../../index.jsx";

/**
 * @param {{
 *   exploreUrl?: string,   默认 "/api/explore"
 *   expandUrl?:  string,   默认 "/api/expand"
 *   maxLevel?:   number,   由调用方传入
 *   minRelevance?: number,
 * }} opts
 */
export function useStreamExplorer(opts = {}) {
  const {
    exploreUrl = "/api/explore",
    expandUrl = "/api/expand",
    minRelevance = 6,
  } = opts;

  const [tree, setTree] = useState(null);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);

  const treeRef = useRef(null);
  const nodeMapRef = useRef(new Map()); // id → node（服务端 id → 客户端 node）
  const busyRef = useRef(false);
  const runIdRef = useRef(0);

  // 与服务端节点同步（将服务端快照更新到本地 node 对象上）
  const _syncNode = (snapshot) => {
    const node = nodeMapRef.current.get(snapshot.id);
    if (!node) return null;
    node.explanation = snapshot.explanation ?? node.explanation;
    node.hasStrongRelations =
      snapshot.hasStrongRelations ?? node.hasStrongRelations;
    node.status = snapshot.status ?? node.status;
    return node;
  };

  // 深度探索：通过 /api/expand 扩展叶节点
  const expand = useCallback(async (nodeId) => {
    if (!treeRef.current || busyRef.current) return;
    const node = flattenTree(treeRef.current).find((n) => n.id === nodeId);
    if (
      !node ||
      node.status !== "done" ||
      node.children.length > 0 ||
      node.hasStrongRelations === false
    )
      return;

    busyRef.current = true;
    setBusy(true);
    node.status = "loading";
    treeLayout(treeRef.current);
    setTree({ ...treeRef.current });
    setLog((p) => [...p, `  ⟳ 深度探索: "${node.label}"`]);

    try {
      const res = await fetch(expandUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: node.label,
          level: node.level,
          minRelevance,
        }),
      });

      if (!res.ok) throw new Error(`服务器错误: ${res.status}`);
      const data = await res.json();

      // 更新节点本身的解释和关联状态
      node.explanation = data.node.explanation ?? node.explanation;
      node.hasStrongRelations = data.node.hasStrongRelations ?? false;
      node.status = "done";

      if (!data.children?.length) {
        setLog((p) => [...p, `  ⊘ "${node.label}" — 无强相关子节点`]);
        treeLayout(treeRef.current);
        setTree({ ...treeRef.current });
        busyRef.current = false;
        setBusy(false);
        return;
      }

      // 创建子节点（并发拉取各自解释）
      const children = data.children.map((c) => {
        const child = mkNode(c.label, c.level, c.relevance);
        child.status = "loading";
        node.children.push(child);
        nodeMapRef.current.set(child.id, child);
        return child;
      });

      treeLayout(treeRef.current);
      setTree({ ...treeRef.current });

      // 并发为每个子节点拉取解释
      await Promise.all(
        children.map(async (child) => {
          try {
            const r = await fetch(expandUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                label: child.label,
                level: child.level,
                maxLevel: child.level, // 只要解释，不要子概念
                minRelevance,
              }),
            });
            if (r.ok) {
              const d = await r.json();
              child.explanation = d.node.explanation ?? "";
              child.hasStrongRelations = d.node.hasStrongRelations ?? false;
              child.status = "done";
            } else {
              child.status = "error";
            }
          } catch {
            child.status = "error";
          }
          treeLayout(treeRef.current);
          setTree({ ...treeRef.current });
        })
      );

      setLog((p) => [
        ...p,
        `  ✓ "${node.label}" → ${children.length} 子概念`,
      ]);
    } catch (err) {
      node.status = "error";
      setLog((p) => [...p, `  ✗ 深度探索失败: ${err.message?.slice(0, 55)}`]);
      treeLayout(treeRef.current);
      setTree({ ...treeRef.current });
    }

    busyRef.current = false;
    setBusy(false);
  }, [expandUrl, minRelevance]);

  // 探索新概念：消费服务端 NDJSON 流
  const explore = useCallback(
    async (concept, maxLevel = 2) => {
      if (!concept?.trim() || busyRef.current) return;
      const runId = ++runIdRef.current;

      busyRef.current = true;
      setBusy(true);
      setTree(null);
      setSelectedNode(null);
      setLog([`◎ 服务端流式探索: "${concept.trim()}"`]);
      treeRef.current = null;
      nodeMapRef.current = new Map();

      // 本地维护节点树（按服务端 id 索引）
      const localNodes = new Map(); // serverId → clientNode

      try {
        const res = await fetch(exploreUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ concept: concept.trim(), maxLevel, minRelevance }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          if (runIdRef.current !== runId) break;

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            let ev;
            try {
              ev = JSON.parse(line);
            } catch {
              continue;
            }

            if (runIdRef.current !== runId) break;
            _handleStreamEvent(ev, localNodes, treeRef, nodeMapRef, setTree, setLog);
          }
        }

        if (runIdRef.current === runId) {
          setLog((p) => [
            ...p,
            "✨ 构建完成 — 点击节点查看解释，点击 + 深度探索",
          ]);
        }
      } catch (err) {
        if (runIdRef.current === runId) {
          setLog((p) => [...p, `  ✗ 连接失败: ${err.message?.slice(0, 60)}`]);
        }
      }

      if (runIdRef.current === runId) {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [exploreUrl, minRelevance]
  );

  const nodes = tree ? flattenTree(tree) : [];
  const edges = tree ? getTreeEdges(tree) : [];

  return {
    tree,
    nodes,
    edges,
    log,
    busy,
    selectedNode,
    setSelectedNode,
    explore,
    expand,
  };
}

// ── 内部：处理单条流事件 ──────────────────────────────────────────

function _handleStreamEvent(ev, localNodes, treeRef, nodeMapRef, setTree, setLog) {
  switch (ev.type) {
    case "start": {
      const root = mkNode(ev.node.label, ev.node.level, ev.node.relevance);
      root.status = "pending";
      localNodes.set(ev.node.id, root);
      nodeMapRef.current.set(root.id, root);
      treeRef.current = root;
      treeLayout(root);
      setTree({ ...root });
      break;
    }

    case "node:loading": {
      const node = localNodes.get(ev.node.id);
      if (node) {
        node.status = "loading";
        treeLayout(treeRef.current);
        setTree({ ...treeRef.current });
        setLog((p) => [...p, `  ⟳ 分析: "${ev.node.label}"`]);
      }
      break;
    }

    case "node:done": {
      let node = localNodes.get(ev.node.id);
      if (!node) break;

      node.explanation = ev.node.explanation ?? "";
      node.hasStrongRelations = ev.node.hasStrongRelations ?? false;
      node.status = "done";

      // 将服务端返回的子节点 id 创建为本地节点
      if (ev.node.childIds?.length) {
        // 子节点在后续 start/loading/done 事件中处理，
        // 但需在父节点中提前占位（pending 状态）
        for (const cid of ev.node.childIds) {
          if (!localNodes.has(cid)) {
            // 子节点稍后会由 start 事件创建，这里先跳过
          }
        }
      }

      treeLayout(treeRef.current);
      setTree({ ...treeRef.current });
      setLog((p) => [
        ...p,
        ev.node.hasStrongRelations === false
          ? `  ⊘ "${ev.node.label}" — 无强相关子概念`
          : `  ✓ "${ev.node.label}"`,
      ]);
      break;
    }

    case "node:error": {
      const node = localNodes.get(ev.node.id);
      if (node) {
        node.status = "error";
        treeLayout(treeRef.current);
        setTree({ ...treeRef.current });
        setLog((p) => [...p, `  ✗ "${ev.node.label}": ${ev.error?.slice(0, 55)}`]);
      }
      break;
    }

    case "error": {
      setLog((p) => [...p, `  ✗ 服务器错误: ${ev.error?.slice(0, 60)}`]);
      break;
    }

    case "complete":
    default:
      break;
  }
}
