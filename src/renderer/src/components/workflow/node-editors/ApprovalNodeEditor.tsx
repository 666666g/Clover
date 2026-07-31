import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkflowNodeV1 } from '@shared/app-settings'
import { NODE_INPUT_CLASS, NodeEditorField } from './NodeEditorPrimitives'

type ApprovalNode = Extract<WorkflowNodeV1, { type: 'human-approval' }>

export function ApprovalNodeEditor({ node, onChange }: {
  node: ApprovalNode
  onChange: (node: WorkflowNodeV1) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return <>
    <p className="text-[11.5px] leading-5 text-ds-faint">{t('workflowApprovalHint')}</p>
    <NodeEditorField label={t('workflowApprovalTitle')}>
      <input className={NODE_INPUT_CLASS} value={node.config.title}
        placeholder={t('workflowApprovalTitlePlaceholder')}
        onChange={(event) => onChange({ ...node, config: { ...node.config, title: event.target.value } })} />
    </NodeEditorField>
    <NodeEditorField label={t('workflowApprovalInstruction')}>
      <textarea className={`${NODE_INPUT_CLASS} min-h-[80px] resize-y`} value={node.config.instruction}
        placeholder={t('workflowApprovalInstructionPlaceholder')}
        onChange={(event) => onChange({ ...node, config: { ...node.config, instruction: event.target.value } })} />
    </NodeEditorField>
    <NodeEditorField label={t('workflowApprovalTimeout')} hint={t('workflowApprovalTimeoutHint')}>
      <input type="number" min={0} className={NODE_INPUT_CLASS} value={node.config.timeoutMs}
        onChange={(event) => onChange({ ...node, config: {
          ...node.config,
          timeoutMs: Math.max(0, Math.round(Number(event.target.value) || 0))
        } })} />
    </NodeEditorField>
    {node.config.timeoutMs > 0 ? <NodeEditorField label={t('workflowApprovalOnTimeout')}>
      <select className={NODE_INPUT_CLASS} value={node.config.onTimeout}
        onChange={(event) => onChange({ ...node, config: {
          ...node.config,
          onTimeout: event.target.value === 'approved' ? 'approved' : 'rejected'
        } })}>
        <option value="rejected">{t('workflowApprovalRejected')}</option>
        <option value="approved">{t('workflowApprovalApproved')}</option>
      </select>
    </NodeEditorField> : null}
  </>
}
