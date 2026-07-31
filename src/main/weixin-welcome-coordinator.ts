import type { AppSettingsV1, ClawImChannelV1 } from '../shared/app-settings'

export type WeixinWelcomeCoordinatorDeps = {
  alreadyAttempted: (channelId: string) => boolean
  welcomeInFlight: (channelId: string) => boolean
  markAttempted: (channelId: string) => void
  beginWelcome: (channelId: string) => void
  endWelcome: (channelId: string) => void
  resolveOwner: (channel: ClawImChannelV1) => Promise<string>
  sendWelcome: (
    channel: ClawImChannelV1,
    owner: string,
    text: string
  ) => Promise<{ ok: boolean }>
  welcomeText: (settings: AppSettingsV1, channel: ClawImChannelV1) => string
  markWelcomeSent: (channelId: string) => Promise<void>
  logError: (category: string, message: string, detail?: unknown) => void
  stopped?: () => boolean
}

/** Owns the Weixin-only eager welcome sent immediately after QR connection. */
export async function syncWeixinConnectWelcomes(
  settings: AppSettingsV1,
  deps: WeixinWelcomeCoordinatorDeps
): Promise<void> {
  if (!settings.claw.enabled || !settings.claw.im.enabled) return
  for (const channel of settings.claw.channels) {
    if (deps.stopped?.()) return
    if (!channel.enabled || channel.provider !== 'weixin' || channel.welcomeSentAt) continue
    const credential = channel.platformCredential
    if (credential?.kind !== 'weixin' || !credential.accountId.trim()) continue
    if (deps.alreadyAttempted(channel.id) || deps.welcomeInFlight(channel.id)) continue
    deps.markAttempted(channel.id)
    deps.beginWelcome(channel.id)
    try {
      const owner = await deps.resolveOwner(channel)
      if (deps.stopped?.()) return
      if (!owner) continue
      const result = await deps.sendWelcome(channel, owner, deps.welcomeText(settings, channel))
      if (result.ok && !deps.stopped?.()) await deps.markWelcomeSent(channel.id)
    } catch (error) {
      deps.logError('claw-weixin', 'Failed to greet the WeChat owner after connect', {
        channelId: channel.id,
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      deps.endWelcome(channel.id)
    }
  }
}
