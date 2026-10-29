import { describe, expect, it } from 'vitest'
import {
  parseSignatureHeader,
  presetAlgorithm,
  signWebhook,
  signedPayload,
  timestampAge,
  verifyWebhook,
  withinTolerance,
  type VerifyInput,
  type WebhookInput,
} from './webhook.ts'

// GitHub's own example from "Validating webhook deliveries".
const GITHUB: WebhookInput = {
  preset: 'github',
  algorithm: 'SHA-256',
  key: "It's a Secret to Everybody",
  keyEncoding: 'text',
  body: 'Hello, World!',
  timestamp: '',
}
const GITHUB_SIG = '757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17'

// Slack's own example from "Verifying requests from Slack".
const SLACK: WebhookInput = {
  preset: 'slack',
  algorithm: 'SHA-256',
  key: '8f742231b10e8888abcd99yyyzzz85a5',
  keyEncoding: 'text',
  body: 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c',
  timestamp: '1531420618',
}
const SLACK_SIG = 'a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503'

// Cross-checked with node:crypto createHmac('sha256', key).update(`${t}.${body}`).
const STRIPE: WebhookInput = {
  preset: 'stripe',
  algorithm: 'SHA-256',
  key: 'whsec_test_secret',
  keyEncoding: 'text',
  body: '{"id":"evt_1"}',
  timestamp: '1700000000',
}
const STRIPE_SIG = '248a374f50f943a28b0f6ab50faf9a7e7e29b710fa26df9fb1618b9bf8ea9c9a'
const STRIPE_OLD_KEY_SIG = 'ef1b1b7e4b312671a75ef2a03e10529f7834a6528a49db77ad6568c8c8017843'

const T = 1_700_000_000
const NOW = T * 1000

describe('signWebhook', () => {
  it('reproduces GitHub’s documented signature and header', async () => {
    const r = await signWebhook(GITHUB)
    expect(r.ok && r.hex).toBe(GITHUB_SIG)
    expect(r.ok && r.headers).toEqual([{ name: 'X-Hub-Signature-256', value: `sha256=${GITHUB_SIG}` }])
  })

  it('reproduces Slack’s documented signature, with the timestamp header', async () => {
    const r = await signWebhook(SLACK)
    expect(r.ok && r.signedPayload.startsWith('v0:1531420618:token=')).toBe(true)
    expect(r.ok && r.headers).toEqual([
      { name: 'X-Slack-Request-Timestamp', value: '1531420618' },
      { name: 'X-Slack-Signature', value: `v0=${SLACK_SIG}` },
    ])
  })

  it('signs Stripe’s t.body payload and formats the header', async () => {
    const r = await signWebhook(STRIPE)
    expect(r.ok && r.signedPayload).toBe('1700000000.{"id":"evt_1"}')
    expect(r.ok && r.headers[0]?.value).toBe(`t=1700000000,v1=${STRIPE_SIG}`)
  })

  it('also gives the signature in base64', async () => {
    const r = await signWebhook({ ...GITHUB, preset: 'plain' })
    expect(r.ok && r.base64).toBe(Buffer.from(GITHUB_SIG, 'hex').toString('base64'))
    expect(r.ok && r.headers).toEqual([])
  })

  it('never trims or normalises the body', async () => {
    const lf = await signWebhook({ ...GITHUB, body: 'Hello, World!\n' })
    const crlf = await signWebhook({ ...GITHUB, body: 'Hello, World!\r\n' })
    expect(lf.ok && lf.hex).not.toBe(GITHUB_SIG)
    expect(crlf.ok && lf.ok && crlf.hex).not.toBe(lf.ok && lf.hex)
    expect(signedPayload('stripe', ' x \r\n', '1')).toBe('1. x \r\n')
  })

  it('requires a whole-seconds timestamp for presets that sign one', async () => {
    expect(await signWebhook({ ...STRIPE, timestamp: '' })).toMatchObject({ ok: false, field: 'timestamp' })
    expect(await signWebhook({ ...SLACK, timestamp: '1.5' })).toMatchObject({ ok: false, field: 'timestamp' })
    expect(await signWebhook({ ...SLACK, timestamp: ' 1531420618' })).toMatchObject({ ok: false })
  })

  it('reports a bad key as a key error with its position', async () => {
    const r = await signWebhook({ ...GITHUB, key: 'zz', keyEncoding: 'hex' })
    expect(r).toMatchObject({ ok: false, field: 'key', position: 0 })
  })

  it('uses the provider’s algorithm, except for Plain', async () => {
    expect(presetAlgorithm('github', 'SHA-1')).toBe('SHA-256')
    expect(presetAlgorithm('plain', 'SHA-1')).toBe('SHA-1')
    const r = await signWebhook({ ...GITHUB, preset: 'plain', algorithm: 'SHA-512' })
    expect(r.ok && r.signature.length).toBe(64)
  })
})

describe('parseSignatureHeader', () => {
  it('extracts t and every v1 from a Stripe header, ignoring v0', () => {
    const r = parseSignatureHeader('stripe', `t=${T},v1=${STRIPE_SIG},v1=${STRIPE_OLD_KEY_SIG},v0=deadbeef`)
    expect(r).toEqual({ ok: true, timestamp: String(T), signatures: [STRIPE_SIG, STRIPE_OLD_KEY_SIG] })
  })

  it('accepts the whole header line, with spaces after commas', () => {
    const r = parseSignatureHeader('stripe', `Stripe-Signature: t=${T}, v1=${STRIPE_SIG}`)
    expect(r).toEqual({ ok: true, timestamp: String(T), signatures: [STRIPE_SIG] })
  })

  it('reports a Stripe header missing t or v1', () => {
    expect(parseSignatureHeader('stripe', `v1=${STRIPE_SIG}`)).toMatchObject({ ok: false })
    expect(parseSignatureHeader('stripe', `t=${T},v0=abc`)).toMatchObject({ ok: false })
    expect(parseSignatureHeader('stripe', `t=17e8,v1=${STRIPE_SIG}`)).toMatchObject({ ok: false })
  })

  it('accepts a bare Stripe signature and leaves the timestamp to the field', () => {
    expect(parseSignatureHeader('stripe', STRIPE_SIG)).toEqual({ ok: true, signatures: [STRIPE_SIG] })
  })

  it('points out GitHub’s legacy SHA-1 header', () => {
    expect(parseSignatureHeader('github', 'X-Hub-Signature: sha1=abc')).toMatchObject({ ok: false })
  })

  it('reports an empty paste', () => {
    expect(parseSignatureHeader('plain', '  ')).toMatchObject({ ok: false })
  })
})

function verify(base: WebhookInput, signature: string, extra: Partial<VerifyInput> = {}) {
  return verifyWebhook({ ...base, signature, now: NOW, ...extra })
}

describe('verifyWebhook', () => {
  it('matches GitHub with the header line, the value, or bare hex in any case', async () => {
    const pasted = [
      `X-Hub-Signature-256: sha256=${GITHUB_SIG}`,
      `sha256=${GITHUB_SIG}`,
      GITHUB_SIG.toUpperCase(),
      ` ${GITHUB_SIG}\n`,
    ]
    const results = await Promise.all(pasted.map((sig) => verify(GITHUB, sig)))
    expect(results.map((r) => r.status)).toEqual(pasted.map(() => 'match'))
  })

  it('reports a mismatch when one byte differs', async () => {
    const wrong = `sha256=${GITHUB_SIG.slice(0, -1)}8`
    expect(await verify(GITHUB, wrong)).toMatchObject({ status: 'mismatch', checked: 1 })
  })

  it('passes a Stripe header when any v1 matches, as during secret rotation', async () => {
    const header = `t=${T},v1=${STRIPE_OLD_KEY_SIG},v1=${STRIPE_SIG}`
    expect(await verify(STRIPE, header)).toEqual({ status: 'match', timestamp: String(T) })
    const none = `t=${T},v1=${STRIPE_OLD_KEY_SIG},v1=${'0'.repeat(64)}`
    expect(await verify(STRIPE, none)).toMatchObject({ status: 'mismatch', checked: 2 })
  })

  it('signs with the header’s t, not the timestamp field', async () => {
    const r = await verify({ ...STRIPE, timestamp: '1' }, `t=${T},v1=${STRIPE_SIG}`)
    expect(r).toEqual({ status: 'match', timestamp: String(T) })
  })

  it('matches Slack’s documented example inside its window', async () => {
    const now = 1531420618 * 1000 + 60_000
    expect(await verify(SLACK, `v0=${SLACK_SIG}`, { now })).toMatchObject({ status: 'match' })
  })

  it('reports an unparseable signature as invalid, not a mismatch', async () => {
    expect(await verify(GITHUB, 'sha256=not*a*signature')).toMatchObject({ status: 'invalid' })
  })

  it('reports a bad key as invalid', async () => {
    expect(
      await verify({ ...GITHUB, key: 'abc', keyEncoding: 'hex' }, GITHUB_SIG),
    ).toMatchObject({ status: 'invalid' })
  })
})

describe('timestamp tolerance', () => {
  const header = `t=${T},v1=${STRIPE_SIG}`
  const at = (offsetSeconds: number, extra: Partial<VerifyInput> = {}) =>
    verifyWebhook({ ...STRIPE, signature: header, now: (T + offsetSeconds) * 1000, ...extra })

  it('passes exactly at the 300 s boundary, and fails one second past it', async () => {
    expect((await at(300)).status).toBe('match')
    expect(await at(301)).toMatchObject({
      status: 'stale',
      signatureMatches: true,
      ageSeconds: 301,
      toleranceSeconds: 300,
    })
  })

  it('treats the future like the past', async () => {
    expect((await at(-300)).status).toBe('match')
    expect(await at(-301)).toMatchObject({ status: 'stale', ageSeconds: -301 })
  })

  it('ignores sub-second time: now is floored to whole seconds', async () => {
    const r = await verifyWebhook({ ...STRIPE, signature: header, now: (T + 300) * 1000 + 999 })
    expect(r.status).toBe('match')
  })

  it('honours a custom tolerance, and null turns the check off', async () => {
    expect((await at(10, { toleranceSeconds: 5 })).status).toBe('stale')
    expect((await at(10 ** 6, { toleranceSeconds: null })).status).toBe('match')
  })

  it('says whether the signature also failed when stale', async () => {
    const bad = `t=${T},v1=${'0'.repeat(64)}`
    const r = await verifyWebhook({ ...STRIPE, signature: bad, now: (T + 1000) * 1000 })
    expect(r).toMatchObject({ status: 'stale', signatureMatches: false })
  })

  it('applies no window to presets that sign no timestamp', async () => {
    const r = await verifyWebhook({ ...GITHUB, signature: GITHUB_SIG, now: 0 })
    expect(r.status).toBe('match')
  })

  it('exposes the age and window helpers', () => {
    expect(timestampAge(String(T), NOW + 5_500)).toBe(5)
    expect(withinTolerance(String(T), NOW + 300_000, 300)).toBe(true)
    expect(withinTolerance(String(T), NOW + 301_000, 300)).toBe(false)
  })
})
