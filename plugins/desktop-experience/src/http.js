import fs from 'node:fs'

const MAX_JSON_BYTES = 16 * 1024

export function sendJson(req, res, status, value) {
  const body = Buffer.from(JSON.stringify(value, null, 2))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

export function methodAllowed(req, res, methods) {
  if (methods.includes(req.method)) return true
  res.writeHead(405, { allow: methods.join(', ') })
  res.end()
  return false
}

function isLoopbackHost(host = '') {
  const normalized = host.toLowerCase().split(':')[0].replace(/^\[|\]$/gu, '')
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1'
}

export function requireLocalMutation(req, res, acceptedTypes = ['application/json']) {
  if (!isLoopbackHost(req.headers.host || '')) {
    sendJson(req, res, 403, { ok: false, error: '只允许本机访问。' })
    return false
  }
  const origin = req.headers.origin
  const fetchSite = req.headers['sec-fetch-site']
  if (typeof origin !== 'string' || !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/iu.test(origin)) {
    sendJson(req, res, 403, { ok: false, error: '来源校验失败。' })
    return false
  }
  if (fetchSite && fetchSite !== 'same-origin') {
    sendJson(req, res, 403, { ok: false, error: '跨站请求已拒绝。' })
    return false
  }
  const contentType = (req.headers['content-type'] || '').toLowerCase().split(';')[0].trim()
  if (!acceptedTypes.includes(contentType)) {
    sendJson(req, res, 415, { ok: false, error: `只接受 ${acceptedTypes.join(' 或 ')}。` })
    return false
  }
  return true
}

export async function readJson(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > MAX_JSON_BYTES) throw new Error('请求体超过 16 KiB 限制。')
    chunks.push(chunk)
  }
  if (bytes === 0) return {}
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('JSON 请求体必须是对象。')
  return value
}

export function sendFile(req, res, filePath, contentType) {
  const stream = fs.createReadStream(filePath)
  let opened = false
  stream.on('open', () => {
    opened = true
    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    })
    if (req.method === 'HEAD') {
      stream.destroy()
      res.end()
    } else {
      stream.pipe(res)
    }
  })
  stream.on('error', () => {
    if (!opened && !res.headersSent) sendJson(req, res, 404, { ok: false, error: '壁纸不存在。' })
    else if (!res.writableEnded) res.destroy()
  })
}
