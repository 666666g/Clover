import type { ReactElement, ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WorkflowConditionOperator, WorkflowHttpMethod, WorkflowNodeV1 } from '@shared/app-settings'

const INPUT_CLASS = 'w-full rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25'
const HTTP_METHODS: WorkflowHttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const CONDITION_OPERATORS: WorkflowConditionOperator[] = [
  'contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'endsWith',
  'isEmpty', 'isNotEmpty', 'gt', 'gte', 'lt', 'lte'
]
type LogicNode = Extract<WorkflowNodeV1, { type: 'condition' | 'set-fields' | 'switch' | 'http-request' }>
function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return <label className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-ds-muted">{label}</span>{children}</label>
}

export function LogicAndHttpNodeEditor({ node, onChange }: {
  node: LogicNode
  onChange: (node: WorkflowNodeV1) => void
}): ReactElement {
  const { t } = useTranslation('common')
  if (node.type === 'condition') return <>
    <Field label={t('workflowConditionLeft')}><input className={INPUT_CLASS} value={node.config.leftExpr}
      placeholder={t('workflowConditionLeftPlaceholder')}
      onChange={(event) => onChange({ ...node, config: { ...node.config, leftExpr: event.target.value } })} /></Field>
    <Field label={t('workflowConditionOperator')}><select className={INPUT_CLASS} value={node.config.operator}
      onChange={(event) => onChange({ ...node, config: { ...node.config, operator: event.target.value as WorkflowConditionOperator } })}>
      {CONDITION_OPERATORS.map((operator) => <option key={operator} value={operator}>{t(`workflowOp_${operator}`)}</option>)}
    </select></Field>
    <Field label={t('workflowConditionValue')}><input className={INPUT_CLASS} value={node.config.rightValue}
      onChange={(event) => onChange({ ...node, config: { ...node.config, rightValue: event.target.value } })} /></Field>
    <label className="flex items-center gap-2 text-[13px] text-ds-ink"><input type="checkbox" checked={node.config.caseSensitive}
      onChange={(event) => onChange({ ...node, config: { ...node.config, caseSensitive: event.target.checked } })} />{t('workflowConditionCaseSensitive')}</label>
  </>
  if (node.type === 'set-fields') return <>
    <div className="flex flex-col gap-2"><div className="flex items-center justify-between">
      <span className="text-[12px] font-medium text-ds-muted">{t('workflowFields')}</span>
      <button type="button" className="text-[12px] font-medium text-accent hover:underline"
        onClick={() => onChange({ ...node, config: { ...node.config, fields: [...node.config.fields, { key: '', value: '' }] } })}>+ {t('workflowAddField')}</button>
    </div>{node.config.fields.map((field, index) => <div key={index} className="flex items-center gap-2">
      <input className={INPUT_CLASS} placeholder={t('workflowFieldKey')} value={field.key}
        onChange={(event) => onChange({ ...node, config: { ...node.config, fields: node.config.fields.map((item, idx) => idx === index ? { ...item, key: event.target.value } : item) } })} />
      <input className={INPUT_CLASS} placeholder={t('workflowFieldValue')} value={field.value}
        onChange={(event) => onChange({ ...node, config: { ...node.config, fields: node.config.fields.map((item, idx) => idx === index ? { ...item, value: event.target.value } : item) } })} />
      <button type="button" className="shrink-0 text-ds-faint hover:text-red-500" aria-label={t('workflowDeleteNode')}
        onClick={() => onChange({ ...node, config: { ...node.config, fields: node.config.fields.filter((_, idx) => idx !== index) } })}>
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} /></button>
    </div>)}</div>
    <label className="flex items-center gap-2 text-[13px] text-ds-ink"><input type="checkbox" checked={node.config.keepIncoming}
      onChange={(event) => onChange({ ...node, config: { ...node.config, keepIncoming: event.target.checked } })} />{t('workflowKeepIncoming')}</label>
  </>
  if (node.type === 'switch') return <>
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-ds-muted">{t('workflowSwitchRules')}</span>
        <button type="button" className="text-[12px] font-medium text-accent hover:underline"
          onClick={() => onChange({ ...node, config: { ...node.config, rules: [
            ...node.config.rules,
            { leftExpr: '', operator: 'contains', rightValue: '', caseSensitive: false }
          ] } })}>+ {t('workflowAddRule')}</button>
      </div>
      {node.config.rules.map((rule, index) => <div key={index} className="flex flex-col gap-1.5 rounded-lg border border-ds-border p-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-ds-faint">{t('workflowSwitchCase', { index: index + 1 })}</span>
          <button type="button" className="text-ds-faint hover:text-red-500" aria-label={t('workflowDeleteNode')}
            onClick={() => onChange({ ...node, config: { ...node.config, rules: node.config.rules.filter((_, itemIndex) => itemIndex !== index) } })}>
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>
        <input className={INPUT_CLASS} placeholder={t('workflowConditionLeftPlaceholder')} value={rule.leftExpr}
          onChange={(event) => onChange({ ...node, config: { ...node.config, rules: node.config.rules.map((item, itemIndex) =>
            itemIndex === index ? { ...item, leftExpr: event.target.value } : item) } })} />
        <select className={INPUT_CLASS} value={rule.operator}
          onChange={(event) => onChange({ ...node, config: { ...node.config, rules: node.config.rules.map((item, itemIndex) =>
            itemIndex === index ? { ...item, operator: event.target.value as WorkflowConditionOperator } : item) } })}>
          {CONDITION_OPERATORS.map((operator) => <option key={operator} value={operator}>{t(`workflowOp_${operator}`)}</option>)}
        </select>
        <input className={INPUT_CLASS} placeholder={t('workflowConditionValue')} value={rule.rightValue}
          onChange={(event) => onChange({ ...node, config: { ...node.config, rules: node.config.rules.map((item, itemIndex) =>
            itemIndex === index ? { ...item, rightValue: event.target.value } : item) } })} />
      </div>)}
    </div>
    <label className="flex items-center gap-2 text-[13px] text-ds-ink">
      <input type="checkbox" checked={node.config.fallback}
        onChange={(event) => onChange({ ...node, config: { ...node.config, fallback: event.target.checked } })} />
      {t('workflowSwitchFallback')}
    </label>
  </>
  return <>
    <Field label={t('workflowHttpMethod')}><select className={INPUT_CLASS} value={node.config.method}
      onChange={(event) => onChange({ ...node, config: { ...node.config, method: event.target.value as WorkflowHttpMethod } })}>
      {HTTP_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
    </select></Field>
    <Field label={t('workflowHttpUrl')}><input className={INPUT_CLASS} value={node.config.url} placeholder="https://"
      onChange={(event) => onChange({ ...node, config: { ...node.config, url: event.target.value } })} /></Field>
    <div className="flex flex-col gap-2"><div className="flex items-center justify-between"><span className="text-[12px] font-medium text-ds-muted">{t('workflowHttpHeaders')}</span>
      <button type="button" className="text-[12px] font-medium text-accent hover:underline"
        onClick={() => onChange({ ...node, config: { ...node.config, headers: [...node.config.headers, { key: '', value: '' }] } })}>+ {t('workflowHttpAddHeader')}</button></div>
      {node.config.headers.map((header, index) => <div key={index} className="flex items-center gap-2">
        <input className={INPUT_CLASS} placeholder={t('workflowHeaderKey')} value={header.key}
          onChange={(event) => onChange({ ...node, config: { ...node.config, headers: node.config.headers.map((item, idx) => idx === index ? { ...item, key: event.target.value } : item) } })} />
        <input className={INPUT_CLASS} placeholder={t('workflowHeaderValue')} value={header.value}
          onChange={(event) => onChange({ ...node, config: { ...node.config, headers: node.config.headers.map((item, idx) => idx === index ? { ...item, value: event.target.value } : item) } })} />
        <button type="button" className="shrink-0 text-ds-faint hover:text-red-500" aria-label={t('workflowDeleteNode')}
          onClick={() => onChange({ ...node, config: { ...node.config, headers: node.config.headers.filter((_, idx) => idx !== index) } })}>
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} /></button>
      </div>)}</div>
    <Field label={t('workflowHttpBody')}><textarea className={`${INPUT_CLASS} min-h-[80px] resize-y font-mono`} value={node.config.body}
      onChange={(event) => onChange({ ...node, config: { ...node.config, body: event.target.value } })} /></Field>
    <label className="flex items-center gap-2 text-[13px] text-ds-ink"><input type="checkbox" checked={node.config.parseJson}
      onChange={(event) => onChange({ ...node, config: { ...node.config, parseJson: event.target.checked } })} />{t('workflowHttpParseJson')}</label>
  </>
}
