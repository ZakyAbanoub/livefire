// livefire safety guard tests. Plain Node, no framework: `node src/safety.test.mjs`.
import assert from 'node:assert/strict'
import { assertLocalDbTarget, extractHost, isLocalHost, LivefireSafetyError, assertKeyMatchesHost, decodeJwtPayload, supabaseRefFromHost } from './safety.js'

// Build an unsigned JWT with a given payload (signature is ignored by decodeJwtPayload).
function jwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`
}

let pass = 0, fail = 0
function t(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`) }
}
function refuses(target, opts, mustMention) {
  assert.throws(() => assertLocalDbTarget(target, opts), (e) => {
    assert.ok(e instanceof LivefireSafetyError, 'wrong error type')
    if (mustMention) assert.ok(e.message.toLowerCase().includes(mustMention), `message should mention "${mustMention}"`)
    return true
  })
}
const OK = { allowMutations: true } // opt-in so the local check is what's under test

console.log('extractHost:')
t('postgres conn string', () => assert.equal(extractHost('postgresql://postgres:postgres@127.0.0.1:54322/postgres'), '127.0.0.1'))
t('https managed url', () => assert.equal(extractHost('https://abcd.supabase.co/rest/v1'), 'abcd.supabase.co'))
t('host:port', () => assert.equal(extractHost('db.prod.internal.acme.com:5432'), 'db.prod.internal.acme.com'))
t('bracketed ipv6', () => assert.equal(extractHost('postgresql://u:p@[::1]:5432/db'), '::1'))
t('bare host', () => assert.equal(extractHost('localhost'), 'localhost'))
t('empty → null', () => assert.equal(extractHost('  '), null))

console.log('isLocalHost:')
t('127.0.0.1', () => assert.equal(isLocalHost('127.0.0.1'), true))
t('127.0.0.5 (loopback range)', () => assert.equal(isLocalHost('127.0.0.5'), true))
t('localhost', () => assert.equal(isLocalHost('localhost'), true))
t('::1', () => assert.equal(isLocalHost('::1'), true))
t('host.docker.internal', () => assert.equal(isLocalHost('host.docker.internal'), true))
t('db.local', () => assert.equal(isLocalHost('db.local'), true))
t('mystack.internal', () => assert.equal(isLocalHost('mystack.internal'), true))
t('private LAN NOT auto-local', () => assert.equal(isLocalHost('192.168.1.20'), false))
t('public host not local', () => assert.equal(isLocalHost('db.acme.com'), false))
t('allowHosts override', () => assert.equal(isLocalHost('my-test-box', ['my-test-box']), true))

console.log('assertLocalDbTarget — REFUSE prod/managed:')
t('supabase.co refused', () => refuses('https://xyz.supabase.co', OK, 'managed/production'))
t('RDS refused', () => refuses('postgresql://u:p@mydb.abc.us-east-1.rds.amazonaws.com:5432/db', OK, 'managed/production'))
t('neon refused', () => refuses('postgresql://u:p@ep-cool.neon.tech/db', OK, 'managed/production'))
t('host with "prod" refused', () => refuses('postgresql://u:p@pg-prod-01.acme.com/db', OK, 'managed/production'))
t('public IP / unknown host refused', () => refuses('postgresql://u:p@203.0.113.7:5432/db', OK, 'not recognized as local'))
t('private LAN refused (fail-closed)', () => refuses('postgresql://u:p@192.168.1.20:5432/db', OK, 'not recognized as local'))
t('unparseable refused', () => refuses('', OK, 'cannot parse'))

console.log('assertLocalDbTarget — mutation opt-in gate:')
t('local WITHOUT opt-in refused', () => refuses('postgresql://postgres:postgres@127.0.0.1:54322/postgres', {}, 'explicit opt-in'))
t('local WITH opt-in passes', () => {
  const r = assertLocalDbTarget('postgresql://postgres:postgres@127.0.0.1:54322/postgres', { allowMutations: true })
  assert.equal(r.ok, true); assert.equal(r.host, '127.0.0.1')
})
t('local + env opt-in passes', () => {
  process.env.LIVEFIRE_ALLOW_MUTATIONS = '1'
  try { assert.equal(assertLocalDbTarget('localhost:54322', {}).ok, true) }
  finally { delete process.env.LIVEFIRE_ALLOW_MUTATIONS }
})
t('read-only local run needs no opt-in', () => {
  const r = assertLocalDbTarget('127.0.0.1:54322', { expectMutations: false })
  assert.equal(r.ok, true)
})
t('opt-in does NOT override a prod host', () => refuses('https://xyz.supabase.co', { allowMutations: true }, 'managed/production'))

console.log('assertKeyMatchesHost — bind credential to environment:')
t('local host → passes, no binding needed', () => {
  const r = assertKeyMatchesHost(jwt({ role: 'service_role' }), 'postgresql://postgres:postgres@127.0.0.1:54322/postgres')
  assert.equal(r.ok, true); assert.equal(r.bound, false)
})
t('remote staging: matching ref passes', () => {
  const r = assertKeyMatchesHost(jwt({ ref: 'zmuumlaurvpqqdpxfqot', role: 'service_role' }), 'https://zmuumlaurvpqqdpxfqot.supabase.co', { allowHosts: ['zmuumlaurvpqqdpxfqot.supabase.co'] })
  assert.equal(r.bound, true)
})
t('remote: prod key on staging host → refused (wrong project)', () => {
  assert.throws(() => assertKeyMatchesHost(jwt({ ref: 'erykvlkjuvepkowbalux' }), 'https://zmuumlaurvpqqdpxfqot.supabase.co', { allowHosts: ['zmuumlaurvpqqdpxfqot.supabase.co'] }),
    (e) => e instanceof LivefireSafetyError && /WRONG ENVIRONMENT/.test(e.message))
})
t('key ref from iss claim (issuer URL) also works', () => {
  const r = assertKeyMatchesHost(jwt({ iss: 'https://zmuumlaurvpqqdpxfqot.supabase.co/auth/v1' }), 'https://zmuumlaurvpqqdpxfqot.supabase.co', { allowHosts: ['zmuumlaurvpqqdpxfqot.supabase.co'] })
  assert.equal(r.bound, true)
})
t('non-JWT credential on remote → refused', () => {
  assert.throws(() => assertKeyMatchesHost('not-a-jwt', 'https://x1234567890abcdef.supabase.co', { allowHosts: ['x1234567890abcdef.supabase.co'] }),
    (e) => e instanceof LivefireSafetyError && /not a decodable JWT/.test(e.message))
})
t('unrecognised remote host, NOT allow-listed → refused', () => {
  assert.throws(() => assertKeyMatchesHost(jwt({ ref: 'foo' }), 'https://db.acme.com'),
    (e) => e instanceof LivefireSafetyError && /not allow-listed/.test(e.message))
})
t('unrecognised remote host, allow-listed → passes but unbound', () => {
  const r = assertKeyMatchesHost(jwt({ ref: 'foo' }), 'https://db.acme.com', { allowHosts: ['db.acme.com'] })
  assert.equal(r.ok, true); assert.equal(r.bound, false)
})
t('JWT with no ref/iss → refused', () => {
  assert.throws(() => assertKeyMatchesHost(jwt({ role: 'service_role' }), 'https://abcd123456789012.supabase.co', { allowHosts: ['abcd123456789012.supabase.co'] }),
    (e) => e instanceof LivefireSafetyError && /no project .ref. claim/.test(e.message))
})
t('decodeJwtPayload + supabaseRefFromHost helpers', () => {
  assert.equal(decodeJwtPayload(jwt({ ref: 'abc' })).ref, 'abc')
  assert.equal(decodeJwtPayload('garbage'), null)
  assert.equal(supabaseRefFromHost('zmuumlaurvpqqdpxfqot.supabase.co'), 'zmuumlaurvpqqdpxfqot')
  assert.equal(supabaseRefFromHost('127.0.0.1'), null)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
