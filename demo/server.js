import express from 'express'
import session from 'express-session'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'changeme'
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(session({
  secret: process.env.SESSION_SECRET || 'please-set-a-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}))

function requireAuth(req, res, next) {
  if (req.session.authenticated) return next()
  res.redirect('/login')
}

const LOGIN_PAGE = (error = '') => `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Knowledge Tree Agent</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0f0f0f;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .card {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 12px;
    padding: 40px;
    width: 100%;
    max-width: 360px;
  }
  h1 {
    color: #fff;
    font-size: 20px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  p {
    color: #666;
    font-size: 14px;
    margin-bottom: 28px;
  }
  label {
    display: block;
    color: #999;
    font-size: 13px;
    margin-bottom: 8px;
  }
  input[type="password"] {
    width: 100%;
    padding: 10px 14px;
    background: #111;
    border: 1px solid #333;
    border-radius: 8px;
    color: #fff;
    font-size: 15px;
    outline: none;
    transition: border-color 0.2s;
    margin-bottom: 16px;
  }
  input[type="password"]:focus { border-color: #555; }
  button {
    width: 100%;
    padding: 11px;
    background: #fff;
    color: #000;
    border: none;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  button:hover { opacity: 0.85; }
  .error {
    color: #f87171;
    font-size: 13px;
    margin-bottom: 14px;
  }
</style>
</head>
<body>
<div class="card">
  <h1>Knowledge Tree Agent</h1>
  <p>请输入密码以继续</p>
  <form method="POST" action="/login">
    <label>访问密码</label>
    ${error ? `<div class="error">${error}</div>` : ''}
    <input type="password" name="password" placeholder="••••••••" autofocus>
    <button type="submit">进入</button>
  </form>
</div>
</body>
</html>`

app.get('/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/')
  res.send(LOGIN_PAGE())
})

app.post('/login', (req, res) => {
  if (req.body.password === ACCESS_PASSWORD) {
    req.session.authenticated = true
    res.redirect('/')
  } else {
    res.send(LOGIN_PAGE('密码错误，请重试'))
  }
})

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'))
})

// API proxy (requires auth)
app.post('/api/messages', requireAuth, async (req, res) => {
  const provider = (process.env.PROVIDER || 'anthropic').toLowerCase()
  let targetUrl, apiKey
  if (provider === 'deepseek') {
    targetUrl = 'https://api.deepseek.com/anthropic/v1/messages'
    apiKey = process.env.DEEPSEEK_API_KEY
  } else {
    targetUrl = 'https://api.anthropic.com/v1/messages'
    apiKey = process.env.ANTHROPIC_API_KEY
  }

  let body = JSON.stringify(req.body)
  if (provider === 'deepseek' && process.env.DEEPSEEK_MODEL) {
    req.body.model = process.env.DEEPSEEK_MODEL
    body = JSON.stringify(req.body)
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
    })
    const data = await upstream.json()
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(502).json({ error: { message: err.message } })
  }
})

// Serve built React app (requires auth)
app.use(requireAuth, express.static(path.join(__dirname, 'dist')))
app.get('*', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
