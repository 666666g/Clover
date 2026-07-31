import type { ReactElement } from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  SCHEDULE_REASONING_EFFORT_IDS,
  type ModelProviderProfileV1,
  type WorkflowNodeV1
} from '@shared/app-settings'
import { ModelPicker } from '../ModelPicker'
import {
  InputFieldsEditor,
  NODE_INPUT_CLASS,
  NodeEditorField
} from './NodeEditorPrimitives'

type ExtractionNode = Extract<WorkflowNodeV1, { type: 'parameter-extractor' | 'question-classifier' }>

export function ExtractionNodeEditor({
  node,
  providers,
  onChange
}: {
  node: ExtractionNode
  providers: ModelProviderProfileV1[]
  onChange: (node: WorkflowNodeV1) => void
}): ReactElement {
  const { t } = useTranslation('common')
  if (node.type === 'parameter-extractor') return <>
    <NodeEditorField label={t('workflowExtractSource')} hint={t('workflowExtractSourceHint')}>
      <input className={NODE_INPUT_CLASS} value={node.config.source} placeholder="{{text}}"
        onChange={(event) => onChange({ ...node, config: { ...node.config, source: event.target.value } })} />
    </NodeEditorField>
    <NodeEditorField label={t('workflowExtractInstruction')}>
      <textarea className={`${NODE_INPUT_CLASS} min-h-[72px] resize-y`} value={node.config.instruction}
        placeholder={t('workflowExtractInstructionPlaceholder')}
        onChange={(event) => onChange({ ...node, config: { ...node.config, instruction: event.target.value } })} />
    </NodeEditorField>
    <div className="flex flex-col gap-2 border-t border-ds-border pt-3">
      <InputFieldsEditor fields={node.config.fields}
        onChange={(next) => onChange({ ...node, config: { ...node.config, fields: next } })} />
    </div>
    <ModelPicker providers={providers} providerId={node.config.providerId} model={node.config.model}
      onChange={({ providerId, model }) => onChange({ ...node, config: { ...node.config, providerId, model } })}
      emptyHint={t('workflowModelEmptyHint')} />
    <NodeEditorField label={t('scheduleReasoning')}>
      <select className={NODE_INPUT_CLASS} value={node.config.reasoningEffort}
        onChange={(event) => onChange({ ...node, config: {
          ...node.config,
          reasoningEffort: event.target.value as typeof node.config.reasoningEffort
        } })}>
        {SCHEDULE_REASONING_EFFORT_IDS.map((effort) => (
          <option key={effort} value={effort}>{t(`scheduleReasoning_${effort}`)}</option>
        ))}
      </select>
    </NodeEditorField>
  </>
  return <>
    <NodeEditorField label={t('workflowExtractSource')} hint={t('workflowClassifySourceHint')}>
      <input className={NODE_INPUT_CLASS} value={node.config.source} placeholder="{{text}}"
        onChange={(event) => onChange({ ...node, config: { ...node.config, source: event.target.value } })} />
    </NodeEditorField>
    <NodeEditorField label={t('workflowExtractInstruction')}>
      <textarea className={`${NODE_INPUT_CLASS} min-h-[60px] resize-y`} value={node.config.instruction}
        placeholder={t('workflowClassifyInstructionPlaceholder')}
        onChange={(event) => onChange({ ...node, config: { ...node.config, instruction: event.target.value } })} />
    </NodeEditorField>
    <div className="flex flex-col gap-2 border-t border-ds-border pt-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-ds-muted">{t('workflowClassifyCategories')}</span>
        <button type="button" onClick={() => onChange({ ...node, config: {
          ...node.config,
          categories: [
            ...node.config.categories,
            { id: `cat-${node.config.categories.length + 1}-${Date.now().toString(36)}`, label: '' }
          ]
        } })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium text-accent transition hover:bg-accent/10">
          <Plus className="h-3 w-3" strokeWidth={2} />
          {t('workflowClassifyAddCategory')}
        </button>
      </div>
      {node.config.categories.map((category, index) => (
        <div key={category.id} className="flex items-center gap-2">
          <span className="w-5 shrink-0 text-center text-[11px] text-ds-faint">{index + 1}</span>
          <input className={NODE_INPUT_CLASS} value={category.label} placeholder={t('workflowClassifyCategoryLabel')}
            onChange={(event) => onChange({ ...node, config: {
              ...node.config,
              categories: node.config.categories.map((item, itemIndex) =>
                itemIndex === index ? { ...item, label: event.target.value } : item)
            } })} />
          <button type="button" disabled={node.config.categories.length <= 1}
            onClick={() => onChange({ ...node, config: {
              ...node.config,
              categories: node.config.categories.filter((_, itemIndex) => itemIndex !== index)
            } })}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-faint transition hover:bg-red-500/10 hover:text-red-600 disabled:opacity-40"
            aria-label={t('workflowClassifyRemoveCategory')}>
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
    <ModelPicker providers={providers} providerId={node.config.providerId} model={node.config.model}
      onChange={({ providerId, model }) => onChange({ ...node, config: { ...node.config, providerId, model } })}
      emptyHint={t('workflowModelEmptyHint')} />
  </>
}
