# 知识图谱探索者 · Knowledge Graph Explorer

<div align="center">

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-18%2B-green.svg)](#)
[![React](https://img.shields.io/badge/react-18-61dafb.svg)](#)
[![Claude](https://img.shields.io/badge/powered%20by-Claude%20AI-blueviolet)](#)

**费曼学习法 · 反幻觉 · 多根关联 · 3D 可视化**

**Feynman Method · Anti-hallucination · Multi-root · 3D Visualization**

![Knowledge Graph Explorer](https://img.shields.io/badge/status-active-success.svg)

</div>

---

## 简介 | Overview

**中文**

知识图谱探索者是一个基于 Claude AI 的交互式知识树构建工具。输入任意概念，AI Agent 自动递归拆解子概念，构建层级化知识图谱。支持多棵知识树同时展示、跨树关联分析，以及沉浸式 3D 可视化。

**English**

An interactive knowledge graph builder powered by Claude AI. Enter any concept and the AI agent recursively decomposes it into sub-concepts, building a hierarchical knowledge tree. Supports multiple concurrent trees, cross-tree association analysis, and an immersive 3D visualization mode.

---

## 核心特性 | Features

| 特性 | Feature | 说明 |
|------|---------|------|
| 🌲 多根知识树 | Multi-root Trees | 最多同时构建 4 棵知识树，水平并排展示 |
| 🧠 递归 AI 拆解 | Recursive AI Decomposition | Claude 逐层展开子概念，过滤弱相关节点 |
| 🔗 跨树关联分析 | Cross-tree Analysis | 自动发现不同知识树之间的语义关联 |
| ⟷ 关联模式 | Association Mode | 手动选择 2-4 个节点，分析多维关联关系 |
| 🌐 3D 可视化 | 3D Visualization | Three.js 驱动的球形节点 + 后期处理特效 |
| 🎞 GSAP 动画 | GSAP Animations | 弹性进场、stagger 列表、实时浮动效果 |
| 🎵 Web Audio 音效 | Web Audio FX | 生成式环境音乐 + 节点交互音效 |
| 👤 用户系统 | Auth System | Session 登录 + 管理员后台 |
| ⚙ 个性化偏好 | User Preferences | 叙事风格、背景设定、LLM 输出语言 |
| 🔒 反幻觉机制 | Anti-hallucination | 严格 Prompt 约束，宁可返回空也不编造 |

---

## 技术栈 | Tech Stack

| 层 | 技术 |
|----|------|
| 前端框架 | React 18 + Vite |
| 3D 引擎 | Three.js · React Three Fiber · Drei |
| 后期处理 | @react-three/postprocessing (Bloom, ChromaticAberration) |
| 动画 | GSAP 3 + @gsap/react (`useGSAP`) |
| 后端 | Node.js + Express |
| AI | Anthropic Claude API (claude-sonnet-4) |
| 认证 | Express-session + scrypt 密码哈希 |
| 部署 | 静态构建 (Vite) + Express 服务端渲染 |

---

## 快速开始 | Quick Start

### 1. 克隆仓库 | Clone

```bash
git clone https://github.com/Lew1sWong/knowledge-tree-agent.git
cd knowledge-tree-agent
```

### 2. 安装依赖 | Install

```bash
npm install
```

### 3. 配置环境变量 | Environment

创建 `.env` 文件 | Create `.env`:

```env
ANTHROPIC_API_KEY=your_claude_api_key

# 可选 | Optional
PORT=3000
SESSION_SECRET=your_session_secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123

# 使用 DeepSeek 替代 Anthropic | Use DeepSeek instead of Anthropic
# PROVIDER=deepseek
# DEEPSEEK_API_KEY=your_deepseek_api_key
```

### 4. 开发模式 | Development

```bash
# 启动前端开发服务器
npm run dev

# 启动后端服务器（另开终端）
node server.js
```

### 5. 生产部署 | Production

```bash
# 构建前端
npm run build

# 启动服务（同时服务前端静态文件和 API）
node server.js
```

访问 | Open: `http://localhost:3000`

---

## 使用指南 | Usage

### 构建知识树 | Build a Knowledge Tree

1. 在搜索框输入任意概念（如「量子纠缠」「李白」「牛顿」）
2. 选择探索深度 **L1–L4**（L1 = 1 层子概念，L4 = 4 层递归）
3. 点击「添加根」，AI 开始自动构建

> ⚠️ L3/L4 深度会产生大量 API 调用，请注意用量。

### 多树关联 | Multi-tree Analysis

- 添加 2-4 棵不同主题的知识树
- 点击「⟷ 分析关联」，AI 自动发现跨树语义连接
- 虚线代表跨树关联，强度由颜色和粒子速度体现

### 关联模式 | Association Mode

1. 点击「⟷ 关联模式」进入选择状态
2. 点击任意节点（最多 4 个）加入分析
3. 点击「分析关联」，获取详细的节点对关联报告
4. 可将关联结果「提取为新知识树」

### 3D 模式 | 3D Mode

默认启用 3D 球形节点画布，支持：
- 拖拽旋转、滚轮缩放、右键平移
- 点击节点查看详情
- 点击 `+` 按钮深度探索叶节点

---

## 管理后台 | Admin Panel

访问 `/admin`（需要管理员账号）：

- 创建 / 删除用户
- 重置用户密码
- 配置最大知识树数量（全局限制）

---

## 项目结构 | Project Structure

```
knowledge-tree-agent/
├── index.jsx          # 核心组件库（Widget、Hook、SVG Canvas、GSAP 动画）
├── src/
│   ├── App.jsx        # 应用入口
│   ├── main.jsx       # React 挂载点
│   └── TreeCanvas3D.jsx  # 3D Three.js 画布
├── server.js          # Express 后端（API、认证、LLM 代理）
├── config.json        # 运行时配置（maxTrees 等）
├── users.json         # 用户数据（自动生成）
├── index.html         # HTML 入口
├── vite.config.js     # Vite 配置
└── package.json
```

---

## API 接口 | API Endpoints

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/messages` | LLM 代理（前端直接调用 Claude） |
| POST | `/api/explore` | 服务端流式构建知识树（NDJSON） |
| POST | `/api/expand` | 单节点深度展开 |
| POST | `/api/cross-relations` | 跨树关联分析 |
| POST | `/api/association` | 多节点（2-4）关联分析 |
| POST | `/api/auto-relations` | 自动发现与 pivot 节点相关的节点 |
| GET  | `/api/me` | 当前用户信息 & 偏好 |
| PUT  | `/api/settings` | 保存用户偏好 |
| GET  | `/api/config` | 系统配置（maxTrees） |

---

## 反幻觉机制 | Anti-hallucination

系统通过严格的 Prompt 约束防止 AI 编造关联：

- **子概念** = 父概念的「直接组成部分」「核心属性」「内部机制」
- 禁止列入：同级概念、更大范畴概念、仅时代/地理关联
- `relevance < 5` 的子概念被自动过滤
- `has_strong_relations = false` 时，知识树在此节点终止延伸

---

## 路线图 | Roadmap

- [x] 多根知识树并排展示
- [x] 3D 球形节点可视化
- [x] GSAP 动画系统
- [x] 关联模式（多节点分析）
- [x] 用户系统 + 管理后台
- [x] L1–L4 深度选择
- [ ] 知识树导出（JSON / PNG）
- [ ] 节点编辑 & 手动添加
- [ ] 移动端手势优化
- [ ] 知识树分享链接

---

## 开源协议 | License

MIT License — 自由使用、修改与分发。

---

<div align="center">

作者 | Author: [Lewis Wong](https://github.com/Lew1sWong)

⭐ 如果这个项目对你有帮助，欢迎 Star！

⭐ If you find this useful, please give it a star!

</div>
