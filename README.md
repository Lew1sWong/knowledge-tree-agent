# 🌳 Knowledge Tree Agent

<div align="center">

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.10%2B-green.svg)](#)
[![Status](https://img.shields.io/badge/status-active-success.svg)](#)

**A modular AI agent framework powered by hierarchical knowledge structures, memory systems, and autonomous reasoning.**

**一个基于知识树结构、长期记忆与自主推理的模块化 AI Agent 框架。**

</div>

---

# 📖 Overview | 项目简介

## English

Knowledge Tree Agent is an experimental agent framework designed around the concept of a structured and evolving “knowledge tree”.

Instead of treating memory as flat context, the system organizes information hierarchically, enabling:

* Better long-term reasoning
* More controllable retrieval
* Dynamic skill accumulation
* Persistent contextual memory
* Modular agent collaboration

The project explores how agents can continuously grow their internal knowledge graph/tree while remaining lightweight, interpretable, and extensible.

---

## 中文

Knowledge Tree Agent 是一个围绕“知识树（Knowledge Tree）”概念构建的实验性 AI Agent 框架。

与传统的平面上下文记忆不同，本项目将知识以层级化结构进行组织，从而实现：

* 更强的长期推理能力
* 更可控的信息检索
* 动态技能积累
* 持久化上下文记忆
* 模块化 Agent 协作

项目核心目标是探索：Agent 如何在保持轻量化、可解释性与可扩展性的同时，不断成长自己的知识结构。

---

# ✨ Features | 核心特性

| Feature                        | Description                                  |
| ------------------------------ | -------------------------------------------- |
| 🌲 Knowledge Tree Architecture | Hierarchical memory & knowledge organization |
| 🧠 Persistent Memory           | Long-term contextual storage                 |
| ⚡ Lightweight Design           | Minimal and modular architecture             |
| 🔌 Extensible Tools            | Easy tool/plugin integration                 |
| 🤖 Autonomous Reasoning        | Multi-step agent execution                   |
| 📚 Skill Accumulation          | Experience-based capability growth           |
| 🔍 Structured Retrieval        | Tree-based retrieval instead of flat search  |
| 🛠 Developer Friendly          | Designed for experimentation and research    |

---

# 🏗 Architecture | 系统架构

```text
User Input
    ↓
Planner / Router
    ↓
Knowledge Tree Engine
    ├── Memory Layer
    ├── Retrieval Layer
    ├── Skill Layer
    ├── Tool Layer
    └── Reflection Layer
    ↓
LLM Reasoning Core
    ↓
Execution / Response
```

---

# 📂 Project Structure | 项目结构

```bash
knowledge-tree-agent/
├── agents/              # Agent definitions
├── memory/              # Persistent memory storage
├── skills/              # Reusable agent skills
├── tools/               # Tool integrations
├── knowledge/           # Knowledge tree / graph
├── prompts/             # Prompt templates
├── workflows/           # Agent workflows
├── configs/             # Runtime configurations
├── examples/            # Demo examples
├── tests/               # Unit tests
├── docs/                # Documentation
└── README.md
```

> Adjust this structure according to your actual repository.
>
> 可以根据你的实际仓库结构进行修改。

---

# 🚀 Quick Start | 快速开始

## 1. Clone Repository | 克隆仓库

```bash
git clone https://github.com/Lew1sWong/knowledge-tree-agent.git
cd knowledge-tree-agent
```

---

## 2. Install Dependencies | 安装依赖

### Python

```bash
pip install -r requirements.txt
```

### Or using uv

```bash
uv sync
```

---

## 3. Configure Environment | 配置环境变量

Create a `.env` file:

```env
OPENAI_API_KEY=your_api_key
ANTHROPIC_API_KEY=your_api_key
```

---

## 4. Run the Agent | 启动 Agent

```bash
python main.py
```

Or:

```bash
uv run main.py
```

---

# 🧠 Knowledge Tree Concept | 知识树核心概念

## English

Traditional RAG systems often rely on flat vector retrieval.

Knowledge Tree Agent instead organizes knowledge into hierarchical semantic branches:

```text
Root
├── Programming
│   ├── Python
│   ├── AI
│   └── Systems
├── Research
│   ├── Papers
│   └── Experiments
└── Personal Memory
    ├── Preferences
    └── History
```

This structure allows the agent to:

* Navigate knowledge semantically
* Reduce retrieval noise
* Improve reasoning efficiency
* Maintain interpretable memory paths

---

## 中文

传统 RAG 系统通常采用“平面向量检索”的方式。

Knowledge Tree Agent 则尝试将知识组织为层级化语义结构：

```text
根节点
├── 编程
│   ├── Python
│   ├── AI
│   └── 系统设计
├── 研究
│   ├── 论文
│   └── 实验
└── 用户记忆
    ├── 偏好
    └── 历史记录
```

这种结构能够帮助 Agent：

* 更语义化地导航知识
* 降低检索噪声
* 提高推理效率
* 保持记忆路径可解释

---

# 🔄 Workflow | 工作流

```text
Task Input
    ↓
Task Planning
    ↓
Knowledge Retrieval
    ↓
Memory Injection
    ↓
Tool Execution
    ↓
Reflection & Update
    ↓
Knowledge Tree Growth
```

---

# 🛠 Tech Stack | 技术栈

| Category   | Technology                      |
| ---------- | ------------------------------- |
| Language   | Python / TypeScript             |
| LLM        | OpenAI / Anthropic / Gemini     |
| Vector DB  | Chroma / FAISS / Milvus         |
| Framework  | LangChain / LlamaIndex / Custom |
| Memory     | File-based / Graph-based        |
| Deployment | Docker / Local / Cloud          |

> Replace with your actual stack.
>
> 请根据实际技术栈替换。

---

# 📸 Demo | 演示

## Example Prompt

```text
Summarize all AI agent research related to memory systems.
```

## Example Behavior

* Retrieves related nodes from the knowledge tree
* Injects long-term memory
* Uses tools if necessary
* Generates structured reasoning
* Updates memory tree after completion

---

# 🔬 Research Direction | 研究方向

This project explores topics including:

* Agent memory systems
* Hierarchical retrieval
* Autonomous knowledge growth
* Multi-agent collaboration
* Tree-based reasoning
* Lightweight agent architecture
* Long-context optimization

---

# 🗺 Roadmap | 路线图

## Near Term

* [ ] Knowledge tree visualization
* [ ] Memory compression
* [ ] Reflection system
* [ ] Multi-agent coordination
* [ ] Tool sandboxing

## Future

* [ ] Self-evolving skills
* [ ] Distributed memory network
* [ ] Graph reasoning engine
* [ ] Reinforcement learning integration
* [ ] Agent operating system

---

# 🤝 Contributing | 贡献指南

Contributions are welcome.

You can contribute by:

* Opening issues
* Submitting pull requests
* Improving documentation
* Adding tools or memory modules
* Experimenting with new retrieval methods

---

# 📜 License | 开源协议

MIT License.

Feel free to use, modify, and distribute.

---

# 🌟 Inspiration | 灵感来源

This project is inspired by modern agent systems and memory-centric AI research, including:

* [GenericAgent GitHub Repository](https://github.com/lsdefine/GenericAgent?utm_source=chatgpt.com)
* [GitAgent Protocol](https://www.gitagent.sh/?utm_source=chatgpt.com)
* [Vercel Knowledge Agent Template](https://github.com/vercel-labs/knowledge-agent-template?utm_source=chatgpt.com)
* Hierarchical memory and graph-based reasoning research

---

# 👨‍💻 Author | 作者

Created by [Lewis Wong GitHub](https://github.com/Lew1sWong?utm_source=chatgpt.com)

---

<div align="center">

### ⭐ If you find this project interesting, consider giving it a star.

### ⭐ 如果这个项目对你有帮助，欢迎点一个 Star！

</div>
