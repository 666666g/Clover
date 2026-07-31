import { createHmac, randomBytes } from 'node:crypto'

export const KUN_APPROVAL_CONSENT_HEADER = 'x-kun-approval-consent'
const APPROVAL_CONSENT_VERSION = 'v1'

export function createApprovalConsentToken(input: {
  runtimeToken: string
  approvalId: string
  decision: 'allow' | 'deny'
  expiresAt: number
}): string {
  if (!input.runtimeToken) throw new Error('Kun runtime token is required for protected approval.')
  if (!Number.isSafeInteger(input.expiresAt)) throw new Error('Approval consent expiry is invalid.')
  const nonce = randomBytes(24).toString('base64url')
  const signature = createHmac('sha256', input.runtimeToken)
    .update(approvalConsentPayload(input.approvalId, input.decision, input.expiresAt, nonce))
    .digest('base64url')
  return [APPROVAL_CONSENT_VERSION, input.expiresAt, nonce, signature].join('.')
}

export function approvalConsentPayload(
  approvalId: string,
  decision: 'allow' | 'deny',
  expiresAt: number,
  nonce: string
): string {
  return `${APPROVAL_CONSENT_VERSION}\n${approvalId}\n${decision}\n${expiresAt}\n${nonce}`
}
