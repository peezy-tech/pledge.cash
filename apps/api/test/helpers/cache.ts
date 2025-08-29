import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

export type Address = `0x${string}`

export type SeedCache = {
  version: 1
  createdAt: string
  token: string
  operator: { address: Address }
  creator: { address: Address; privateKey?: `0x${string}` }
  transfers: {
    invoice: { amount: string; txHash: Address }
    donation: { amount: string; txHash: Address }
    recurring: { amount: string; txHash: Address }
  }
  pledgeWallet: {
    user: { address: Address; privateKey: `0x${string}` }
    operator: { address: Address; privateKey: `0x${string}` }
    pledge: { address: Address; privateKey: `0x${string}` }
    agent: { address: Address; privateKey: `0x${string}` }
    approveAgentTxHash?: Address
    convertToMultiSigTxHash?: Address
  }
}

export function getSeedCachePath() {
  return path.resolve(__dirname, '../../../../scripts/seed_onchain.cache.json')
}

export function seedCacheExists(): boolean {
  return existsSync(getSeedCachePath())
}

export function loadSeedCache(): SeedCache {
  const p = getSeedCachePath()
  const raw = readFileSync(p, 'utf8')
  const parsed = JSON.parse(raw)
  if (parsed.version !== 1) throw new Error('Unsupported cache version')
  return parsed as SeedCache
}
