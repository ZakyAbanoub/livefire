'use strict'

// Hasura Action handlers: login (issues the JWT Hasura verifies) and org maintenance.
// Hasura calls these with { action, input, session_variables, request_query }.

const http = require('node:http')
const crypto = require('node:crypto')

const PORT = Number(process.env.PORT || 3000)
const HASURA_GRAPHQL_URL = process.env.HASURA_GRAPHQL_URL
const HASURA_ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET
const JWT_SIGNING_KEY = process.env.JWT_SIGNING_KEY
const JWT_TTL_SECONDS = Number(process.env.JWT_TTL_SECONDS || 3600)

class ActionError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

async function hasura(query, variables) {
  const res = await fetch(HASURA_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hasura-admin-secret': HASURA_ADMIN_SECRET },
    body: JSON.stringify({ query, variables }),
  })
  const payload = await res.json()
  if (payload.errors) throw new Error(payload.errors.map((e) => e.message).join('; '))
  return payload.data
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function signJwt(claims) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(claims))
  const signature = crypto.createHmac('sha256', JWT_SIGNING_KEY).update(`${header}.${body}`).digest('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${header}.${body}.${signature}`
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length)
  return crypto.timingSafeEqual(expected, actual)
}

async function login({ email, password }) {
  const data = await hasura(
    'query ($email: String!) { users(where: { email: { _eq: $email } }) { id password_hash api_token } }',
    { email: String(email || '').trim().toLowerCase() },
  )
  const user = data.users[0]
  if (!user || !verifyPassword(password, user.password_hash)) throw new ActionError('invalid email or password', 401)
  const now = Math.floor(Date.now() / 1000)
  const token = signJwt({
    sub: String(user.id),
    iat: now,
    exp: now + JWT_TTL_SECONDS,
    'https://hasura.io/jwt/claims': {
      'x-hasura-user-id': String(user.id),
      'x-hasura-default-role': 'user',
      'x-hasura-allowed-roles': ['user'],
    },
  })
  return { token, userId: user.id, apiToken: user.api_token }
}

async function purgeOrgNotes({ orgId }) {
  const data = await hasura(
    'mutation ($orgId: Int!) { delete_notes(where: { org_id: { _eq: $orgId } }) { affected_rows } }',
    { orgId },
  )
  return { orgId, deleted: data.delete_notes.affected_rows }
}

const routes = {
  '/login': (body) => login(body.input || {}),
  '/purge-org-notes': (body) => purgeOrgNotes(body.input || {}, body.session_variables || {}),
}

function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') return send(res, 200, { ok: true })
  const route = routes[req.url]
  if (req.method !== 'POST' || !route) return send(res, 404, { message: 'not found' })
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', async () => {
    try {
      const body = raw ? JSON.parse(raw) : {}
      send(res, 200, await route(body))
    } catch (err) {
      const status = err instanceof ActionError ? err.status : 500
      if (status === 500) console.error(err)
      send(res, status === 500 ? 400 : status, { message: status === 500 ? 'internal error' : err.message })
    }
  })
})

server.listen(PORT, () => console.log(`actions listening on :${PORT}`))
