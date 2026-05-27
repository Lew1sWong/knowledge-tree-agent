import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // 开发模式中的 LLM 代理（直接转发到上游 API）
  async function proxyMessages(req, res, env) {
    const provider = (env.PROVIDER || 'anthropic').toLowerCase()
    let targetUrl, apiKey
    if (provider === 'deepseek') {
      targetUrl = 'https://api.deepseek.com/anthropic/v1/messages'
      apiKey    = env.DEEPSEEK_API_KEY
    } else {
      targetUrl = 'https://api.anthropic.com/v1/messages'
      apiKey    = env.ANTHROPIC_API_KEY
    }

    const rawBody = await new Promise((resolve, reject) => {
      let data = ''
      req.on('data', chunk => (data += chunk))
      req.on('end', () => resolve(data))
      req.on('error', reject)
    })

    let body = rawBody
    if (provider === 'deepseek' && env.DEEPSEEK_MODEL) {
      try {
        const parsed = JSON.parse(rawBody)
        parsed.model = env.DEEPSEEK_MODEL
        body = JSON.stringify(parsed)
      } catch (_) {}
    }

    try {
      const upstream = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
        },
        body,
      })
      const data = await upstream.json()
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: err.message } }))
    }
  }

  return {
    plugins: [
      react(),
      {
        name: 'api-dev-proxy',
        configureServer(server) {
          // /api/messages — LLM 代理（开发模式）
          server.middlewares.use('/api/messages', async (req, res) => {
            if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
            await proxyMessages(req, res, env)
          })

          // /api/explore, /api/expand — 开发模式下提示使用 npm start
          server.middlewares.use('/api/explore', (_req, res) => {
            res.writeHead(501, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              error: '开发模式不支持服务端流式接口，请运行 npm start 使用完整功能'
            }))
          })

          server.middlewares.use('/api/expand', (_req, res) => {
            res.writeHead(501, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              error: '开发模式不支持服务端扩展接口，请运行 npm start'
            }))
          })
        },
      },
    ],
  }
})
