import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AppSettingsV1,
  WorkflowNodeV1,
  WorkflowTriggerScheduleKind,
  WorkflowWebhookMethod
} from '@shared/app-settings'

const INPUT_CLASS = 'w-full rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25'
const WEBHOOK_METHODS: WorkflowWebhookMethod[] = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const SCHEDULE_KINDS: WorkflowTriggerScheduleKind[] = ['manual', 'interval', 'daily', 'at', 'cron']
type TriggerNode = Extract<WorkflowNodeV1, { type: 'manual-trigger' | 'schedule-trigger' | 'webhook-trigger' }>

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return <label className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-ds-muted">{label}</span>{children}</label>
}

function buildWorkflowRunCurl(settings: AppSettingsV1, name: string): string {
  const lines = [`curl -X POST http://127.0.0.1:${settings.workflow.webhookPort}/workflow/run \\`, '  -H "Content-Type: application/json" \\']
  const secret = settings.workflow.webhookSecret.trim()
  if (secret) lines.push(`  -H "x-kun-secret: ${secret}" \\`)
  lines.push(`  -d '${JSON.stringify({ workflow: name, input: '' }).replace(/'/g, "'\\''")}'`)
  return lines.join('\n')
}

export function TriggerNodeEditor({
  node,
  settings,
  workflowName,
  inputSchemaEditor,
  onChange
}: {
  node: TriggerNode
  settings: AppSettingsV1
  workflowName?: string
  inputSchemaEditor?: ReactNode
  onChange: (node: WorkflowNodeV1) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return <>
    <Field label={t('workflowTriggerWorkspace')}>
      <input className={INPUT_CLASS} value={node.config.workspaceRoot ?? ''} placeholder={settings.workspaceRoot || '~/project'}
        onChange={(event) => onChange({ ...node, config: { ...node.config, workspaceRoot: event.target.value } } as WorkflowNodeV1)} />
      <span className="mt-1 text-[11px] leading-4 text-ds-faint">{t('workflowTriggerWorkspaceHint')}</span>
    </Field>
    {node.type === 'manual-trigger' ? inputSchemaEditor : null}
    {node.type === 'manual-trigger' && workflowName ? <div className="flex flex-col gap-1.5 border-t border-ds-border pt-3">
      <span className="text-[12px] font-medium text-ds-muted">{t('workflowLocalApi')}</span>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ds-subtle px-3 py-2 font-mono text-[11px] leading-5 text-ds-muted">{buildWorkflowRunCurl(settings, workflowName)}</pre>
      <button type="button" onClick={() => void navigator.clipboard?.writeText(buildWorkflowRunCurl(settings, workflowName))}
        className="self-start rounded-md border border-ds-border px-2 py-1 text-[11.5px] font-medium text-ds-ink transition hover:bg-ds-hover">{t('workflowLocalApiCopy')}</button>
      <span className="text-[11px] leading-4 text-ds-faint">{t('workflowLocalApiHint')}</span>
    </div> : null}
    {node.type === 'schedule-trigger' ? <>
      <Field label={t('workflowScheduleKind')}><select className={INPUT_CLASS} value={node.config.schedule.kind}
        onChange={(event) => onChange({ ...node, config: { schedule: { ...node.config.schedule, kind: event.target.value as WorkflowTriggerScheduleKind } } })}>
        {SCHEDULE_KINDS.map((kind) => <option key={kind} value={kind}>{t(`workflowScheduleKind_${kind}`)}</option>)}
      </select></Field>
      {node.config.schedule.kind === 'interval' ? <Field label={t('workflowEveryMinutes')}><input type="number" min={1} className={INPUT_CLASS} value={node.config.schedule.everyMinutes}
        onChange={(event) => onChange({ ...node, config: { schedule: { ...node.config.schedule, everyMinutes: Number(event.target.value) || 1 } } })} /></Field> : null}
      {node.config.schedule.kind === 'daily' ? <Field label={t('workflowTimeOfDay')}><input type="time" className={INPUT_CLASS} value={node.config.schedule.timeOfDay}
        onChange={(event) => onChange({ ...node, config: { schedule: { ...node.config.schedule, timeOfDay: event.target.value } } })} /></Field> : null}
      {node.config.schedule.kind === 'at' ? <Field label={t('workflowAtTime')}><input type="datetime-local" className={INPUT_CLASS} value={node.config.schedule.atTime ? node.config.schedule.atTime.slice(0, 16) : ''}
        onChange={(event) => onChange({ ...node, config: { schedule: { ...node.config.schedule, atTime: event.target.value ? new Date(event.target.value).toISOString() : '' } } })} /></Field> : null}
      {node.config.schedule.kind === 'cron' ? <Field label={t('workflowCron')}><input className={INPUT_CLASS} value={node.config.schedule.cron} placeholder={t('workflowCronPlaceholder')}
        onChange={(event) => onChange({ ...node, config: { schedule: { ...node.config.schedule, cron: event.target.value } } })} /></Field> : null}
    </> : null}
    {node.type === 'webhook-trigger' ? <>
      <Field label={t('workflowWebhookMethod')}><select className={INPUT_CLASS} value={node.config.method}
        onChange={(event) => onChange({ ...node, config: { ...node.config, method: event.target.value as WorkflowWebhookMethod } })}>
        {WEBHOOK_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
      </select></Field>
      <Field label={t('workflowWebhookPath')}><input className={INPUT_CLASS} value={node.config.path} placeholder="/my-hook"
        onChange={(event) => onChange({ ...node, config: { ...node.config, path: event.target.value } })} /></Field>
      <div className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-ds-muted">{t('workflowWebhookUrl')}</span>
        <code className="select-all break-all rounded-lg bg-ds-subtle px-3 py-2 text-[11.5px] text-ds-muted">{`http://127.0.0.1:${settings.workflow.webhookPort}${node.config.path}`}</code></div>
    </> : null}
  </>
}
