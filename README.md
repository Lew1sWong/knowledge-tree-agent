# knowledge-tree-agent

**费曼式知识树 AI Agent** — 单文件四层架构，一行代码嵌入 React，也可运行在 Node.js 后端。

输入任意概念，Agent 自动调用 Claude 构建 2-3 层知识树，每个节点附有生动的历史故事。

---

## Architecture 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     index.jsx  (单文件)                          │
│                                                                   │
│  § 1  KnowledgeTreeAgent                                         │
│       纯 JS 类，AsyncGenerator 事件流                             │
│       ✓ Node.js  ✓ Bun  ✓ Deno  ✓ 浏览器                        │
│                          │                                        │
│  § 2  useKnowledgeTree   │  React Hook                           │
│       将 § 1 事件流接入 React 状态                                │
│                          │                                        │
│  § 3  KnowledgeTreeView  │  纯展示组件（props-only）              │
│       SVG 树 + 节点详情面板 + Agent 日志区                        │
│                          │                                        │
│  § 4  KnowledgeTreeWidget│  默认导出，开箱即用                    │
│       = 输入栏 + useKnowledgeTree + KnowledgeTreeView            │
└─────────────────────────────────────────────────────────────────┘
```

**调用关系：**
```
KnowledgeTreeWidget
  └─ useKnowledgeTree(config)
       └─ KnowledgeTreeAgent.explore(concept)   ← AsyncGenerator
  └─ KnowledgeTreeView(nodes, edges, log, ...)
       ├─ SVG 树（_TreeNode × n）
       └─ 右侧面板（_NodeDetail + 日志区）
```

---

## Quick Start 快速开始

```jsx
import KnowledgeTreeWidget from './knowledge-tree-agent'

export default function App() {
  return <KnowledgeTreeWidget apiKey="sk-ant-..." />
}
```

---

## Installation 安装

### 方式 A — 直接复制（推荐本地项目）

将 `index.jsx` 复制到项目的任意目录，按需 import。

### 方式 B — Vite 代理（保护 API Key，不暴露到浏览器）

**1. 创建 `.env`**
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```

**2. 配置 `vite.config.js`**
```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/v1': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
      },
    },
  },
})
```

**3. 使用代理 URL（不传 apiKey）**
```jsx
<KnowledgeTreeWidget agentConfig={{ apiUrl: '/v1/messages' }} />
```

---

## Usage 用法

### 1. React Widget — 开箱即用

```jsx
import KnowledgeTreeWidget from './knowledge-tree-agent'

// 直接传 apiKey（仅适合本地开发，key 会暴露在客户端）
<KnowledgeTreeWidget apiKey="sk-ant-..." />

// 通过 Vite 代理（推荐生产环境）
<KnowledgeTreeWidget agentConfig={{ apiUrl: '/v1/messages' }} />

// 自定义 Agent 参数
<KnowledgeTreeWidget
  apiKey="sk-ant-..."
  agentConfig={{ maxLevel: 3, branchFactor: [4, 3, 2] }}
/>
```

---

### 2. React Hook + 自定义 UI

适合需要自定义界面的场景，Hook 管理状态，UI 完全由你控制。

```jsx
import { useKnowledgeTree, KnowledgeTreeView } from './knowledge-tree-agent'

function MyApp() {
  const kt = useKnowledgeTree({ apiKey: 'sk-ant-...' })

  return (
    <div>
      <input onKeyDown={e => e.key === 'Enter' && kt.explore(e.target.value)} />
      <button onClick={() => kt.explore('量子纠缠')}>探索</button>

      {/* 使用内置 View */}
      <KnowledgeTreeView
        nodes={kt.nodes}
        edges={kt.edges}
        log={kt.log}
        selectedNode={kt.selectedNode}
        onNodeSelect={kt.setSelectedNode}
      />

      {/* 或完全自定义 */}
      <pre>{JSON.stringify(kt.tree, null, 2)}</pre>
    </div>
  )
}
```

---

### 3. Node.js 后端 — 纯 Agent

`KnowledgeTreeAgent` 零框架依赖，可直接在 Node.js / Bun / Deno 中使用。

```js
import { KnowledgeTreeAgent } from './index.jsx'

const agent = new KnowledgeTreeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// 流式处理（推荐）
for await (const ev of agent.explore('丝绸之路')) {
  if (ev.type === 'node:done') {
    console.log(`[${ev.node.level}] ${ev.node.label}: ${ev.node.explanation}`)
  }
}

// 或一次性获取完整树
const tree = await agent.run('丝绸之路')
console.log(JSON.stringify(tree, null, 2))
```

---

### 4. Express SSE 后端 — 流式推送到前端

```js
import express from 'express'
import { KnowledgeTreeAgent } from './index.jsx'

const app = express()

app.get('/api/explore', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')

  const agent = new KnowledgeTreeAgent({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  for await (const ev of agent.explore(req.query.concept)) {
    res.write(`data: ${JSON.stringify(ev)}\n\n`)
  }

  res.end()
})

app.listen(3000)
```

前端通过 `EventSource` 接收：
```js
const es = new EventSource(`/api/explore?concept=量子纠缠`)
es.onmessage = e => {
  const ev = JSON.parse(e.data)
  if (ev.type === 'node:done') updateUI(ev.node)
  if (ev.type === 'complete') es.close()
}
```

---

## API Reference

### `KnowledgeTreeAgent`

```js
new KnowledgeTreeAgent(config?)
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `config.apiKey` | `string` | Anthropic API Key（Node.js 自动读 `ANTHROPIC_API_KEY` 环境变量） |
| `config.apiUrl` | `string` | API 端点，默认 `https://api.anthropic.com/v1/messages` |
| `config.model` | `string` | Claude 模型 ID，默认 `claude-sonnet-4-20250514` |
| `config.maxLevel` | `number` | 树的最大深度（0=根），默认 `2` |
| `config.branchFactor` | `number[]` | 各层最大子节点数，默认 `[3, 2]` |
| `config.maxTokens` | `number` | 单次请求最大 tokens，默认 `1200` |
| `config.retries` | `number` | 失败重试次数，默认 `2` |

**方法：**

```js
agent.explore(concept: string): AsyncGenerator<Event>
agent.run(concept: string): Promise<TreeNode>  // 一次性，返回完整树
```

---

### Agent 事件类型（`explore()` yield）

| `type` | 附加字段 | 触发时机 |
|--------|----------|----------|
| `"start"` | `node, tree` | 根节点创建后 |
| `"node:loading"` | `node, tree` | 节点开始 API 请求 |
| `"node:done"` | `node, tree` | 节点请求成功，子节点已加入队列 |
| `"node:error"` | `node, tree, error` | 节点请求最终失败 |
| `"complete"` | `tree` | 所有节点处理完毕 |

`tree` 始终是当前根节点的引用（原地修改），`node` 是本次事件涉及的节点。

---

### `useKnowledgeTree(agentConfig?)`

```js
const {
  tree,          // 当前树结构（原始对象，可直接序列化）
  nodes,         // flattenTree(tree) — SVG 节点数组
  edges,         // getTreeEdges(tree) — [父节点, 子节点][] 连线数组
  log,           // string[] — Agent 运行日志
  busy,          // boolean — 是否正在探索
  selectedNode,  // 当前选中节点 | null
  setSelectedNode,
  explore,       // (concept: string) => void
} = useKnowledgeTree(agentConfig)
```

---

### `KnowledgeTreeView` props

| prop | 类型 | 必填 | 说明 |
|------|------|------|------|
| `nodes` | `TreeNode[]` | ✓ | flattenTree 的结果 |
| `edges` | `[TreeNode, TreeNode][]` | ✓ | getTreeEdges 的结果 |
| `log` | `string[]` | ✓ | Agent 日志行 |
| `selectedNode` | `TreeNode \| null` | ✓ | 当前选中节点 |
| `onNodeSelect` | `(node) => void` | ✓ | 节点点击回调 |
| `svgW` | `number` | — | SVG 宽度，默认 `840` |
| `svgH` | `number` | — | SVG 高度，默认 `420` |

---

### `KnowledgeTreeWidget` props

| prop | 类型 | 说明 |
|------|------|------|
| `apiKey` | `string` | Anthropic API Key（可选，建议用代理替代） |
| `agentConfig` | `object` | 覆盖 `AGENT_DEFAULTS` 的任意配置项 |

---

### `AGENT_DEFAULTS` 默认配置

```js
import { AGENT_DEFAULTS } from './index.jsx'
// {
//   apiUrl:       "https://api.anthropic.com/v1/messages",
//   model:        "claude-sonnet-4-20250514",
//   maxLevel:     2,
//   maxTokens:    1200,
//   retries:      2,
//   branchFactor: [3, 2],
// }
```

---

### Utility 工具函数

```js
import { treeLayout, flattenTree, getTreeEdges } from './index.jsx'

treeLayout(root, svgW?, pad?)    // 原地计算节点 x/y 坐标
flattenTree(root)                // 返回所有节点的扁平数组
getTreeEdges(root)               // 返回所有 [父, 子] 连线对
```

---

## TreeNode 结构

```ts
interface TreeNode {
  id:          number        // 自增唯一 ID
  label:       string        // 概念名称
  level:       number        // 层级（0 = 根）
  explanation: string        // Claude 生成的费曼故事
  children:    TreeNode[]    // 子节点
  status:      'pending' | 'loading' | 'done' | 'error'
  x:           number        // SVG 布局坐标（treeLayout 计算）
  y:           number
}
```

---

## CSS 主题定制

Widget 注入自包含主题（`--kt-*` 前缀，不污染宿主样式）。
可在宿主 CSS 中覆盖任意变量：

```css
:root {
  --kt-l0-bd: #ff6b35;    /* 根节点边框色 */
  --kt-font-sans: 'Inter', sans-serif;
  --kt-radius: 8px;
}
```

完整变量列表见 `index.jsx` 中的 `_CSS` 常量。
