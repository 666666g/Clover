import { isIP } from 'node:net'

/** Returns true only for local bind addresses that cannot expose serve on a LAN. */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1')
  const family = isIP(normalized)
  if (family === 4) return normalized.split('.')[0] === '127'
  if (family !== 6) return false
  if (normalized === '::1') return true
  // Accept the common textual IPv4-mapped loopback form. Other IPv6 forms
  // fail closed; resolving a hostname such as `127.evil.example` before an
  // insecure bind would make the no-token service network-reachable.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)
  return Boolean(mapped && isIP(mapped[1]!) === 4 && mapped[1]!.split('.')[0] === '127')
}
