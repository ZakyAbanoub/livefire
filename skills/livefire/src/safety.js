// livefire — live-DB safety guard.
//
// The prover PLANTS ROWS and RUNS REAL EXPLOITS. That is safe against a local, disposable
// database and catastrophic against production. This guard is the fail-closed gate the
// controller MUST call in Stage 0 with the DB target it is about to hand the prover, and that
// any preset / generated prover code should re-check before its first mutation.
//
// Two independent gates, BOTH must pass:
//   1. Target must resolve to a LOCAL / disposable host (loopback, *.local/.internal/.test,
//      docker host, or an explicit allowlist). Anything else — a public domain, a managed-DB
//      host (supabase.co, rds.amazonaws.com, neon.tech, …), any routable IP — is REFUSED.
//      Fail-closed: unknown/unparseable → refused.
//   2. A mutating run requires EXPLICIT opt-in — opts.allowMutations === true, or the env var
//      LIVEFIRE_ALLOW_MUTATIONS in {'1','true','yes'}. Local alone is not enough to mutate.
//
// This module is a CONTROLLER-side utility (plain Node: it reads process.env). It is NOT part
// of the assembled Workflow script (which runs in a restricted scope without process.env), so
// build.mjs never inlines it — the pipeline enforces safety via the prover's SAFETY instruction
// plus this pre-launch check.

// Hosts that are always allowed as local/disposable.
const LOCAL_EXACT = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', 'host.docker.internal'])
const LOCAL_SUFFIX = ['.local', '.internal', '.test', '.localhost']

// Substrings that mark a clearly managed / production host — refused with a pointed message.
const MANAGED_MARKERS = [
  'supabase.co', 'supabase.com', 'rds.amazonaws.com', 'neon.tech', 'railway.app',
  'render.com', 'planetscale', 'cockroachlabs.cloud', 'azure.com', 'digitalocean.com',
  'gcp', 'googleapis.com', 'heroku', 'timescale.com', 'aiven', 'fly.dev', 'prod',
]

// Extract a bare hostname from a connection string / URL / host[:port] / host/path.
export function extractHost(target) {
  if (target == null) return null
  let s = String(target).trim()
  if (!s) return null
  // Strip a scheme if present (postgres://, postgresql://, https://, mysql://, mongodb+srv://…).
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  // Strip userinfo (user:pass@).
  const at = s.lastIndexOf('@')
  if (at !== -1) s = s.slice(at + 1)
  // Cut at the first path / query separator.
  s = s.split(/[/?#]/)[0]
  if (!s) return null
  // Bracketed IPv6: [::1]:5432 → ::1
  const v6 = s.match(/^\[([^\]]+)\]/)
  if (v6) return v6[1].toLowerCase()
  // Drop :port (but not for a bare IPv6 without brackets — those won't have a single trailing :port).
  if ((s.match(/:/g) || []).length === 1) s = s.split(':')[0]
  return s.toLowerCase()
}

function isPrivateOrLoopbackIp(host) {
  // IPv4 loopback only by default (127.0.0.0/8). Private LAN ranges are NOT auto-allowed —
  // they can be an internal staging/prod DB; require an explicit allowlist entry instead.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

export function isLocalHost(host, allowHosts = []) {
  if (!host) return false
  if (LOCAL_EXACT.has(host)) return true
  if (isPrivateOrLoopbackIp(host)) return true
  if (LOCAL_SUFFIX.some((suf) => host === suf.slice(1) || host.endsWith(suf))) return true
  if (allowHosts.map((h) => String(h).toLowerCase()).includes(host)) return true
  return false
}

function mutationsOptedIn(opts) {
  if (opts && opts.allowMutations === true) return true
  const env = (typeof process !== 'undefined' && process.env && process.env.LIVEFIRE_ALLOW_MUTATIONS) || ''
  return ['1', 'true', 'yes'].includes(String(env).toLowerCase())
}

// The gate. Throws a LivefireSafetyError on refusal; returns { ok, host, reason } on pass.
// opts: { allowMutations?: boolean, allowHosts?: string[], expectMutations?: boolean (default true) }
export function assertLocalDbTarget(target, opts = {}) {
  const host = extractHost(target)
  if (!host) throw new LivefireSafetyError(`livefire: cannot parse a DB host from target ${JSON.stringify(target)} — refusing (fail-closed). Pass an explicit local connection string.`)

  const managed = MANAGED_MARKERS.find((m) => host.includes(m))
  if (managed) throw new LivefireSafetyError(`livefire: DB host "${host}" looks like a managed/production host (matched "${managed}"). The prover plants rows and runs exploits — REFUSING. Point livefire at a local/disposable DB only.`)

  if (!isLocalHost(host, opts.allowHosts || [])) throw new LivefireSafetyError(`livefire: DB host "${host}" is not recognized as local/disposable. Allowed: loopback (127.0.0.0/8, ::1), localhost, *.local/.internal/.test, host.docker.internal, or an explicit opts.allowHosts entry. REFUSING (fail-closed).`)

  const needMut = opts.expectMutations !== false
  if (needMut && !mutationsOptedIn(opts)) throw new LivefireSafetyError(`livefire: host "${host}" is local, but a MUTATING run (the prover plants + deletes rows) requires explicit opt-in. Pass { allowMutations: true } or set LIVEFIRE_ALLOW_MUTATIONS=1.`)

  return { ok: true, host, reason: `local target "${host}"${needMut ? ' + mutation opt-in confirmed' : ''}` }
}

// Decode a JWT payload without verifying the signature (we only need the claims). Returns the
// parsed object, or null if it isn't a well-formed JWT.
export function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) } catch (_) { return null }
}

// The Supabase project ref embedded in a host, e.g. "abcd1234.supabase.co" → "abcd1234".
export function supabaseRefFromHost(host) {
  const m = String(host || '').toLowerCase().match(/^([a-z0-9]{16,})\.supabase\.(co|com)$/)
  return m ? m[1] : null
}

// Extensible, STACK-AGNOSTIC credential↔host binders. Each binder knows how to prove a
// credential belongs to a given remote host for ONE kind of stack. The core below names no
// stack: it skips local hosts, tries every binder, and for anything without a binder falls back
// to the allow-list + the read-only environment canary (both stack-neutral). Add a stack by
// pushing a binder here — e.g. Firebase (service-account project_id vs host), a custom JWT
// issuer, etc. Signature: matchHost(host) → bool · bind(credential, host) → { keyId, hostId }
// (throws LivefireSafetyError on a decode failure or a mismatch).
export const CREDENTIAL_BINDERS = [
  {
    id: 'supabase-jwt',
    matchHost: (host) => !!supabaseRefFromHost(host),
    bind: (credential, host) => {
      const hostId = supabaseRefFromHost(host)
      const claims = decodeJwtPayload(credential)
      if (!claims) throw new LivefireSafetyError('livefire: credential is not a decodable JWT, cannot bind it to the Supabase host — refusing (fail-closed).')
      const keyId = claims.ref || (typeof claims.iss === 'string' ? (supabaseRefFromHost(extractHost(claims.iss)) || null) : null)
      if (!keyId) throw new LivefireSafetyError('livefire: JWT has no project `ref` claim to bind to the host — refusing (fail-closed).')
      return { keyId, hostId }
    },
  },
]

// Bind a credential to the host it will act on, so a prod key can't be pointed at the wrong
// environment. LOCAL host → disposable, nothing to bind. Remote host with a matching binder →
// the credential's project/env id MUST equal the host's; a mismatch refuses (that's the staging-
// with-a-prod-key case). Remote host with NO binder for its stack → trusted ONLY if explicitly
// allow-listed (and reported unbound so the caller leans on the env canary); otherwise fail-closed.
// opts: { allowHosts?: string[], binders?: Array<binder> }
export function assertKeyMatchesHost(credential, target, opts = {}) {
  const host = extractHost(target)
  if (!host) throw new LivefireSafetyError('livefire: cannot parse a host to bind the credential to — refusing (fail-closed).')

  // TRUE loopback/local (not merely allow-listed): disposable, no environment binding to check.
  if (isLocalHost(host, [])) return { ok: true, host, bound: false, reason: `local host "${host}" — no environment binding needed` }

  const binders = opts.binders || CREDENTIAL_BINDERS
  const binder = binders.find((b) => { try { return b.matchHost(host) } catch (_) { return false } })
  if (binder) {
    const { keyId, hostId } = binder.bind(credential, host)
    if (keyId !== hostId) throw new LivefireSafetyError(`livefire: WRONG ENVIRONMENT — the credential belongs to "${keyId}" but the host is "${hostId}" (${binder.id}). This credential is for a different environment (likely prod). REFUSING.`)
    return { ok: true, host, bound: true, reason: `credential "${keyId}" matches host "${hostId}" via ${binder.id}` }
  }

  // No binder for this stack: rely on the explicit allow-list + the env canary (stack-neutral).
  if ((opts.allowHosts || []).map((h) => String(h).toLowerCase()).includes(host)) {
    return { ok: true, host, bound: false, reason: `allow-listed host "${host}" — no credential binder for this stack; rely on the read-only environment canary before mutating` }
  }
  throw new LivefireSafetyError(`livefire: cannot bind the credential to remote host "${host}" and it is not allow-listed — refusing (fail-closed). Run against a local/disposable DB, or explicitly allow-list a known test host.`)
}

export class LivefireSafetyError extends Error {
  constructor(message) {
    super(message)
    this.name = 'LivefireSafetyError'
  }
}
