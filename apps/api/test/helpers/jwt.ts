// Minimal HS256 JWT signer to create the SIWE cookie for tests
import { createHmac } from 'node:crypto'

function base64url(input: Buffer | string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

export function signSiweCookie(address: `0x${string}`, secret = 'foo') {
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = { address }
  const encodedHeader = base64url(JSON.stringify(header))
  const encodedPayload = base64url(JSON.stringify(payload))
  const data = `${encodedHeader}.${encodedPayload}`
  const sig = createHmac('sha256', secret).update(data).digest()
  const encodedSig = base64url(sig)
  return `${data}.${encodedSig}`
}

