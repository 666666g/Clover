import type { ReactElement } from 'react'
import type { KunRuntimeSettingsPatchV1, KunRuntimeSettingsV1 } from '@shared/app-settings'
import { SubagentSettingsEditor } from './subagents/SubagentSettingsEditor'

type SubagentsSettingsContext = {
  kun: KunRuntimeSettingsV1
  updateKun: (patch: KunRuntimeSettingsPatchV1) => void | Promise<void>
}

export function SubagentsSettingsSection({
  ctx
}: {
  ctx: SubagentsSettingsContext
}): ReactElement {
  return (
    <SubagentSettingsEditor kun={ctx.kun} onPatch={ctx.updateKun} variant="settings" />
  )
}
