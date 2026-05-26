import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      {
        name: 'llm-proxy',
        configureServer(server) {
          server.middlewares.use('/api/messages', async (req, res) => {
            if (req.method !== 'POST') {
              res.writeHead(405)
              res.end('Method Not Allowed')
              return
            }

            // Read raw body
            const rawBody = await new Promise((resolve, reject) => {
              let data = ''
              req.on('data', chunk => (data += chunk))
              req.on('end', () => resolve(data))
              req.on('error', reject)
            })

            const provider = (env.PROVIDER || 'anthropic').toLowerCase()

            // Both providers use Anthropic request/response format.
            // DeepSeek's /anthropic endpoint is wire-compatible with Claude API.
            let targetUrl, apiKey
            if (provider === 'deepseek') {
              targetUrl = 'https://api.deepseek.com/anthropic/v1/messages'
              apiKey    = env.DEEPSEEK_API_KEY
            } else {
              targetUrl = 'https://api.anthropic.com/v1/messages'
              apiKey    = env.ANTHROPIC_API_KEY
            }

            // Optional: override model name (useful for deepseek-v4-pro)
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
          })
        },
      },
    ],
  }
})
