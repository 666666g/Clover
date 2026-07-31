import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkflowConditionOperator, WorkflowNodeV1 } from '@shared/app-settings'
import { NODE_INPUT_CLASS, NodeEditorField } from './NodeEditorPrimitives'

type TransformNode = Extract<WorkflowNodeV1, {
  type: 'merge' | 'filter' | 'sort' | 'limit' | 'aggregate' | 'delay' | 'template' | 'json' | 'output'
}>

const TRANSFORM_NODE_TYPES = new Set<WorkflowNodeV1['type']>([
  'merge', 'filter', 'sort', 'limit', 'aggregate', 'delay', 'template', 'json', 'output'
])

export function isTransformNode(node: WorkflowNodeV1): node is TransformNode {
  return TRANSFORM_NODE_TYPES.has(node.type)
}

const CONDITION_OPERATORS: WorkflowConditionOperator[] = [
  'contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'endsWith',
  'isEmpty', 'isNotEmpty', 'gt', 'gte', 'lt', 'lte'
]

export function TransformNodeEditor({ node, onChange }: {
  node: TransformNode
  onChange: (node: WorkflowNodeV1) => void
}): ReactElement {
  const { t } = useTranslation('common')
  if (node.type === 'merge') return (
    <NodeEditorField label={t('workflowMergeMode')}>
      <select className={NODE_INPUT_CLASS} value={node.config.mode}
        onChange={(event) => onChange({ ...node, config: { mode: event.target.value === 'object' ? 'object' : 'array' } })}>
        <option value="array">{t('workflowMergeArray')}</option>
        <option value="object">{t('workflowMergeObject')}</option>
      </select>
    </NodeEditorField>
  )
  if (node.type === 'filter') return <>
    <p className="text-[11.5px] leading-5 text-ds-faint">{t('workflowFilterHint')}</p>
    <NodeEditorField label={t('workflowConditionLeft')}>
      <input className={NODE_INPUT_CLASS} value={node.config.leftExpr}
        placeholder={t('workflowConditionLeftPlaceholder')}
        onChange={(event) => onChange({ ...node, config: { ...node.config, leftExpr: event.target.value } })} />
    </NodeEditorField>
    <NodeEditorField label={t('workflowConditionOperator')}>
      <select className={NODE_INPUT_CLASS} value={node.config.operator}
        onChange={(event) => onChange({ ...node, config: { ...node.config, operator: event.target.value as WorkflowConditionOperator } })}>
        {CONDITION_OPERATORS.map((operator) => <option key={operator} value={operator}>{t(`workflowOp_${operator}`)}</option>)}
      </select>
    </NodeEditorField>
    <NodeEditorField label={t('workflowConditionValue')}>
      <input className={NODE_INPUT_CLASS} value={node.config.rightValue}
        onChange={(event) => onChange({ ...node, config: { ...node.config, rightValue: event.target.value } })} />
    </NodeEditorField>
  </>
  if (node.type === 'sort') return <>
    <p className="text-[11.5px] leading-5 text-ds-faint">{t('workflowArrayHint')}</p>
    <NodeEditorField label={t('workflowSortField')}>
      <input className={NODE_INPUT_CLASS} value={node.config.field} placeholder="value / user.name"
        onChange={(event) => onChange({ ...node, config: { ...node.config, field: event.target.value } })} />
    </NodeEditorField>
    <NodeEditorField label={t('workflowSortOrder')}>
      <select className={NODE_INPUT_CLASS} value={node.config.order}
        onChange={(event) => onChange({ ...node, config: { ...node.config, order: event.target.value === 'desc' ? 'desc' : 'asc' } })}>
        <option value="asc">{t('workflowSortAsc')}</option>
        <option value="desc">{t('workflowSortDesc')}</option>
      </select>
    </NodeEditorField>
    <label className="flex items-center gap-2 text-[13px] text-ds-ink">
      <input type="checkbox" checked={node.config.numeric}
        onChange={(event) => onChange({ ...node, config: { ...node.config, numeric: event.target.checked } })} />
      {t('workflowSortNumeric')}
    </label>
  </>
  if (node.type === 'limit') return <>
    <p className="text-[11.5px] leading-5 text-ds-faint">{t('workflowArrayHint')}</p>
    <NodeEditorField label={t('workflowLimitCount')}>
      <input type="number" min={1} className={NODE_INPUT_CLASS} value={node.config.count}
        onChange={(event) => onChange({ ...node, config: { ...node.config, count: Math.max(1, Number(event.target.value) || 1) } })} />
    </NodeEditorField>
    <NodeEditorField label={t('workflowLimitFrom')}>
      <select className={NODE_INPUT_CLASS} value={node.config.from}
        onChange={(event) => onChange({ ...node, config: { ...node.config, from: event.target.value === 'last' ? 'last' : 'first' } })}>
        <option value="first">{t('workflowLimitFirst')}</option>
        <option value="last">{t('workflowLimitLast')}</option>
      </select>
    </NodeEditorField>
  </>
  if (node.type === 'aggregate') return <>
    <p className="text-[11.5px] leading-5 text-ds-faint">{t('workflowArrayHint')}</p>
    <NodeEditorField label={t('workflowAggregateMode')}>
      <select className={NODE_INPUT_CLASS} value={node.config.mode} onChange={(event) => {
        const mode = event.target.value
        onChange({ ...node, config: { ...node.config, mode: mode === 'sum' || mode === 'collect' || mode === 'join' ? mode : 'count' } })
      }}>
        <option value="count">{t('workflowAggCount')}</option>
        <option value="sum">{t('workflowAggSum')}</option>
        <option value="collect">{t('workflowAggCollect')}</option>
        <option value="join">{t('workflowAggJoin')}</option>
      </select>
    </NodeEditorField>
    {node.config.mode !== 'count' ? <NodeEditorField label={t('workflowAggregateField')}>
      <input className={NODE_INPUT_CLASS} value={node.config.field} placeholder="value / price"
        onChange={(event) => onChange({ ...node, config: { ...node.config, field: event.target.value } })} />
    </NodeEditorField> : null}
    {node.config.mode === 'join' ? <NodeEditorField label={t('workflowAggregateSeparator')}>
      <input className={NODE_INPUT_CLASS} value={node.config.separator}
        onChange={(event) => onChange({ ...node, config: { ...node.config, separator: event.target.value } })} />
    </NodeEditorField> : null}
  </>
  if (node.type === 'delay') return (
    <NodeEditorField label={t('workflowDelaySeconds')}>
      <input type="number" min={0} className={NODE_INPUT_CLASS} value={Math.round(node.config.delayMs / 1000)}
        onChange={(event) => onChange({ ...node, config: { delayMs: Math.max(0, Number(event.target.value) || 0) * 1000 } })} />
    </NodeEditorField>
  )
  if (node.type === 'template') return <>
    <NodeEditorField label={t('workflowTemplate')}>
      <textarea className={`${NODE_INPUT_CLASS} min-h-[120px] resize-y font-mono`} value={node.config.template}
        placeholder="{{json.title}} — {{text}}"
        onChange={(event) => onChange({ ...node, config: { ...node.config, template: event.target.value } })} />
    </NodeEditorField>
    <NodeEditorField label={t('workflowTemplateOutput')}>
      <select className={NODE_INPUT_CLASS} value={node.config.outputMode}
        onChange={(event) => onChange({ ...node, config: { ...node.config, outputMode: event.target.value === 'json' ? 'json' : 'text' } })}>
        <option value="text">{t('workflowTemplateOutputText')}</option>
        <option value="json">{t('workflowTemplateOutputJson')}</option>
      </select>
    </NodeEditorField>
    <p className="text-[11.5px] leading-5 text-ds-faint">{t('workflowTemplateHint')}</p>
  </>
  if (node.type === 'json') return <>
    <NodeEditorField label={t('workflowJsonMode')}>
      <select className={NODE_INPUT_CLASS} value={node.config.mode}
        onChange={(event) => onChange({ ...node, config: { ...node.config, mode: event.target.value === 'stringify' ? 'stringify' : 'parse' } })}>
        <option value="parse">{t('workflowJsonParse')}</option>
        <option value="stringify">{t('workflowJsonStringify')}</option>
      </select>
    </NodeEditorField>
    {node.config.mode === 'parse' ? <label className="flex items-center gap-2 text-[13px] text-ds-ink">
      <input type="checkbox" checked={node.config.strict}
        onChange={(event) => onChange({ ...node, config: { ...node.config, strict: event.target.checked } })} />
      {t('workflowJsonStrict')}
    </label> : null}
    <p className="text-[11.5px] leading-5 text-ds-faint">{t('workflowJsonHint')}</p>
  </>
  return <>
    <p className="text-[11.5px] leading-5 text-ds-faint">{t('workflowOutputHint')}</p>
    <NodeEditorField label={t('workflowOutputMode')}>
      <select className={NODE_INPUT_CLASS} value={node.config.mode} onChange={(event) => {
        const value = event.target.value
        onChange({ ...node, config: { ...node.config, mode: value === 'text' || value === 'json' ? value : 'auto' } })
      }}>
        <option value="auto">{t('workflowOutputModeAuto')}</option>
        <option value="text">{t('workflowOutputModeText')}</option>
        <option value="json">{t('workflowOutputModeJson')}</option>
      </select>
    </NodeEditorField>
    {node.config.mode === 'text' ? <NodeEditorField label={t('workflowOutputText')}>
      <textarea className={`${NODE_INPUT_CLASS} min-h-[100px] resize-y font-mono`} value={node.config.textTemplate}
        placeholder="{{text}}"
        onChange={(event) => onChange({ ...node, config: { ...node.config, textTemplate: event.target.value } })} />
    </NodeEditorField> : null}
    {node.config.mode === 'json' ? <NodeEditorField label={t('workflowOutputJsonPath')}>
      <input className={NODE_INPUT_CLASS} value={node.config.jsonPath} placeholder="data.results"
        onChange={(event) => onChange({ ...node, config: { ...node.config, jsonPath: event.target.value } })} />
    </NodeEditorField> : null}
  </>
}
