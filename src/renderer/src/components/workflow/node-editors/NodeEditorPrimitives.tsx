import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  WORKFLOW_INPUT_FIELD_TYPES,
  type AppSettingsV1,
  type WorkflowInputFieldType,
  type WorkflowInputFieldV1,
  type WorkflowNodeV1
} from '@shared/app-settings'

export const NODE_INPUT_CLASS =
  'w-full rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25'

export function NodeEditorField({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}): ReactElement {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ds-muted">{label}</span>
      {children}
      {hint ? <span className="text-[11px] leading-4 text-ds-faint">{hint}</span> : null}
    </label>
  )
}

type CustomNode = Extract<WorkflowNodeV1, { type: 'custom' }>

/** Auto-generated form for a custom node, owned by its module schema. */
export function CustomNodeEditor({
  node,
  settings,
  onChange
}: {
  node: CustomNode
  settings: AppSettingsV1
  onChange: (node: WorkflowNodeV1) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const module = settings.workflow.modules.find((item) => item.id === node.config.moduleId)
  if (!module) {
    return <p className="text-[12px] leading-5 text-red-600">{t('workflowModuleMissing')}</p>
  }
  const setValue = (key: string, value: string): void =>
    onChange({ ...node, config: { ...node.config, values: { ...node.config.values, [key]: value } } })
  return (
    <>
      {module.description ? (
        <p className="text-[11.5px] leading-5 text-ds-faint">{module.description}</p>
      ) : null}
      {module.fields.length === 0 ? (
        <p className="text-[11.5px] leading-5 text-ds-faint">{t('workflowModuleNoFields')}</p>
      ) : null}
      {module.fields.map((field) => {
        const value = node.config.values[field.key] ?? field.defaultValue
        if (field.type === 'boolean') {
          return (
            <label key={field.key} className="flex items-center gap-2 text-[13px] text-ds-ink">
              <input
                type="checkbox"
                checked={value === 'true'}
                onChange={(event) => setValue(field.key, event.target.checked ? 'true' : 'false')}
              />
              {field.label || field.key}
            </label>
          )
        }
        return (
          <NodeEditorField key={field.key} label={field.label || field.key}>
            {field.type === 'textarea' ? (
              <textarea
                className={`${NODE_INPUT_CLASS} min-h-[80px] resize-y`}
                value={value}
                placeholder={field.placeholder}
                onChange={(event) => setValue(field.key, event.target.value)}
              />
            ) : field.type === 'select' ? (
              <select
                className={NODE_INPUT_CLASS}
                value={value}
                onChange={(event) => setValue(field.key, event.target.value)}
              >
                {!field.options.includes(value) ? <option value={value}>{value || '—'}</option> : null}
                {field.options.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            ) : (
              <input
                type={field.type === 'number' ? 'number' : 'text'}
                className={NODE_INPUT_CLASS}
                value={value}
                placeholder={field.placeholder}
                onChange={(event) => setValue(field.key, event.target.value)}
              />
            )}
          </NodeEditorField>
        )
      })}
    </>
  )
}

export function InputFieldsEditor({
  fields,
  onChange
}: {
  fields: WorkflowInputFieldV1[]
  onChange: (next: WorkflowInputFieldV1[]) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const addField = (): void =>
    onChange([
      ...fields,
      {
        key: `field${fields.length + 1}`,
        label: '',
        type: 'text',
        required: false,
        options: [],
        defaultValue: '',
        description: ''
      }
    ])
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-ds-muted">{t('workflowInputSchema')}</span>
        <button
          type="button"
          onClick={addField}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium text-accent transition hover:bg-accent/10"
        >
          <Plus className="h-3 w-3" strokeWidth={2} />
          {t('workflowInputAddField')}
        </button>
      </div>
      {fields.length === 0 ? (
        <p className="text-[11px] leading-4 text-ds-faint">{t('workflowInputSchemaHint')}</p>
      ) : fields.map((field, index) => {
        const update = (patch: Partial<WorkflowInputFieldV1>): void =>
          onChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
        return (
          <div key={index} className="flex flex-col gap-2 rounded-lg border border-ds-border p-2.5">
            <div className="flex items-center gap-2">
              <input
                className={`${NODE_INPUT_CLASS} min-w-0 flex-1`}
                value={field.key}
                placeholder={t('workflowInputKey')}
                onChange={(event) => update({ key: event.target.value })}
              />
              <select
                className={`${NODE_INPUT_CLASS} w-28 shrink-0`}
                value={field.type}
                onChange={(event) => update({ type: event.target.value as WorkflowInputFieldType })}
              >
                {WORKFLOW_INPUT_FIELD_TYPES.map((fieldType) => (
                  <option key={fieldType} value={fieldType}>{t(`workflowInputType_${fieldType}`)}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onChange(fields.filter((_, itemIndex) => itemIndex !== index))}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-faint transition hover:bg-red-500/10 hover:text-red-600"
                aria-label={t('workflowInputRemoveField')}
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                className={`${NODE_INPUT_CLASS} min-w-0 flex-1`}
                value={field.label}
                placeholder={t('workflowInputLabel')}
                onChange={(event) => update({ label: event.target.value })}
              />
              <input
                className={`${NODE_INPUT_CLASS} min-w-0 flex-1`}
                value={field.defaultValue}
                placeholder={t('workflowInputDefault')}
                onChange={(event) => update({ defaultValue: event.target.value })}
              />
            </div>
            {field.type === 'select' ? (
              <OptionsInput options={field.options} onCommit={(next) => update({ options: next })} />
            ) : null}
            <label className="flex items-center gap-2 text-[12px] text-ds-muted">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(event) => update({ required: event.target.checked })}
              />
              {t('workflowInputRequired')}
            </label>
          </div>
        )
      })}
    </>
  )
}

/** Comma-separated options input that preserves raw text until blur. */
function OptionsInput({
  options,
  onCommit
}: {
  options: string[]
  onCommit: (next: string[]) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const joined = options.join(', ')
  const [raw, setRaw] = useState(joined)
  useEffect(() => setRaw(joined), [joined])
  return (
    <input
      className={NODE_INPUT_CLASS}
      value={raw}
      placeholder={t('workflowModuleFieldOptions')}
      onChange={(event) => setRaw(event.target.value)}
      onBlur={() => onCommit(raw.split(',').map((option) => option.trim()).filter(Boolean))}
    />
  )
}
