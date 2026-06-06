import { defineConfig } from 'vite'
import { resolve } from 'path'

function netlifyFunctionDevPlugin() {
  return {
    name: 'netlify-function-dev',
    configureServer(server) {
      server.middlewares.use('/.netlify/functions/market-price', async (req, res) => {
        try {
          const { handler } = await import('./netlify/functions/market-price.js')
          const url = new URL(req.url || '/', 'http://localhost')
          const result = await handler({
            httpMethod: req.method || 'GET',
            queryStringParameters: Object.fromEntries(url.searchParams.entries()),
          })

          for (const [key, value] of Object.entries(result.headers || {})) {
            res.setHeader(key, value)
          }
          res.statusCode = result.statusCode || 200
          res.end(result.body || '')
        } catch (error) {
          console.error('Vite market-price middleware failed:', error)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: error?.message || 'Unknown error' }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [netlifyFunctionDevPlugin()],
  build: {
    rollupOptions: {
      input: {
        main:   resolve(__dirname, 'index.html'),
        relic:  resolve(__dirname, 'relic.html'),
        class:  resolve(__dirname, 'class.html'),
        potion: resolve(__dirname, 'potion.html'),
      }
    }
  }
})
