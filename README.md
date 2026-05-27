# knowledge-tree-agent

**费曼式知识树 AI Agent** — 单文件四层架构，一行代码嵌入 React，也可运行在 Node.js 后端。

输入任意概念，Agent 自动调用 Claude（或 DeepSeek）构建多层知识树，每个节点附有生动的历史故事，并通过相关度评分过滤弱关联，防止幻觉。

---

## Architecture 架构

```
index.jsx  (核心库，单文件)
│
├─ § 1  LEVEL_COLORS / AGENT_DEFAULTS   颜色系统 & 默认配置
├─ § 2  treeLayout / flattenTree / …    树布局算法（Reingold-Tilford）
├─ § 3  LLM Prompt Engine               反幻觉 × 相关度评分
├─ § 4  KnowledgeTreeAgent              纯 JS 类，AsyncGenerator 事件流
│                                        ✓ Node.js  ✓ Bun  ✓ Deno  ✓ 浏览器
├─ § 5  useKnowledgeTree                React Hook — 客户端 Agent 桥
├─ § 6  KnowledgeTreeView               交互式 SVG 画布（拖拽 / 缩放）
├─ § 7  NodeDetail                      右侧节点详情面板
└─ § 8  KnowledgeTreeWidget             默认导出，开箱即用完整组件

demo/                                   完整可运行的 Demo 应用
├─ server.js                            Express 服务端 Agent（密码保护 + 限流）
├─ src/App.jsx                          React 入口（挂载 KnowledgeTreeWidget）
├─ src/hooks/useStreamExplorer.js       服务端流式 Hook（消费 /api/explore）
└─ vite.config.js                       开发模式代理（/api/messages）
```

**调用关系：**
```
KnowledgeTreeWidget（默认导出）
  └─ useKnowledgeTree(config)
       └─ KnowledgeTreeAgent.explore(concept)  ← AsyncGenerator
  └─ KnowledgeTreeView(nodes, edges, …)
       ├─ SVG 树（_TreeNodeSVG × n）
       └─ 右侧面板（_NodeDetail + 日志区）
```

---

## Demo 快速启动

```bash
cd demo
npm install

# 复制环境变量模板，填写 API Key 和访问密码
cp .env.example .env

# 开发模式（Vite 热更新，API Key 代理）
npm run dev

# 生产模式（Express 服务端 Agent + 流式 SSE）
npm start
```

### 环境变量（`demo/.env`）

| 变量 | 必填 | 说明 |
|------|------|------|
| `ACCESS_PASSWORD` | ✓ | 网站访问密码（密码保护登录页） |
| `SESSION_SECRET` | ✓ | Session 加密密钥，随机字符串即可 |
| `PROVIDER` | — | `anthropic`（默认）或 `deepseek` |
| `ANTHROPIC_API_KEY` | ✓* | Anthropic API Key，`PROVIDER=anthropic` 时必填 |
| `DEEPSEEK_API_KEY` | ✓* | DeepSeek API Key，`PROVIDER=deepseek` 时必填 |
| `DEEPSEEK_MODEL` | — | 覆盖 DeepSeek 模型名（可选） |
| `PORT` | — | 服务端口，默认 `3000` |

### 两种运行模式对比

| | `npm run dev` | `npm start` |
|---|---|---|
| 服务器 | Vite Dev Server | Express |
| API | 代理到上游（无认证） | 服务端 Agent，密码保护 |
| 流式 | ✗（`/api/explore` 返回 501） | ✓ NDJSON Streaming |
| 节点扩展 | ✗ | ✓ `/api/expand` |
| 适用场景 | 本地开发调试 | 部署 / 展示 |

---

## 嵌入到你的 React 项目

将 `index.jsx` 复制到项目任意目录，无其他依赖（仅需 React 18+）。

### 最简用法

```jsx
import KnowledgeTreeWidget from './knowledge-tree-agent'

// 直接传 apiKey（仅限本地开发，key 暴露在客户端）
export default function App() {
  return <KnowledgeTreeWidget apiKey="sk-ant-..." />
}
```

### 通过服务端代理（推荐，隐藏 API Key）

```jsx
// 使用 demo/server.js 启动的代理服务
<KnowledgeTreeWidget agentConfig={{ apiUrl: '/api/messages' }} />
```

### 自定义深度 & 分支数

```jsx
<KnowledgeTreeWidget
  agentConfig={{
    apiUrl: '/api/messages',
    maxLevel: 3,           // 树的最大深度
    branchFactor: [4, 3, 2], // 各层最大子节点数
    minRelevance: 7,       // 最低相关度阈值（1–10）
  }}
/>
```

---

## 使用 Hook 自定义 UI

`useKnowledgeTree` 管理状态，UI 完全由你控制。

```jsx
import { useKnowledgeTree, KnowledgeTreeView } from './knowledge-tree-agent'

function MyApp() {
  const kt = useKnowledgeTree({ apiUrl: '/api/messages' })

  return (
    <div>
      <input onKeyDown={e => e.key === 'Enter' && kt.explore(e.target.value)} />
      <button disabled={kt.busy} onClick={() => kt.explore('量子纠缠')}>
        探索
      </button>

      {/* 使用内置 View */}
      <KnowledgeTreeView
        nodes={kt.nodes}
        edges={kt.edges}
        selectedNode={kt.selectedNode}
        onNodeSelect={kt.setSelectedNode}
        onNodeExpand={kt.expand}    // 深度探索按钮回调
      />

      {/* 或完全自定义 */}
      <pre>{JSON.stringify(kt.tree, null, 2)}</pre>
    </div>
  )
}
```

### 服务端流式 Hook（`useStreamExplorer`）

当使用 `npm start` 运行 Express 服务端时，可替换为流式 Hook，树节点由服务端逐步推送：

```jsx
import { useStreamExplorer } from './demo/src/hooks/useStreamExplorer'
import { KnowledgeTreeView } from './knowledge-tree-agent'

function App() {
  const kt = useStreamExplorer({ maxLevel: 2 })
  // 接口与 useKnowledgeTree 完全相同，可直接替换
  return <KnowledgeTreeView {...kt} onNodeSelect={kt.setSelectedNode} onNodeExpand={kt.expand} />
}
```

---

## Node.js 后端 — 纯 Agent

`KnowledgeTreeAgent` 零框架依赖，可直接在 Node.js / Bun / Deno 中使用。

```js
import { KnowledgeTreeAgent } from './index.jsx'

const agent = new KnowledgeTreeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxLevel: 2,
  branchFactor: [3, 3, 2],
})

// 流式处理（推荐）
for await (const ev of agent.explore('丝绸之路')) {
  if (ev.type === 'node:done') {
    console.log(`[L${ev.node.level}] ${ev.node.label}: ${ev.node.explanation}`)
  }
}

// 或一次性获取完整树
const tree = await agent.run('量子纠缠')
console.log(JSON.stringify(tree, null, 2))
```

---

## API Reference

### `KnowledgeTreeAgent`

```js
new KnowledgeTreeAgent(config?)
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `config.apiKey` | `string` | — | API Key（Node.js 自动读 `ANTHROPIC_API_KEY`） |
| `config.apiUrl` | `string` | `https://api.anthropic.com/v1/messages` | API 端点 |
| `config.model` | `string` | `claude-sonnet-4-20250514` | 模型 ID |
| `config.maxLevel` | `number` | `2` | 树的最大深度（0 = 根） |
| `config.branchFactor` | `number[]` | `[3, 3, 2]` | 各层最大子节点数 |
| `config.maxTokens` | `number` | `1500` | 单次请求最大 tokens |
| `config.retries` | `number` | `2` | 失败重试次数 |
| `config.minRelevance` | `number` | `6` | 最低相关度阈值，低于此值的子概念被过滤 |

**方法：**

```js
agent.explore(concept: string): AsyncGenerator<AgentEvent>
agent.run(concept: string): Promise<TreeNode>  // 一次性，返回完整树
```

---

### Agent 事件（`explore()` yield）

| `type` | 附加字段 | 触发时机 |
|--------|----------|----------|
| `"start"` | `node, tree` | 根节点创建后 |
| `"node:loading"` | `node, tree` | 节点开始 LLM 请求 |
| `"node:done"` | `node, tree` | 节点请求成功 |
| `"node:error"` | `node, tree, error` | 节点最终失败 |
| `"complete"` | `tree` | 所有节点处理完毕 |

`tree` 是当前根节点引用（原地修改），`node` 是本次事件涉及的节点。

---

### `useKnowledgeTree(agentConfig?)`

```ts
const {
  tree,           // TreeNode | null — 当前树结构
  nodes,          // TreeNode[]    — flattenTree(tree)
  edges,          // [TreeNode, TreeNode][]  — 连线数组
  log,            // string[]      — Agent 运行日志
  busy,           // boolean       — 是否正在探索
  selectedNode,   // TreeNode | null
  setSelectedNode,
  explore,        // (concept: string) => void — 探索新概念
  expand,         // (nodeId: number) => void  — 深度探索叶节点
} = useKnowledgeTree(agentConfig)
```

> `useStreamExplorer` 返回完全相同的接口，可直接替换。

---

### `KnowledgeTreeView` props

| prop | 类型 | 必填 | 说明 |
|------|------|------|------|
| `nodes` | `TreeNode[]` | ✓ | `flattenTree` 的结果 |
| `edges` | `[TreeNode, TreeNode][]` | ✓ | `getTreeEdges` 的结果 |
| `selectedNode` | `TreeNode \| null` | — | 当前选中节点 |
| `onNodeSelect` | `(node) => void` | — | 节点点击回调 |
| `onNodeExpand` | `(nodeId) => void` | — | 深度探索按钮（`+`）点击回调 |

---

### `KnowledgeTreeWidget` props

| prop | 类型 | 说明 |
|------|------|------|
| `apiKey` | `string` | Anthropic API Key（可选，建议用代理） |
| `agentConfig` | `object` | 覆盖 `AGENT_DEFAULTS` 的任意字段 |

---

### Demo 服务端 API（`demo/server.js`）

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/messages` | POST | LLM 代理（转发给上游 API，供前端 Agent 使用） |
| `/api/explore` | POST | 服务端流式探索，NDJSON streaming |
| `/api/expand` | POST | 单节点深度扩展 |
| `/api/health` | GET | 健康检查，返回 `{ ok, provider, time }` |

**`/api/explore` 请求体：**
```json
{ "concept": "量子纠缠", "maxLevel": 2, "branchFactor": [3, 3, 2], "minRelevance": 6 }
```

**`/api/explore` 流式事件格式（每行一个 JSON）：**
```
{"type":"start","node":{...}}
{"type":"node:loading","node":{...}}
{"type":"node:done","node":{...}}
{"type":"complete"}
```

---

### TreeNode 结构

```ts
interface TreeNode {
  id:                 number        // 自增唯一 ID
  label:              string        // 概念名称
  level:              number        // 层级（0 = 根）
  explanation:        string        // Claude 生成的费曼故事
  relevance:          number | null // 相关度评分（1–10），根节点为 null
  hasStrongRelations: boolean | null // null=未评估，false=无子概念可展开
  children:           TreeNode[]    // 子节点
  status:             'pending' | 'loading' | 'done' | 'error'
  x:                  number        // SVG 布局坐标（treeLayout 计算）
  y:                  number
}
```

---

### Utility 工具函数

```js
import { treeLayout, flattenTree, getTreeEdges, mkNode, AGENT_DEFAULTS, LEVEL_COLORS } from './index.jsx'

treeLayout(root, W?)     // 原地计算节点 x/y 坐标，W 为画布宽度（默认 1100）
flattenTree(root)         // 返回所有节点的扁平数组
getTreeEdges(root)        // 返回所有 [父节点, 子节点] 连线对
mkNode(label, level, relevance?)  // 创建新节点
```

**`AGENT_DEFAULTS`：**
```js
{
  apiUrl:       "https://api.anthropic.com/v1/messages",
  model:        "claude-sonnet-4-20250514",
  maxLevel:     2,
  maxTokens:    1500,
  retries:      2,
  branchFactor: [3, 3, 2],
  minRelevance: 6,
}
```
