/**
 * demo/server.js  —  知识树 Agent Demo 服务端 v3
 * ═══════════════════════════════════════════════════════════════
 *
 *  § A  配置 & 工具函数
 *  § B  用户系统（crypto.scrypt 哈希 + users.json 持久化）
 *  § C  限流中间件
 *  § D  LLM 服务层
 *  § E  知识树构建服务（服务端 Agent）
 *  § F  Auth 中间件 & 登录/登出路由
 *  § G  管理员后台路由
 *  § H  API 路由
 *  § I  静态文件服务 & 启动
 */

import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const scryptAsync = promisify(scrypt);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ══════════════════════════════════════════════════════════════════
// § A  配置 & 工具函数
// ══════════════════════════════════════════════════════════════════

const PORT     = Number(process.env.PORT) || 3000;
const PROVIDER = (process.env.PROVIDER || "anthropic").toLowerCase();
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const USERS_FILE = path.join(__dirname, "users.json");

function getLLMConfig() {
  if (PROVIDER === "deepseek") {
    return {
      url:   "https://api.deepseek.com/anthropic/v1/messages",
      key:   process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || "deepseek-reasoner",
    };
  }
  return {
    url:   "https://api.anthropic.com/v1/messages",
    key:   process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
  };
}

// ══════════════════════════════════════════════════════════════════
// § B  用户系统
// ══════════════════════════════════════════════════════════════════

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const buf  = await scryptAsync(password, salt, 64);
  return `${salt}:${buf.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const derivedBuf = await scryptAsync(password, salt, 64);
  const storedBuf  = Buffer.from(hash, "hex");
  return derivedBuf.length === storedBuf.length &&
    timingSafeEqual(derivedBuf, storedBuf);
}

function loadUsers() {
  try {
    if (existsSync(USERS_FILE)) return JSON.parse(readFileSync(USERS_FILE, "utf8"));
  } catch (_) {}
  return [];
}

function saveUsers(users) {
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

// 启动时确保有 admin 账户
async function ensureAdminUser() {
  let users = loadUsers();
  const hasAdmin = users.some(u => u.role === "admin");
  if (!hasAdmin) {
    const passwordHash = await hashPassword(ADMIN_PASSWORD);
    users.push({
      id:           randomBytes(8).toString("hex"),
      username:     ADMIN_USERNAME,
      passwordHash,
      role:         "admin",
      createdAt:    new Date().toISOString(),
      preferences:  { ...DEFAULT_PREFS },
    });
    saveUsers(users);
    console.log(`  管理员账户已创建: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
  }
}

// ══════════════════════════════════════════════════════════════════
// § C  限流中间件（令牌桶，每用户每分钟 20 次 API 调用）
// ══════════════════════════════════════════════════════════════════

const _buckets = new Map();
const BUCKET_MAX = 20;
const REFILL_MS  = 60_000;

function rateLimitMiddleware(req, res, next) {
  const key = req.session?.userId || req.ip || "unknown";
  const now = Date.now();
  let bucket = _buckets.get(key);
  if (!bucket || now - bucket.lastRefill > REFILL_MS) {
    bucket = { tokens: BUCKET_MAX, lastRefill: now };
  }
  if (bucket.tokens <= 0) {
    return res.status(429).json({ error: { message: "请求过于频繁，请稍后重试（每分钟最多 20 次）" } });
  }
  bucket.tokens -= 1;
  _buckets.set(key, bucket);
  if (_buckets.size > 2000) {
    for (const [k, v] of _buckets) {
      if (now - v.lastRefill > REFILL_MS * 5) _buckets.delete(k);
    }
  }
  next();
}

// ══════════════════════════════════════════════════════════════════
// § D  LLM 服务层
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

function _buildPrompt(label, level, isLeaf, n, parentLabel = null) {
  const fmt = isLeaf
    ? `{"explanation":"...","has_strong_relations":false,"subconcepts":[]}`
    : `{"explanation":"...","has_strong_relations":true,"subconcepts":[{"label":"子概念","relevance":8}]}`;
  const ctx = parentLabel
    ? `上下文：「${label}」是「${parentLabel}」的直接子概念，explanation 须体现与「${parentLabel}」的具体关联\n`
    : "";
  return `${ctx}概念：「${label}」（层级 ${level}，${isLeaf ? "叶节点" : `期望最多 ${n} 个子概念`}）\n\n只输出 JSON，格式参考：\n${fmt}`;
}

function _parseJSON(text) {
  text = text.replace(/```json\s*|```\s*/g, "").trim();
  try { return JSON.parse(text); } catch (_) {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error("JSON 解析失败: " + text.slice(0, 100));
}

async function callLLM(label, level, opts = {}) {
  const { url, key, model } = getLLMConfig();
  const maxLevel     = opts.maxLevel    ?? 2;
  const branchFactor = opts.branchFactor ?? [3, 3, 2];
  const retries      = opts.retries     ?? 2;
  const parentLabel  = opts.parentLabel ?? null;
  const prefs        = opts.prefs       ?? {};
  const uiLang       = opts.uiLang      ?? "zh";
  const isLeaf = level >= maxLevel;
  const n = branchFactor[level] ?? 2;

  const body = JSON.stringify({
    model,
    max_tokens: 1500,
    system: buildSystemPrompt(prefs, uiLang),
    messages: [{ role: "user", content: _buildPrompt(label, level, isLeaf, n, parentLabel) }],
  });
  const headers = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    "x-api-key": key,
  };
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { method: "POST", headers, body });
      const d = await res.json();
      if (d.error) throw new Error(d.error.message);
      return _parseJSON(d.content?.map(b => b.text ?? "").join("") ?? "");
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 900 * (i + 1)));
    }
  }
}

// 跨树关联分析
async function findCrossRelations(roots) {
  const { url, key, model } = getLLMConfig();
  const rootDescriptions = roots.map((r, i) =>
    `树${i + 1}「${r.concept}」的节点：${r.nodeLabels.join("、")}`
  ).join("\n");

  const prompt = `以下是来自不同知识树的概念节点，请找出不同知识树之间有意义的横向关联（跨树的相似性、影响关系或共同主题）：

${rootDescriptions}

输出 JSON，格式如下（connections 数组，每项表示两个不同树节点间的关联）：
{"connections":[{"from":"节点名","fromTree":1,"to":"节点名","toTree":2,"reason":"关联原因","strength":7}]}

规则：
- strength 1-10，只保留 strength ≥ 5 的
- from 和 to 必须来自不同树
- 最多返回 8 条最强关联
- 宁可少，不编造
仅输出 JSON，无 markdown。`;

  const body = JSON.stringify({
    model,
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });
  const headers = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    "x-api-key": key,
  };
  const res = await fetch(url, { method: "POST", headers, body });
  const d   = await res.json();
  if (d.error) throw new Error(d.error.message);
  return _parseJSON(d.content?.map(b => b.text ?? "").join("") ?? "");
}

// 节点对关联分析
async function findNodeRelation(labelA, labelB) {
  const { url, key, model } = getLLMConfig();
  const prompt = `分析两个知识概念之间的关联性：
概念A：「${labelA}」
概念B：「${labelB}」

输出 JSON（仅 JSON，无 markdown）：
{"strength":7,"relation":"关联类型（相似/因果/包含/互补/对立等）","reason":"2-3句具体说明两者的知识关联","sharedThemes":["共同主题1","共同主题2"]}

strength 1-10，strength < 4 时 relation 填"弱关联"。`;

  const body = JSON.stringify({ model, max_tokens: 600, messages: [{ role: "user", content: prompt }] });
  const headers = { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key };
  const res = await fetch(url, { method: "POST", headers, body });
  const d   = await res.json();
  if (d.error) throw new Error(d.error.message);
  return _parseJSON(d.content?.map(b => b.text ?? "").join("") ?? "");
}

// 自动关联：从候选概念中找出与 pivot 关联最强的（最多3条）
async function rankNodeRelations(pivot, candidates) {
  const { url, key, model } = getLLMConfig();
  const prompt = `以「${pivot}」为核心概念，从以下候选概念中找出知识关联最强的（最多3个，strength ≥ 7才选）：

候选概念：${candidates.map((c, i) => `${i + 1}. ${c}`).join("、")}

输出 JSON（仅 JSON，无 markdown）：
{"relations":[{"label":"候选概念名","strength":8,"reason":"关联原因一句话"}]}

按 strength 降序，strength < 7 的不选，若无满足条件的则 relations 为空数组。`;

  const body = JSON.stringify({ model, max_tokens: 700, messages: [{ role: "user", content: prompt }] });
  const headers = { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key };
  const res = await fetch(url, { method: "POST", headers, body });
  const d   = await res.json();
  if (d.error) throw new Error(d.error.message);
  return _parseJSON(d.content?.map(b => b.text ?? "").join("") ?? "");
}

// ══════════════════════════════════════════════════════════════════
// § E  知识树构建服务（服务端 Agent）
// ══════════════════════════════════════════════════════════════════

let _sid = 0;

function mkSNode(label, level, relevance = null) {
  return { id: _sid++, label, level, explanation: "", relevance, hasStrongRelations: null, children: [], status: "pending" };
}

async function* buildTree(concept, opts = {}) {
  _sid = 0;
  const maxLevel     = opts.maxLevel    ?? 2;
  const branchFactor = opts.branchFactor ?? [3, 3, 2];
  const minRelevance = opts.minRelevance ?? 6;
  const prefs        = opts.prefs       ?? {};
  const uiLang       = opts.uiLang      ?? "zh";

  const root = mkSNode(concept.trim(), 0);
  yield { type: "start", node: _nodeSnapshot(root) };

  const queue = [root];
  while (queue.length) {
    const node = queue.shift();
    node.status = "loading";
    yield { type: "node:loading", node: _nodeSnapshot(node) };
    try {
      const data = await callLLM(node.label, node.level, { maxLevel, branchFactor, parentLabel: node.parentLabel ?? null, prefs, uiLang });
      node.explanation = data.explanation ?? "";
      node.hasStrongRelations = data.has_strong_relations ?? (data.subconcepts?.length > 0);

      if (node.hasStrongRelations && Array.isArray(data.subconcepts) && node.level < maxLevel) {
        const limit = branchFactor[node.level] ?? 2;
        data.subconcepts
          .filter(s => (s.relevance ?? 10) >= minRelevance)
          .slice(0, limit)
          .forEach(s => {
            const child = mkSNode(String(s.label).trim(), node.level + 1, s.relevance);
            child.parentLabel = node.label;
            node.children.push(child);
            queue.push(child);
          });
      }
      node.status = "done";
      yield { type: "node:done", node: _nodeSnapshot(node) };
    } catch (err) {
      node.status = "error";
      yield { type: "node:error", node: _nodeSnapshot(node), error: err.message };
    }
  }
  yield { type: "complete" };
}

function _nodeSnapshot(n) {
  return { id: n.id, label: n.label, level: n.level, explanation: n.explanation, relevance: n.relevance, hasStrongRelations: n.hasStrongRelations, status: n.status, childIds: n.children.map(c => c.id) };
}

// ══════════════════════════════════════════════════════════════════
// § F  Auth 中间件 & 登录/登出路由
// ══════════════════════════════════════════════════════════════════

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || "kt-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true },
}));

function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "未登录" });
  res.redirect("/login");
}

function requireAdmin(req, res, next) {
  if (req.session?.role === "admin") return next();
  res.status(403).send("无权限");
}

// ── 登录页错误消息映射 ──────────────────────────────────────────────
const LOGIN_ERRORS = {
  missing_fields:       { zh: "请填写用户名和密码",   en: "Please enter username and password" },
  invalid_credentials:  { zh: "用户名或密码错误",     en: "Invalid username or password" },
};

// ── 登录页 HTML（中英双语，动画粒子背景）────────────────────────────
const LOGIN_HTML = (errKey = "", username = "") => {
  const errHTML = errKey && LOGIN_ERRORS[errKey]
    ? `<div class="err">
        <span class="t" data-zh="${LOGIN_ERRORS[errKey].zh}" data-en="${LOGIN_ERRORS[errKey].en}">${LOGIN_ERRORS[errKey].zh}</span>
      </div>`
    : "";
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title data-zh="知识图谱探索者 — 登录" data-en="Knowledge Graph Explorer — Login">知识图谱探索者 — 登录</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:#07070d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden}
canvas#bg{position:fixed;inset:0;pointer-events:none;z-index:0}
.wrap{position:relative;z-index:1;width:100%;max-width:400px;padding:20px}
.card{background:rgba(12,12,24,0.85);border:1px solid rgba(245,158,11,0.18);
  border-radius:18px;padding:44px 40px 38px;
  box-shadow:0 0 60px rgba(245,158,11,0.06),0 32px 80px rgba(0,0,0,0.7);
  backdrop-filter:blur(24px)}
.logo{display:flex;align-items:center;gap:12px;margin-bottom:6px}
.logo-icon{width:40px;height:40px;border-radius:12px;
  background:linear-gradient(135deg,#1c0e00,#2a1500);
  border:1px solid rgba(245,158,11,0.35);
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
  box-shadow:0 0 20px rgba(245,158,11,0.12)}
.logo h1{font-size:19px;font-weight:600;color:#e8e0cc;letter-spacing:-.01em}
.sub{font-size:11px;color:#3a3020;margin-bottom:32px;padding-left:52px}
.field{margin-bottom:16px}
label{display:block;font-size:11px;color:#4a4038;letter-spacing:.06em;
  text-transform:uppercase;margin-bottom:7px;font-weight:500}
input{width:100%;padding:11px 15px;background:rgba(6,6,14,0.8);
  border:1px solid rgba(255,255,255,0.07);border-radius:10px;
  color:#d8d0c8;font-size:14px;outline:none;
  transition:border-color .2s,box-shadow .2s;font-family:inherit}
input:focus{border-color:rgba(245,158,11,0.45);
  box-shadow:0 0 0 3px rgba(245,158,11,0.06)}
input::placeholder{color:#2a2820}
.err{color:#f87171;font-size:12px;margin-bottom:16px;padding:10px 13px;
  background:rgba(248,113,113,0.06);border:1px solid rgba(248,113,113,0.2);
  border-radius:8px;display:flex;align-items:center;gap:7px}
.err::before{content:"⚠";font-size:13px}
button[type=submit]{width:100%;padding:12px;margin-top:6px;
  background:linear-gradient(135deg,#1c0e00 0%,#2a1800 100%);
  border:1px solid rgba(245,158,11,0.5);border-radius:10px;
  color:#fcd34d;font-size:14px;font-weight:600;cursor:pointer;
  transition:all .2s;font-family:inherit;letter-spacing:.02em;
  box-shadow:0 0 20px rgba(245,158,11,0.08)}
button[type=submit]:hover{border-color:rgba(245,158,11,0.9);background:linear-gradient(135deg,#221200,#301e00);
  box-shadow:0 0 30px rgba(245,158,11,0.18);transform:translateY(-1px)}
button[type=submit]:active{transform:translateY(0)}
.hint{margin-top:20px;text-align:center;font-size:11px;color:#2a2820}
.lang-btn{position:absolute;top:16px;right:16px;padding:4px 10px;border-radius:6px;
  font-size:11px;cursor:pointer;border:1px solid #2a2a3e;background:transparent;
  color:#6060a0;font-family:inherit;transition:all .15s;letter-spacing:.04em;z-index:2}
.lang-btn:hover{border-color:#4a4a6e;color:#9090c8}
</style>
</head>
<body>
<canvas id="bg"></canvas>
<button class="lang-btn" id="langBtn" onclick="toggleLang()">EN</button>
<div class="wrap">
<div class="card">
  <div class="logo">
    <div class="logo-icon">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#f59e0b" stroke-width="1.6">
        <circle cx="12" cy="5" r="2.8"/><circle cx="5" cy="19" r="2.3"/><circle cx="12" cy="19" r="2.3"/><circle cx="19" cy="19" r="2.3"/>
        <line x1="12" y1="7.8" x2="5" y2="16.7"/><line x1="12" y1="7.8" x2="12" y2="16.7"/><line x1="12" y1="7.8" x2="19" y2="16.7"/>
      </svg>
    </div>
    <h1 class="t" data-zh="知识图谱探索者" data-en="Knowledge Graph Explorer">知识图谱探索者</h1>
  </div>
  <div class="sub t" data-zh="费曼学习法 · 反幻觉 AI Agent · 多维知识网络" data-en="Feynman Method · Anti-hallucination AI · Multi-dimensional Network">费曼学习法 · 反幻觉 AI Agent · 多维知识网络</div>
  ${errHTML}
  <form method="POST" action="/login">
    <div class="field">
      <label class="t" data-zh="用户名" data-en="Username">用户名</label>
      <input type="text" name="username" value="${username}" class="t-ph" data-ph-zh="请输入用户名" data-ph-en="Enter username" placeholder="请输入用户名" autocomplete="username" autofocus>
    </div>
    <div class="field">
      <label class="t" data-zh="密码" data-en="Password">密码</label>
      <input type="password" name="password" placeholder="••••••••" autocomplete="current-password">
    </div>
    <button type="submit" class="t" data-zh="登&nbsp;&nbsp;录" data-en="Sign In">登&nbsp;&nbsp;录</button>
  </form>
  <div class="hint t" data-zh="账户由管理员创建 · 如需帮助请联系管理员" data-en="Accounts are created by admin · Contact admin for help">账户由管理员创建 · 如需帮助请联系管理员</div>
</div>
</div>
<script>
const c=document.getElementById('bg'),ctx=c.getContext('2d');
let W,H,pts=[];
function init(){W=c.width=innerWidth;H=c.height=innerHeight;pts=Array.from({length:80},()=>({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.3,vy:(Math.random()-.5)*.3,r:Math.random()*1.5+.5,a:Math.random()}))}
function draw(){ctx.clearRect(0,0,W,H);pts.forEach(p=>{p.x+=p.vx;p.y+=p.vy;if(p.x<0||p.x>W)p.vx*=-1;if(p.y<0||p.y>H)p.vy*=-1;p.a=.3+.25*Math.sin(Date.now()*.001+p.x);ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,6.28);ctx.fillStyle=\`rgba(245,158,11,\${p.a*0.4})\`;ctx.fill()});
pts.forEach((p,i)=>pts.slice(i+1).forEach(q=>{const d=Math.hypot(p.x-q.x,p.y-q.y);if(d<120){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.strokeStyle=\`rgba(245,158,11,\${.08*(1-d/120)})\`;ctx.lineWidth=.6;ctx.stroke()}}));
requestAnimationFrame(draw)}
init();draw();window.addEventListener('resize',init);
let curLang=localStorage.getItem('kt-lang')||'zh';
function applyLang(lang){
  document.querySelectorAll('.t').forEach(el=>{
    const v=el.dataset[lang];
    if(v!==undefined)el.innerHTML=v;
  });
  document.querySelectorAll('.t-ph').forEach(el=>{
    const v=lang==='zh'?el.dataset.phZh:el.dataset.phEn;
    if(v)el.placeholder=v;
  });
  document.getElementById('langBtn').textContent=lang==='zh'?'EN':'中文';
  document.documentElement.lang=lang==='zh'?'zh':'en';
  document.title=lang==='zh'?'知识图谱探索者 — 登录':'Knowledge Graph Explorer — Login';
}
function toggleLang(){curLang=curLang==='zh'?'en':'zh';localStorage.setItem('kt-lang',curLang);applyLang(curLang);}
applyLang(curLang);
</script>
</body>
</html>`;
};

app.get("/login", (req, res) => {
  if (req.session?.userId) return res.redirect("/");
  res.send(LOGIN_HTML());
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.send(LOGIN_HTML("missing_fields", username));
  const users = loadUsers();
  const user  = users.find(u => u.username === username);
  if (!user) return res.send(LOGIN_HTML("invalid_credentials", username));
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return res.send(LOGIN_HTML("invalid_credentials", username));
  req.session.userId   = user.id;
  req.session.username = user.username;
  req.session.role     = user.role;
  res.redirect("/");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

const DEFAULT_PREFS = { style: "feynman", background: "", llmLang: "auto" };
const VALID_STYLES  = ["feynman", "academic", "concise", "beginner"];
const VALID_LANGS   = ["auto", "zh", "en"];

// ── 当前用户信息（供前端读取）─────────────────────────────────────
app.get("/api/me", requireAuth, (req, res) => {
  const users = loadUsers();
  const user  = users.find(u => u.id === req.session.userId);
  const prefs = user?.preferences ?? { ...DEFAULT_PREFS };
  res.json({ id: req.session.userId, username: req.session.username, role: req.session.role, preferences: prefs });
});

// ── 保存用户偏好设置 ───────────────────────────────────────────────
app.put("/api/settings", requireAuth, (req, res) => {
  const { style, background, llmLang } = req.body;
  const users = loadUsers();
  const user  = users.find(u => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  user.preferences = {
    style:      VALID_STYLES.includes(style)           ? style      : (user.preferences?.style      || "feynman"),
    background: typeof background === "string"          ? background.slice(0, 200) : (user.preferences?.background || ""),
    llmLang:    VALID_LANGS.includes(llmLang)          ? llmLang    : (user.preferences?.llmLang    || "auto"),
  };
  saveUsers(users);
  res.json({ ok: true, preferences: user.preferences });
});

// ══════════════════════════════════════════════════════════════════
// § G  管理员后台
// ══════════════════════════════════════════════════════════════════

const ADMIN_HTML = (users, msg = "", msgType = "ok") => `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title class="t" data-zh="后台管理 — 知识图谱探索者" data-en="Admin Panel — Knowledge Graph Explorer">后台管理 — 知识图谱探索者</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;background:#07070d;color:#b0b0cc;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:0}
.topbar{background:rgba(10,10,18,.95);border-bottom:1px solid #12121e;
  padding:12px 28px;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:10;
  backdrop-filter:blur(12px)}
.topbar-title{font-size:15px;font-weight:600;color:#e0d8c8}
.topbar-sub{font-size:11px;color:#2a2838}
.topbar-back{font-size:12px;color:#4a4a6a;text-decoration:none;
  padding:6px 14px;border:1px solid #1e1e2e;border-radius:7px;transition:border-color .15s}
.topbar-back:hover{border-color:#3a3a5a;color:#8080a8}
.lang-btn{margin-left:auto;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;
  border:1px solid #2a2a3e;background:transparent;color:#6060a0;
  font-family:inherit;transition:all .15s;letter-spacing:.04em}
.lang-btn:hover{border-color:#4a4a6e;color:#9090c8}
.content{max-width:860px;margin:32px auto;padding:0 20px}
.section{background:#0c0c18;border:1px solid #14142a;border-radius:14px;
  padding:24px 28px;margin-bottom:24px}
.section-title{font-size:13px;font-weight:600;color:#d0c8e8;margin-bottom:18px;
  display:flex;align-items:center;gap:8px}
.section-title::before{content:'';width:3px;height:14px;background:#8b5cf6;border-radius:2px;display:block}
.msg{padding:10px 14px;border-radius:8px;font-size:12px;margin-bottom:18px}
.msg.ok{background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.25);color:#6ee7b7}
.msg.err{background:rgba(244,63,94,.07);border:1px solid rgba(244,63,94,.22);color:#fda4af}
table{width:100%;border-collapse:collapse}
th{font-size:11px;color:#2a2a45;letter-spacing:.07em;text-transform:uppercase;
  padding:8px 12px;border-bottom:1px solid #14142a;text-align:left;font-weight:500}
td{padding:10px 12px;border-bottom:1px solid #0e0e1a;font-size:13px;vertical-align:middle}
tr:last-child td{border-bottom:none}
.badge{display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:500}
.badge-admin{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.3);color:#fcd34d}
.badge-user{background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.28);color:#c4b5fd}
.del-btn{padding:5px 13px;background:transparent;border:1px solid rgba(244,63,94,.3);
  color:#fda4af;font-size:12px;border-radius:7px;cursor:pointer;transition:all .15s;font-family:inherit}
.del-btn:hover{background:rgba(244,63,94,.08);border-color:rgba(244,63,94,.6)}
.form-row{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end}
.form-group{display:flex;flex-direction:column;gap:6px}
label{font-size:11px;color:#3a3a55;letter-spacing:.05em;text-transform:uppercase}
input{padding:9px 13px;background:#080810;border:1px solid #1e1e2e;
  border-radius:9px;color:#d0d0e8;font-size:13px;outline:none;
  transition:border-color .2s;font-family:inherit}
input:focus{border-color:#3a3a5a}
input::placeholder{color:#1e1e30}
select{padding:9px 13px;background:#080810;border:1px solid #1e1e2e;
  border-radius:9px;color:#d0d0e8;font-size:13px;outline:none;font-family:inherit}
.add-btn{padding:9px 20px;background:linear-gradient(135deg,#1c0e00,#221200);
  border:1px solid rgba(245,158,11,.5);border-radius:9px;
  color:#fcd34d;font-size:13px;font-weight:500;cursor:pointer;
  transition:all .15s;font-family:inherit;white-space:nowrap}
.add-btn:hover{border-color:rgba(245,158,11,.9);background:linear-gradient(135deg,#281600,#301e00)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:24px}
.stat{background:#0c0c18;border:1px solid #14142a;border-radius:12px;padding:18px 20px}
.stat-n{font-size:28px;font-weight:600;color:#e0d8c8;line-height:1}
.stat-l{font-size:11px;color:#2a2a45;margin-top:5px}
.pw-btn{padding:5px 13px;background:transparent;border:1px solid rgba(139,92,246,.3);
  color:#c4b5fd;font-size:12px;border-radius:7px;cursor:pointer;transition:all .15s;font-family:inherit;margin-right:6px}
.pw-btn:hover{background:rgba(139,92,246,.08);border-color:rgba(139,92,246,.6)}
</style>
</head>
<body>
<div class="topbar">
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#f59e0b" stroke-width="1.6">
    <circle cx="12" cy="5" r="2.8"/><circle cx="5" cy="19" r="2.3"/><circle cx="12" cy="19" r="2.3"/><circle cx="19" cy="19" r="2.3"/>
    <line x1="12" y1="7.8" x2="5" y2="16.7"/><line x1="12" y1="7.8" x2="12" y2="16.7"/><line x1="12" y1="7.8" x2="19" y2="16.7"/>
  </svg>
  <span class="topbar-title t" data-zh="后台管理" data-en="Admin Panel">后台管理</span>
  <span class="topbar-sub t" data-zh="知识图谱探索者" data-en="Knowledge Graph Explorer">知识图谱探索者</span>
  <a href="/" class="topbar-back t" data-zh="← 返回应用" data-en="← Back to App">← 返回应用</a>
  <button class="lang-btn" id="langBtn" onclick="toggleLang()">EN</button>
</div>
<div class="content">
  <div class="stats">
    <div class="stat"><div class="stat-n">${users.length}</div><div class="stat-l t" data-zh="总用户数" data-en="Total Users">总用户数</div></div>
    <div class="stat"><div class="stat-n">${users.filter(u=>u.role==='admin').length}</div><div class="stat-l t" data-zh="管理员" data-en="Admins">管理员</div></div>
    <div class="stat"><div class="stat-n">${users.filter(u=>u.role==='user').length}</div><div class="stat-l t" data-zh="普通用户" data-en="Regular Users">普通用户</div></div>
  </div>
  ${msg ? `<div class="msg ${msgType}">${msg}</div>` : ""}
  <div class="section">
    <div class="section-title t" data-zh="创建新用户" data-en="Create New User">创建新用户</div>
    <form method="POST" action="/admin/users/create">
      <div class="form-row">
        <div class="form-group"><label class="t" data-zh="用户名" data-en="Username">用户名</label><input type="text" name="username" class="t-ph" data-ph-zh="输入用户名" data-ph-en="Enter username" placeholder="输入用户名" required></div>
        <div class="form-group"><label class="t" data-zh="密码" data-en="Password">密码</label><input type="password" name="password" class="t-ph" data-ph-zh="至少 6 位" data-ph-en="Min 6 chars" placeholder="至少 6 位" required minlength="6"></div>
        <div class="form-group">
          <label class="t" data-zh="角色" data-en="Role">角色</label>
          <select name="role">
            <option value="user" class="t" data-zh="普通用户" data-en="Regular User">普通用户</option>
            <option value="admin" class="t" data-zh="管理员" data-en="Admin">管理员</option>
          </select>
        </div>
        <button type="submit" class="add-btn t" data-zh="创建" data-en="Create">创建</button>
      </div>
    </form>
  </div>
  <div class="section">
    <div class="section-title t" data-zh="用户列表" data-en="User List">用户列表</div>
    <table>
      <thead><tr>
        <th class="t" data-zh="用户名" data-en="Username">用户名</th>
        <th class="t" data-zh="角色" data-en="Role">角色</th>
        <th class="t" data-zh="创建时间" data-en="Created">创建时间</th>
        <th class="t" data-zh="操作" data-en="Actions">操作</th>
      </tr></thead>
      <tbody>
        ${users.map(u => `<tr>
          <td style="color:#d0c8e8;font-weight:500">${u.username}</td>
          <td><span class="badge badge-${u.role} t" data-zh="${u.role === 'admin' ? '管理员' : '普通用户'}" data-en="${u.role === 'admin' ? 'Admin' : 'User'}">${u.role === 'admin' ? '管理员' : '普通用户'}</span></td>
          <td style="color:#3a3a55;font-size:12px">${new Date(u.createdAt).toLocaleString('zh-CN')}</td>
          <td>
            <form method="POST" action="/admin/users/reset-password" style="display:inline">
              <input type="hidden" name="userId" value="${u.id}">
              <button type="submit" class="pw-btn t" data-zh="重置密码" data-en="Reset Pwd"
                data-confirm-zh="重置 ${u.username} 的密码?" data-confirm-en="Reset password for ${u.username}?"
                onclick="return confirm(window._lang==='en'?this.dataset.confirmEn:this.dataset.confirmZh)">重置密码</button>
            </form>
            <form method="POST" action="/admin/users/delete" style="display:inline">
              <input type="hidden" name="userId" value="${u.id}">
              <button type="submit" class="del-btn t" data-zh="删除" data-en="Delete"
                data-confirm-zh="确认删除 ${u.username}?" data-confirm-en="Delete ${u.username}?"
                onclick="return confirm(window._lang==='en'?this.dataset.confirmEn:this.dataset.confirmZh)">删除</button>
            </form>
          </td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
</div>
<script>
let curLang=localStorage.getItem('kt-lang')||'zh';
window._lang=curLang;
function applyLang(lang){
  window._lang=lang;
  document.querySelectorAll('.t').forEach(el=>{
    const v=el.dataset[lang];
    if(v!==undefined)el.textContent=v;
  });
  document.querySelectorAll('.t-ph').forEach(el=>{
    const v=lang==='zh'?el.dataset.phZh:el.dataset.phEn;
    if(v)el.placeholder=v;
  });
  document.getElementById('langBtn').textContent=lang==='zh'?'EN':'中文';
  document.documentElement.lang=lang==='zh'?'zh':'en';
  document.title=lang==='zh'?'后台管理 — 知识图谱探索者':'Admin Panel — Knowledge Graph Explorer';
}
function toggleLang(){curLang=curLang==='zh'?'en':'zh';localStorage.setItem('kt-lang',curLang);applyLang(curLang);}
applyLang(curLang);
</script>
</body>
</html>`;

app.get("/admin", requireAuth, requireAdmin, (req, res) => {
  res.send(ADMIN_HTML(loadUsers()));
});

const _bi = (zh, en) => `<span class="t" data-zh="${zh}" data-en="${en}">${zh}</span>`;

app.post("/admin/users/create", requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username?.trim() || !password?.trim()) {
    return res.send(ADMIN_HTML(loadUsers(), _bi("用户名和密码不能为空", "Username and password are required"), "err"));
  }
  if (password.length < 6) {
    return res.send(ADMIN_HTML(loadUsers(), _bi("密码至少 6 位", "Password must be at least 6 characters"), "err"));
  }
  const users = loadUsers();
  if (users.find(u => u.username === username.trim())) {
    return res.send(ADMIN_HTML(users, _bi(`用户名「${username}」已存在`, `Username "${username}" already exists`), "err"));
  }
  const passwordHash = await hashPassword(password);
  users.push({ id: randomBytes(8).toString("hex"), username: username.trim(), passwordHash, role: role === "admin" ? "admin" : "user", createdAt: new Date().toISOString(), preferences: { ...DEFAULT_PREFS } });
  saveUsers(users);
  res.send(ADMIN_HTML(users, _bi(`用户「${username}」创建成功`, `User "${username}" created`), "ok"));
});

app.post("/admin/users/delete", requireAuth, requireAdmin, (req, res) => {
  const { userId } = req.body;
  let users = loadUsers();
  const target = users.find(u => u.id === userId);
  if (!target) return res.send(ADMIN_HTML(users, _bi("用户不存在", "User not found"), "err"));
  if (target.id === req.session.userId) {
    return res.send(ADMIN_HTML(users, _bi("不能删除当前登录的账户", "Cannot delete your own account"), "err"));
  }
  users = users.filter(u => u.id !== userId);
  saveUsers(users);
  res.send(ADMIN_HTML(users, _bi(`用户「${target.username}」已删除`, `User "${target.username}" deleted`), "ok"));
});

app.post("/admin/users/reset-password", requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.body;
  const users = loadUsers();
  const target = users.find(u => u.id === userId);
  if (!target) return res.send(ADMIN_HTML(users, _bi("用户不存在", "User not found"), "err"));
  const newPw = randomBytes(4).toString("hex");
  target.passwordHash = await hashPassword(newPw);
  saveUsers(users);
  res.send(ADMIN_HTML(users,
    `<span class="t" data-zh="「${target.username}」新密码：" data-en="New password for &quot;${target.username}&quot;: ">「${target.username}」新密码：</span><strong style="color:#fcd34d;font-size:15px;letter-spacing:.08em">${newPw}</strong><span class="t" data-zh="（请立即告知用户）" data-en=" — share with user immediately">（请立即告知用户）</span>`,
    "ok"));
});

// ══════════════════════════════════════════════════════════════════
// § H  API 路由
// ══════════════════════════════════════════════════════════════════

// F1  LLM 代理
app.post("/api/messages", requireAuth, rateLimitMiddleware, async (req, res) => {
  const { url, key } = getLLMConfig();
  let body = req.body;
  if (PROVIDER === "deepseek" && process.env.DEEPSEEK_MODEL) body.model = process.env.DEEPSEEK_MODEL;
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    res.status(502).json({ error: { message: err.message } });
  }
});

// F2  服务端流式探索（NDJSON）
app.post("/api/explore", requireAuth, rateLimitMiddleware, async (req, res) => {
  const { concept, maxLevel = 2, branchFactor, minRelevance = 6, uiLang = "zh" } = req.body;
  if (!concept?.trim()) return res.status(400).json({ error: "缺少 concept 参数" });

  const safeLevel  = Math.max(1, Math.min(5, Number(maxLevel) || 2));
  const safeBranch = Array.isArray(branchFactor)
    ? branchFactor.slice(0, 5).map(n => Math.max(1, Math.min(5, Number(n) || 3)))
    : [3, 3, 2];

  const _explorerUsers = loadUsers();
  const _explorerUser  = _explorerUsers.find(u => u.id === req.session.userId);
  const _explorerPrefs = _explorerUser?.preferences ?? {};

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders?.();

  const send = ev => { try { res.write(JSON.stringify(ev) + "\n"); } catch (_) {} };
  try {
    for await (const ev of buildTree(concept.trim(), { maxLevel: safeLevel, branchFactor: safeBranch, minRelevance, prefs: _explorerPrefs, uiLang })) send(ev);
  } catch (err) {
    send({ type: "error", error: err.message });
  }
  res.end();
});

// F3  单节点深度扩展
app.post("/api/expand", requireAuth, rateLimitMiddleware, async (req, res) => {
  const { label, level, maxLevel = 99, minRelevance = 6, parentLabel = null, uiLang = "zh" } = req.body;
  if (!label) return res.status(400).json({ error: "缺少 label 参数" });
  try {
    const _expandUsers = loadUsers();
    const _expandUser  = _expandUsers.find(u => u.id === req.session.userId);
    const _expandPrefs = _expandUser?.preferences ?? {};
    const data = await callLLM(label, Number(level) || 0, { maxLevel: Number(maxLevel), branchFactor: [3, 3, 2, 2, 2], parentLabel: typeof parentLabel === "string" ? parentLabel : null, prefs: _expandPrefs, uiLang });
    const childLevel = (Number(level) || 0) + 1;
    const minR = Number(minRelevance) || 6;
    const children = (data.subconcepts ?? []).filter(s => (s.relevance ?? 10) >= minR).slice(0, 4).map((s, i) => ({
      id: -(i + 1), label: String(s.label).trim(), level: childLevel,
      explanation: "", relevance: s.relevance ?? null, hasStrongRelations: null, status: "pending", childIds: [],
    }));
    res.json({ node: { label, level: Number(level), explanation: data.explanation ?? "", hasStrongRelations: data.has_strong_relations ?? (children.length > 0) }, children });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// F4  跨树关联分析
app.post("/api/cross-relations", requireAuth, rateLimitMiddleware, async (req, res) => {
  const { roots } = req.body; // [{ concept, nodeLabels: string[] }]
  if (!Array.isArray(roots) || roots.length < 2) {
    return res.status(400).json({ error: "至少需要两棵树" });
  }
  try {
    const result = await findCrossRelations(roots);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// F5  节点对关联分析
app.post("/api/node-relation", requireAuth, rateLimitMiddleware, async (req, res) => {
  const { labelA, labelB } = req.body;
  if (!labelA?.trim() || !labelB?.trim()) return res.status(400).json({ error: "缺少 labelA/labelB 参数" });
  try {
    const result = await findNodeRelation(labelA.trim(), labelB.trim());
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// F6  自动关联排序
app.post("/api/auto-relations", requireAuth, rateLimitMiddleware, async (req, res) => {
  const { pivot, candidates } = req.body;
  if (!pivot?.trim() || !Array.isArray(candidates) || !candidates.length) {
    return res.status(400).json({ error: "缺少 pivot/candidates 参数" });
  }
  try {
    const result = await rankNodeRelations(pivot.trim(), candidates.slice(0, 24).map(String));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// F7  健康检查
app.get("/api/health", (req, res) => {
  res.json({ ok: true, provider: PROVIDER, time: new Date().toISOString() });
});

// ══════════════════════════════════════════════════════════════════
// § I  静态文件服务 & 启动
// ══════════════════════════════════════════════════════════════════

app.use(requireAuth, express.static(path.join(__dirname, "dist")));
app.get("*", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

ensureAdminUser().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  知识图谱探索者 v3  ·  http://localhost:${PORT}`);
    console.log(`  Provider: ${PROVIDER}`);
    console.log(`  管理后台: http://localhost:${PORT}/admin\n`);
  });
});
