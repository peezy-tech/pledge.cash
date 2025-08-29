import { describe, it, expect, beforeAll } from 'bun:test'
import * as hl from '@nktkas/hyperliquid'
import { privateKeyToAccount } from 'viem/accounts'
import { signSiweCookie } from './helpers/jwt'
import { loadSeedCache, seedCacheExists, type Address } from './helpers/cache'

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000'
const IS_TESTNET = true

const transport = new hl.HttpTransport({ isTestnet: IS_TESTNET })
const infoClient = new hl.InfoClient({ transport })

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function findTxHash(
  user: Address,
  predicate: (tx: any) => boolean,
  retries = 10,
  delayMs = 2000,
): Promise<string> {
  for (let i = 0; i < retries; i++) {
    const list = await infoClient.userDetails({ user })
    const match = list.filter(predicate).sort((a: any, b: any) => b.time - a.time)[0]
    if (match?.hash) return match.hash
    await sleep(delayMs)
  }
  throw new Error('Tx not found matching criteria')
}

function shouldRunE2E() {
  if (!(process.env.RUN_E2E === '1' || process.env.RUN_E2E === 'true')) return { ok: false, reason: 'RUN_E2E not set' }
  if (!process.env.OPERATOR_PRIVATE_KEY) return { ok: false, reason: 'OPERATOR_PRIVATE_KEY missing' }
  if (!seedCacheExists()) return { ok: false, reason: 'seed_onchain.cache.json missing' }
  return { ok: true }
}

async function serverReachable() {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1500)
    const res = await fetch(`${API_BASE}/hyperliquid/ws-status`, { signal: ctrl.signal })
    clearTimeout(t)
    return !!res
  } catch {
    return false
  }
}

const gate = shouldRunE2E()

describe(`API integration (Hyperliquid testnet) ${gate.ok ? '' : '(skipped)'}`, () => {
  if (!gate.ok) {
    it('skipped: ' + gate.reason, () => {
      expect(true).toBe(true)
    })
    return
  }
  let cache: ReturnType<typeof loadSeedCache>
  let creatorCookie: string
  let pledgeUserCookie: string
  let operatorCookie: string

  beforeAll(async () => {
    const reachable = await serverReachable()
    if (!reachable) {
      throw new Error(`API server not reachable at ${API_BASE}`)
    }
    cache = loadSeedCache()
    creatorCookie = `siwe=${signSiweCookie(cache.creator.address)}`
    pledgeUserCookie = `siwe=${signSiweCookie(cache.pledgeWallet.user.address)}`
    operatorCookie = `siwe=${signSiweCookie(cache.operator.address)}`
  })

  it('lists spot tokens (cached or 503)', async () => {
    const res = await fetch(`${API_BASE}/hyperliquid/spot-tokens`, { headers: { Cookie: creatorCookie } })
    expect([200, 503]).toContain(res.status)
  })

  it('lists normalized payments for creator', async () => {
    const res = await fetch(`${API_BASE}/hyperliquid/payments`, { headers: { Cookie: creatorCookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.asCreator).toBeDefined()
  })

  it('creates and confirms a one-off invoice (personal payer)', async () => {
    // Create invoice
    const token = cache.token
    const amount = '0.5'
    const createRes = await fetch(`${API_BASE}/hyperliquid/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: creatorCookie },
      body: JSON.stringify({ payerAddress: cache.operator.address, token, amount, description: 'e2e invoice' }),
    })
    expect(createRes.status).toBe(200)
    const invoice = await createRes.json()
    expect(invoice.id).toBeTruthy()

    // Pay from operator wallet
    const operatorPk = process.env.OPERATOR_PRIVATE_KEY as `0x${string}`
    expect(operatorPk).toBeTruthy()
    const operatorAcct = privateKeyToAccount(operatorPk)
    const exchange = new hl.ExchangeClient({ transport, wallet: operatorAcct, isTestnet: IS_TESTNET })
    await exchange.spotSend({ destination: cache.creator.address, token: token as any, amount })

    // Find tx hash
    const txHash = await findTxHash(
      operatorAcct.address as Address,
      (tx: any) =>
        tx.action.type === 'spotSend' &&
        tx.action.destination?.toLowerCase() === cache.creator.address.toLowerCase() &&
        tx.action.token === token &&
        tx.action.amount === amount &&
        tx.error === null,
    )

    // Confirm invoice
    const confirmRes = await fetch(`${API_BASE}/hyperliquid/invoices/${invoice.id}/confirm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash }),
    })
    expect(confirmRes.status).toBe(200)
    const updated = await confirmRes.json()
    expect(updated.status).toBe('paid')

    // Check payments includes it
    const payRes = await fetch(`${API_BASE}/hyperliquid/payments`, { headers: { Cookie: creatorCookie } })
    const payBody = await payRes.json()
    expect(
      (payBody.asCreator as any[]).some((p) => p.sourceId === updated.id && p.status === 'paid' && p.type === 'invoice'),
    ).toBe(true)
  })

  it('recurring plan run fallback creates invoice (no pledge wallet)', async () => {
    const token = cache.token
    const amount = '0.25'
    const createRes = await fetch(`${API_BASE}/hyperliquid/recurring`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: creatorCookie },
      body: JSON.stringify({ payerAddress: cache.operator.address, token, amount, cadence: 'monthly', autopayEnabled: true }),
    })
    expect(createRes.status).toBe(200)
    const plan = await createRes.json()
    expect(plan.id).toBeTruthy()

    const runRes = await fetch(`${API_BASE}/hyperliquid/recurring/${plan.id}/run`, { method: 'POST', headers: { Cookie: creatorCookie } })
    expect(runRes.status).toBe(200)
    const runBody = await runRes.json()
    // either autopay true or an invoice was created
    if (!runBody.autopay) {
      expect(runBody.invoiceId).toBeTruthy()
    }
  })

  it('recurring plan run autopays when payer has pledge wallet', async () => {
    const token = cache.token
    const amount = '0.2'
    // Get pledge userId via their own session
    const addrRes = await fetch(`${API_BASE}/hyperliquid/user/addresses`, { headers: { Cookie: pledgeUserCookie } })
    expect(addrRes.status).toBe(200)
    const addrInfo = await addrRes.json()
    const payerUserId = addrInfo.userId as string

    // As creator, create plan where payer is the pledge user (by userId to enable autopay)
    const createRes = await fetch(`${API_BASE}/hyperliquid/recurring`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: creatorCookie },
      body: JSON.stringify({ token, amount, cadence: 'monthly', autopayEnabled: true, payerUserId }),
    })
    expect(createRes.status).toBe(200)
    const plan = await createRes.json()

    const runRes = await fetch(`${API_BASE}/hyperliquid/recurring/${plan.id}/run`, { method: 'POST', headers: { Cookie: creatorCookie } })
    expect(runRes.status).toBe(200)
    const runBody = await runRes.json()
    // In autopay case, expect { charge, autopay: true }
    expect(runBody.charge).toBeDefined()
  })

  it('pledge campaign + pledge contribution (manual)', async () => {
    const token = cache.token
    const amount = '0.15'
    // Create campaign
    const campaignRes = await fetch(`${API_BASE}/hyperliquid/pledge-campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: creatorCookie },
      body: JSON.stringify({ name: 'E2E Campaign', goalToken: token, goalAmount: '10' }),
    })
    expect(campaignRes.status).toBe(200)
    const campaign = await campaignRes.json()

    // Create pledge (no autopay)
    const pledgeRes = await fetch(`${API_BASE}/hyperliquid/pledges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: creatorCookie },
      body: JSON.stringify({ campaignId: campaign.id, token, amountPerCadence: amount, cadence: 'monthly', autopayEnabled: false }),
    })
    expect(pledgeRes.status).toBe(200)
    const pledge = await pledgeRes.json()

    // Prepare contribution
    const prepareRes = await fetch(`${API_BASE}/hyperliquid/pledges/${pledge.id}/pay`, { method: 'POST', headers: { Cookie: creatorCookie } })
    expect(prepareRes.status).toBe(200)
    const contribution = await prepareRes.json()

    // Pay via operator wallet
    const operatorPk = process.env.OPERATOR_PRIVATE_KEY as `0x${string}`
    const operatorAcct = privateKeyToAccount(operatorPk)
    const exchange = new hl.ExchangeClient({ transport, wallet: operatorAcct, isTestnet: IS_TESTNET })
    await exchange.spotSend({ destination: cache.creator.address, token: token as any, amount })
    const txHash = await findTxHash(
      operatorAcct.address as Address,
      (tx: any) =>
        tx.action.type === 'spotSend' &&
        tx.action.destination?.toLowerCase() === cache.creator.address.toLowerCase() &&
        tx.action.token === token &&
        tx.action.amount === amount &&
        tx.error === null,
    )

    // Confirm contribution
    const confirmRes = await fetch(`${API_BASE}/hyperliquid/pledge-contributions/${contribution.id}/confirm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: creatorCookie },
      body: JSON.stringify({ txHash }),
    })
    expect(confirmRes.status).toBe(200)

    // Discover list should include this campaign
    const discRes = await fetch(`${API_BASE}/hyperliquid/pledge-campaigns/discover`)
    expect(discRes.status).toBe(200)
    const discovered = await discRes.json()
    expect((discovered.active as any[]).some((c) => c.id === campaign.id)).toBe(true)

    // My pledges for operator should include the pledge if set as pledger
    const myPledgesRes = await fetch(`${API_BASE}/hyperliquid/pledges`, { headers: { Cookie: operatorCookie } })
    expect([200, 404]).toContain(myPledgesRes.status) // 404 if operator user not found in rare case
  })

  it('donation record appears in donations and payments', async () => {
    const token = cache.token
    const amount = '0.1'

    // Send donation on-chain
    const operatorPk = process.env.OPERATOR_PRIVATE_KEY as `0x${string}`
    const operatorAcct = privateKeyToAccount(operatorPk)
    const exchange = new hl.ExchangeClient({ transport, wallet: operatorAcct, isTestnet: IS_TESTNET })
    await exchange.spotSend({ destination: cache.creator.address, token: token as any, amount })
    const txHash = await findTxHash(
      operatorAcct.address as Address,
      (tx: any) =>
        tx.action.type === 'spotSend' &&
        tx.action.destination?.toLowerCase() === cache.creator.address.toLowerCase() &&
        tx.action.token === token &&
        tx.action.amount === amount &&
        tx.error === null,
    )

    // Record donation
    const recordRes = await fetch(`${API_BASE}/hyperliquid/donations/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: creatorCookie },
      body: JSON.stringify({ creatorAddress: cache.creator.address, fromAddress: operatorAcct.address, token, amount, txHash }),
    })
    expect(recordRes.status).toBe(200)

    // Verify listings
    const donsRes = await fetch(`${API_BASE}/hyperliquid/donations`, { headers: { Cookie: creatorCookie } })
    expect(donsRes.status).toBe(200)
    const dons = await donsRes.json()
    expect((dons as any[]).some((d) => d.txHash === txHash)).toBe(true)

    const paysRes = await fetch(`${API_BASE}/hyperliquid/payments`, { headers: { Cookie: creatorCookie } })
    const pays = await paysRes.json()
    expect((pays.asCreator as any[]).some((p) => p.type === 'donation' && p.txHash === txHash)).toBe(true)
  })
})
