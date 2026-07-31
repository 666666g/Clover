import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AppSettingsV1,
  WorkflowConditionOperator,
  WorkflowNodeV1
} from '@shared/app-settings'
import { NODE_INPUT_CLASS, NodeEditorField } from './NodeEditorPrimitives'

type NestedNode = Extract<WorkflowNodeV1, { type: 'subworkflow' | 'loop' }>

const CONDITION_OPERATORS: WorkflowConditionOperator[] = [
  'contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'endsWith',
  'isEmpty', 'isNotEmpty', 'gt', 'gte', 'lt', 'lte'
]

export function NestedNodeEditor({
  node,
  settings,
  onChange
}: {
  node: NestedNode
  settings: AppSettingsV1
  onChange: (node: WorkflowNodeV1) => void
}): ReactElement {
  const { t } = useTranslation('common')
  if (node.type === 'subworkflow') {
    return (
      <NodeEditorField label={t('workflowSubWorkflowTarget')}>
        <select
          className={NODE_INPUT_CLASS}
          value={node.config.workflowId}
          onChange={(event) => onChange({ ...node, config: { workflowId: event.target.value } })}
        >
          <option value="">{t('workflowSubWorkflowNone')}</option>
          {settings.workflow.workflows.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>{workflow.name || t('workflowUntitled')}</option>
          ))}
        </select>
      </NodeEditorField>
    )
  }
  const foreach = (node.config.mode ?? 'condition') === 'foreach'
  return (
    <>
      <NodeEditorField label={t('workflowLoopBody')}>
        <select
          className={NODE_INPUT_CLASS}
          value={node.config.workflowId}
          onChange={(event) => onChange({ ...node, config: { ...node.config, workflowId: event.target.value } })}
        >
          <option value="">{t('workflowSubWorkflowNone')}</option>
          {settings.workflow.workflows.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>{workflow.name || t('workflowUntitled')}</option>
          ))}
        </select>
      </NodeEditorField>
      <NodeEditorField label={t('workflowLoopMode')}>
        <select
          className={NODE_INPUT_CLASS}
          value={node.config.mode ?? 'condition'}
          onChange={(event) => onChange({
            ...node,
            config: { ...node.config, mode: event.target.value === 'foreach' ? 'foreach' : 'condition' }
          })}
        >
          <option value="condition">{t('workflowLoopMode_condition')}</option>
          <option value="foreach">{t('workflowLoopMode_foreach')}</option>
        </select>
      </NodeEditorField>
      <NodeEditorField label={t('workflowLoopMax')}>
        <input
          type="number"
          min={1}
          max={100}
          className={NODE_INPUT_CLASS}
          value={node.config.maxIterations}
          onChange={(event) => onChange({
            ...node,
            config: { ...node.config, maxIterations: Math.max(1, Math.min(100, Number(event.target.value) || 1)) }
          })}
        />
      </NodeEditorField>
      {foreach ? (
        <>
          <NodeEditorField label={t('workflowLoopArraySource')} hint={t('workflowLoopArraySourceHint')}>
            <input
              className={NODE_INPUT_CLASS}
              placeholder="{{json.items}}"
              value={node.config.arraySource ?? ''}
              onChange={(event) => onChange({ ...node, config: { ...node.config, arraySource: event.target.value } })}
            />
          </NodeEditorField>
          <NodeEditorField label={t('workflowLoopExecution')}>
            <select
              className={NODE_INPUT_CLASS}
              value={node.config.execution ?? 'sequential'}
              onChange={(event) => onChange({
                ...node,
                config: { ...node.config, execution: event.target.value === 'parallel' ? 'parallel' : 'sequential' }
              })}
            >
              <option value="sequential">{t('workflowLoopExecution_sequential')}</option>
              <option value="parallel">{t('workflowLoopExecution_parallel')}</option>
            </select>
          </NodeEditorField>
          {(node.config.execution ?? 'sequential') === 'parallel' ? (
            <NodeEditorField label={t('workflowLoopConcurrency')}>
              <input
                type="number"
                min={1}
                max={8}
                className={NODE_INPUT_CLASS}
                value={node.config.concurrency ?? 4}
                onChange={(event) => onChange({
                  ...node,
                  config: { ...node.config, concurrency: Math.max(1, Math.min(8, Number(event.target.value) || 1)) }
                })}
              />
            </NodeEditorField>
          ) : null}
          <label className="flex items-center gap-2 text-[12px] text-ds-muted">
            <input
              type="checkbox"
              checked={node.config.continueOnError ?? false}
              onChange={(event) => onChange({ ...node, config: { ...node.config, continueOnError: event.target.checked } })}
            />
            {t('workflowLoopContinueOnError')}
          </label>
        </>
      ) : (
        <>
          <span className="text-[12px] font-medium text-ds-muted">{t('workflowLoopStopWhen')}</span>
          <input
            className={NODE_INPUT_CLASS}
            placeholder={t('workflowConditionLeftPlaceholder')}
            value={node.config.leftExpr}
            onChange={(event) => onChange({ ...node, config: { ...node.config, leftExpr: event.target.value } })}
          />
          <select
            className={NODE_INPUT_CLASS}
            value={node.config.operator}
            onChange={(event) => onChange({
              ...node,
              config: { ...node.config, operator: event.target.value as WorkflowConditionOperator }
            })}
          >
            {CONDITION_OPERATORS.map((operator) => (
              <option key={operator} value={operator}>{t(`workflowOp_${operator}`)}</option>
            ))}
          </select>
          <input
            className={NODE_INPUT_CLASS}
            placeholder={t('workflowConditionValue')}
            value={node.config.rightValue}
            onChange={(event) => onChange({ ...node, config: { ...node.config, rightValue: event.target.value } })}
          />
        </>
      )}
    </>
  )
}
