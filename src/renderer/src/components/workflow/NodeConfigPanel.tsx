import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Braces, ChevronDown, ChevronRight, FlaskConical, Loader2, Plus, Star, Trash2, X } from 'lucide-react'
import { describeNodeOutput, extractNodeRefs, varTypeToInputType } from '@shared/workflow-output-descriptors'
import { ModelPicker } from './ModelPicker'
import { TriggerNodeEditor } from './node-editors/TriggerNodeEditor'
import { AiNodeEditor } from './node-editors/AiNodeEditor'
import { LogicAndHttpNodeEditor } from './node-editors/LogicAndHttpNodeEditor'
import { CodeNodeEditor } from './node-editors/CodeNodeEditor'
import { NestedNodeEditor } from './node-editors/NestedNodeEditor'
import { isTransformNode, TransformNodeEditor } from './node-editors/TransformNodeEditor'
import { ExtractionNodeEditor } from './node-editors/ExtractionNodeEditor'
import { ApprovalNodeEditor } from './node-editors/ApprovalNodeEditor'
import {
  CustomNodeEditor as CustomNodeForm,
  InputFieldsEditor,
  NODE_INPUT_CLASS as INPUT_CLASS,
  NodeEditorField as Field
} from './node-editors/NodeEditorPrimitives'
import {
  SCHEDULE_REASONING_EFFORT_IDS,
  WORKFLOW_NODE_INPUT_TYPES,
  getModelProviderSettings,
  type AppSettingsV1,
  type WorkflowCodeCheckResult,
  type WorkflowConditionOperator,
  type WorkflowNodeErrorMode,
  type WorkflowNodeInputType,
  type WorkflowNodeInputV1,
  type WorkflowNodeRunResultV1,
  type WorkflowNodeV1,
  type WorkflowOutputVar,
  type WorkflowVarType
} from '@shared/app-settings'

/** A reachable upstream node, carrying the full node so the picker can derive its typed outputs. */
type UpstreamNode = { id: string; name: string; type: WorkflowNodeV1['type']; node: WorkflowNodeV1 }

/** The {{$nodes…}} token that resolves an upstream node's described field (json.<path>) or its raw text. */
function nodeFieldToken(nodeId: string, key: string): string {
  return key === 'text' ? `{{$nodes.${nodeId}.text}}` : `{{$nodes.${nodeId}.json.${key}}}`
}

/** Short, capitalized badge label for a var type (e.g. "String", "Number", "JSON"). */
function varTypeLabel(type: WorkflowVarType): string {
  if (type === 'json') return 'JSON'
  return type.charAt(0).toUpperCase() + type.slice(1)
}

const CONDITION_OPERATORS: WorkflowConditionOperator[] = [
  'contains',
  'notContains',
  'equals',
  'notEquals',
  'startsWith',
  'endsWith',
  'isEmpty',
  'isNotEmpty',
  'gt',
  'gte',
  'lt',
  'lte'
]

type Props = {
  node: WorkflowNodeV1 | null
  settings: AppSettingsV1
  lastResult?: WorkflowNodeRunResultV1 | null
  onChange: (node: WorkflowNodeV1) => void
  onDelete: (nodeId: string) => void
  /** Save the current node as a reusable palette preset. */
  onSavePreset?: (node: WorkflowNodeV1, label: string) => void
  /** Current workflow name, used to render the local HTTP invocation example on the trigger. */
  workflowName?: string
  /** Upstream nodes reachable from this one, for the {{$nodes.*}} variable picker. */
  upstreamNodes?: UpstreamNode[]
  /** Id of the workflow this node belongs to, for single-node testing. */
  workflowId?: string
  /** Persist the graph before a single-node test (so the test sees the latest config). */
  onBeforeTest?: () => Promise<void>
}

type InputSourceOption = {
  value: string
  label: string
  source: string
  /** Set for a typed field option — drives auto-typing + key suggestion on pick. */
  varType?: WorkflowVarType
  /** Suggested binding key (last path segment) when the user hasn't named one. */
  keySuggestion?: string
}

/**
 * Source options for an input binding, derived from the reachable upstream nodes.
 * Each described output field becomes a typed option (so picking it auto-sets the
 * binding's type); every node also keeps coarse .text / whole-.json escape hatches.
 */
function buildInputSourceOptions(
  upstreamNodes: UpstreamNode[],
  t: (key: string, opts?: Record<string, unknown>) => string
): InputSourceOption[] {
  const options: InputSourceOption[] = [
    { value: 'text', label: t('workflowInputSourceText'), source: '{{text}}' },
    { value: 'json', label: t('workflowInputSourceJson'), source: '{{json}}' }
  ]
  for (const upstream of upstreamNodes) {
    const name = upstream.name.trim() || t(`workflowNode_${upstream.type}`)
    for (const output of describeNodeOutput(upstream.node)) {
      options.push({
        value: `node:${upstream.id}:field:${output.key}`,
        label: `${name} · ${output.label || output.key}`,
        source: nodeFieldToken(upstream.id, output.key),
        varType: output.type,
        keySuggestion: output.key.split('.').pop() || output.key
      })
    }
    options.push({
      value: `node:${upstream.id}:text`,
      label: t('workflowInputSourceNodeText', { name }),
      source: `{{$nodes.${upstream.id}.text}}`
    })
    options.push({
      value: `node:${upstream.id}:json`,
      label: t('workflowInputSourceNodeJson', { name }),
      source: `{{$nodes.${upstream.id}.json}}`
    })
  }
  return options
}

/** A binding key derived from a suggestion, de-duplicated against keys already in use. */
function dedupeKey(suggestion: string, taken: string[]): string {
  const base = suggestion.trim() || 'field'
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

type DanglingRef = { token: string; reason: 'node' | 'field' }

/**
 * {{$nodes.<id>…}} references in this node's config/inputs whose target no longer
 * resolves — the node id isn't a reachable upstream node ('node'), or the field
 * isn't in that node's typed output ('field', only checked against a known
 * descriptor; opaque .json/.text drilling is never flagged). Renderer-only;
 * never alters the stored value. This is the safety net for refs that silently
 * break when a node is renamed/reconnected/deleted.
 */
function collectDanglingRefs(node: WorkflowNodeV1, upstreamNodes: UpstreamNode[]): DanglingRef[] {
  const refs = extractNodeRefs(JSON.stringify({ config: node.config, inputs: node.inputs ?? [] }))
  if (refs.length === 0) return []
  const byId = new Map(upstreamNodes.map((upstream) => [upstream.id, upstream]))
  const out: DanglingRef[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const upstream = byId.get(ref.nodeId)
    let reason: DanglingRef['reason'] | null = null
    if (!upstream) {
      reason = 'node'
    } else if (ref.firstField) {
      const fields = describeNodeOutput(upstream.node)
      if (fields.length > 0 && !fields.some((field) => field.key.split('.')[0] === ref.firstField)) {
        reason = 'field'
      }
    }
    if (!reason) continue
    const dedup = `${ref.token}|${reason}`
    if (seen.has(dedup)) continue
    seen.add(dedup)
    out.push({ token: ref.token, reason })
  }
  return out
}

/**
 * Optional, per-node typed inputs bound to upstream output (dify-style). Each
 * binding names an upstream value so the node can reference it precisely as
 * {{$input.key}}. Collapsed by default — most nodes just consume upstream output
 * automatically and never need this. The source is picked from a dropdown of
 * upstream fields, with a "custom expression" escape hatch for power users.
 */
function InputBindingsEditor({
  node,
  upstreamNodes,
  onChange
}: {
  node: WorkflowNodeV1
  upstreamNodes: UpstreamNode[]
  onChange: (node: WorkflowNodeV1) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const inputs = node.inputs ?? []
  const [expanded, setExpanded] = useState(inputs.length > 0)
  const sourceOptions = buildInputSourceOptions(upstreamNodes, t)
  const setInputs = (next: WorkflowNodeInputV1[]): void =>
    onChange({ ...node, inputs: next.length > 0 ? next : undefined })
  const defaultSource = upstreamNodes[0] ? `{{$nodes.${upstreamNodes[0].id}.text}}` : '{{text}}'
  const addInput = (): void => {
    setInputs([...inputs, { key: `field${inputs.length + 1}`, type: 'text', source: defaultSource }])
    setExpanded(true)
  }
  return (
    <div className="flex flex-col gap-2 border-t border-ds-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="-ml-1 inline-flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left text-[12px] font-medium text-ds-muted transition hover:text-ds-ink"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={2} />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={2} />
          )}
          <span className="truncate">{t('workflowNodeInputs')}</span>
          <span className="shrink-0 rounded-full bg-ds-subtle px-1.5 py-0.5 text-[10px] font-normal text-ds-faint">
            {inputs.length > 0 ? inputs.length : t('workflowOptional')}
          </span>
        </button>
        <button
          type="button"
          onClick={addInput}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium text-accent transition hover:bg-accent/10"
        >
          <Plus className="h-3 w-3" strokeWidth={2} />
          {t('workflowNodeInputAdd')}
        </button>
      </div>
      {expanded ? (
        <>
          <p className="text-[11px] leading-4 text-ds-faint">{t('workflowNodeInputsHint')}</p>
          {inputs.map((input, index) => {
            const update = (patch: Partial<WorkflowNodeInputV1>): void =>
              setInputs(inputs.map((item, i) => (i === index ? { ...item, ...patch } : item)))
            const matched = sourceOptions.find((option) => option.source === input.source.trim())
            const selectValue = matched ? matched.value : 'custom'
            const key = input.key.trim()
            const otherKeys = inputs.filter((_, i) => i !== index).map((item) => item.key.trim()).filter(Boolean)
            return (
              <div key={index} className="flex flex-col gap-2 rounded-lg border border-ds-border p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <label className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-[11px] font-medium text-ds-faint">{t('workflowInputSourceLabel')}</span>
                    <select
                      className={INPUT_CLASS}
                      value={selectValue}
                      onChange={(event) => {
                        const next = event.target.value
                        if (next === 'custom') {
                          // Entering custom mode: clear the preset so the box starts empty for typing.
                          if (matched) update({ source: '' })
                          return
                        }
                        const option = sourceOptions.find((item) => item.value === next)
                        if (!option) return
                        const patch: Partial<WorkflowNodeInputV1> = { source: option.source }
                        // Picking a typed field auto-sets the binding's type so it won't mis-coerce at runtime…
                        if (option.varType) patch.type = varTypeToInputType(option.varType)
                        // …and names the binding from the field when the user hasn't named one yet (Dify's guard).
                        if (!key && option.keySuggestion) patch.key = dedupeKey(option.keySuggestion, otherKeys)
                        update(patch)
                      }}
                    >
                      {sourceOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                      <option value="custom">{t('workflowInputSourceCustom')}</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => setInputs(inputs.filter((_, i) => i !== index))}
                    className="mt-[22px] inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-faint transition hover:bg-red-500/10 hover:text-red-600"
                    aria-label={t('workflowNodeInputRemove')}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </div>
                {selectValue === 'custom' ? (
                  <input
                    className={`${INPUT_CLASS} font-mono text-[12px]`}
                    value={input.source}
                    placeholder={t('workflowInputSourceCustomPlaceholder')}
                    onChange={(event) => update({ source: event.target.value })}
                  />
                ) : null}
                <div className="flex items-end gap-2">
                  <label className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-[11px] font-medium text-ds-faint">{t('workflowInputNameLabel')}</span>
                    <input
                      className={INPUT_CLASS}
                      value={input.key}
                      placeholder={t('workflowInputNamePlaceholder')}
                      onChange={(event) => update({ key: event.target.value })}
                    />
                  </label>
                  <label className="flex w-24 shrink-0 flex-col gap-1">
                    <span className="text-[11px] font-medium text-ds-faint">{t('workflowInputTypeLabel')}</span>
                    <select
                      className={INPUT_CLASS}
                      value={input.type}
                      onChange={(event) => update({ type: event.target.value as WorkflowNodeInputType })}
                    >
                      {WORKFLOW_NODE_INPUT_TYPES.map((inputType) => (
                        <option key={inputType} value={inputType}>
                          {t(`workflowInputType_${inputType}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="text-[11px] leading-4 text-ds-faint">
                  {t('workflowInputRefPreview')}{' '}
                  <code className="select-all font-mono text-accent">{`{{$input.${key || 'key'}}}`}</code>
                </p>
              </div>
            )
          })}
        </>
      ) : null}
    </div>
  )
}

/** Reusable typed-field editor — shared by the manual trigger's input schema and the Parameter Extractor. */
/** Small capitalized type pill for a picker row (e.g. String / Number / JSON). */
function TypeBadge({ type }: { type: WorkflowVarType }): ReactElement {
  return (
    <span className="shrink-0 rounded bg-ds-subtle px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-ds-faint">
      {varTypeLabel(type)}
    </span>
  )
}

/** Does a var (or any descendant) match the search query? */
function varMatchesQuery(output: WorkflowOutputVar, query: string): boolean {
  if (output.key.toLowerCase().includes(query) || (output.label ?? '').toLowerCase().includes(query)) return true
  return (output.children ?? []).some((child) => varMatchesQuery(child, query))
}

const PICKER_ROW =
  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-ds-ink transition hover:bg-ds-hover'

/** One described output field; recurses for object children (indented). Leaves insert a complete token. */
function VarRow({
  nodeId,
  output,
  prefix,
  depth,
  onInsert
}: {
  nodeId: string
  output: WorkflowOutputVar
  prefix: string
  depth: number
  onInsert: (token: string) => void
}): ReactElement {
  const path = prefix ? `${prefix}.${output.key}` : output.key
  const pad = { paddingLeft: `${8 + depth * 12}px` }
  if (output.children?.length) {
    return (
      <>
        <div className="flex items-center justify-between gap-2 px-2 py-1 text-[12px] text-ds-muted" style={pad}>
          <span className="min-w-0 truncate">{output.label || output.key}</span>
          <TypeBadge type={output.type} />
        </div>
        {output.children.map((child) => (
          <VarRow key={child.key} nodeId={nodeId} output={child} prefix={path} depth={depth + 1} onInsert={onInsert} />
        ))}
      </>
    )
  }
  return (
    <button
      type="button"
      className={PICKER_ROW}
      style={pad}
      onClick={() => onInsert(nodeFieldToken(nodeId, path))}
      title={nodeFieldToken(nodeId, path)}
    >
      <span className="min-w-0 truncate">{output.label || output.key}</span>
      <TypeBadge type={output.type} />
    </button>
  )
}

/**
 * Cascading, typed variable picker (dify-style). Lists the common scopes plus each
 * reachable upstream node's described output fields (with type badges), so authors
 * pick a field by click instead of hand-typing a {{$nodes.id.json.path}} expression.
 * Opaque nodes keep the whole-.json / .text escape hatches. Inserts today's token
 * grammar verbatim, so picked references are byte-identical to hand-typed ones.
 */
function VariablePicker({
  upstreamNodes,
  onInsert,
  onClose
}: {
  upstreamNodes: UpstreamNode[]
  onInsert: (token: string) => void
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const common = [
    { token: '{{text}}', label: '{{text}}' },
    { token: '{{json.}}', label: '{{json.…}}' },
    { token: '{{$input.}}', label: '{{$input.…}}' },
    { token: '{{$env.}}', label: '{{$env.…}}' },
    { token: '{{$run.}}', label: '{{$run.…}}' }
  ].filter((item) => !q || item.label.toLowerCase().includes(q))

  const groups = upstreamNodes
    .map((upstream) => ({
      upstream,
      name: upstream.name.trim() || t(`workflowNode_${upstream.type}`),
      vars: describeNodeOutput(upstream.node)
    }))
    .filter((group) => !q || group.name.toLowerCase().includes(q) || group.vars.some((v) => varMatchesQuery(v, q)))

  const header = 'px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-ds-faint'
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-9 z-50 flex max-h-[60vh] w-[280px] flex-col overflow-y-auto rounded-xl border border-ds-border bg-ds-elevated p-1.5 shadow-[0_24px_70px_rgba(44,55,78,0.22)] backdrop-blur-xl dark:shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
        <input
          autoFocus
          className={`${INPUT_CLASS} mb-1 py-1.5 text-[12px]`}
          placeholder={t('workflowVarSearch')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {common.length > 0 ? (
          <>
            <p className={header}>{t('workflowVarCommon')}</p>
            {common.map((item) => (
              <button key={item.token} type="button" className={PICKER_ROW} onClick={() => onInsert(item.token)}>
                <span className="font-mono text-accent">{item.label}</span>
              </button>
            ))}
          </>
        ) : null}
        {groups.length > 0 ? (
          <>
            <p className={header}>{t('workflowVarUpstream')}</p>
            {groups.map((group) => (
              <div key={group.upstream.id} className="mb-0.5">
                <p className="truncate px-2 pb-0.5 pt-1 text-[11px] font-medium text-ds-muted">{group.name}</p>
                {group.vars.map((output) => (
                  <VarRow
                    key={output.key}
                    nodeId={group.upstream.id}
                    output={output}
                    prefix=""
                    depth={0}
                    onInsert={onInsert}
                  />
                ))}
                <div className="flex items-stretch gap-1 pl-2">
                  <button
                    type="button"
                    className="flex-1 rounded-md px-2 py-1 text-left text-[10.5px] font-mono text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                    onClick={() => onInsert(`{{$nodes.${group.upstream.id}.json.}}`)}
                    title={`{{$nodes.${group.upstream.id}.json.…}}`}
                  >
                    .json…
                  </button>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-[10.5px] font-mono text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                    onClick={() => onInsert(`{{$nodes.${group.upstream.id}.text}}`)}
                    title={`{{$nodes.${group.upstream.id}.text}}`}
                  >
                    .text
                  </button>
                </div>
              </div>
            ))}
          </>
        ) : null}
        {common.length === 0 && groups.length === 0 ? (
          <p className="px-2 py-3 text-center text-[11.5px] text-ds-faint">{t('workflowVarNoMatch')}</p>
        ) : null}
      </div>
    </>
  )
}

export function NodeConfigPanel({
  node,
  settings,
  lastResult,
  onChange,
  onDelete,
  onSavePreset,
  workflowName,
  upstreamNodes = [],
  workflowId,
  onBeforeTest
}: Props): ReactElement {
  const { t } = useTranslation('common')

  const [presetLabel, setPresetLabel] = useState('')
  const [presetSaved, setPresetSaved] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  // Tracks the most recently focused text field so the variable picker can splice a token at its caret.
  const lastFocused = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // Drop the focus target when the selected node changes (the panel instance is reused).
  useEffect(() => {
    lastFocused.current = null
  }, [node?.id])

  const insertToken = (token: string): void => {
    setPickerOpen(false)
    // Prefer the last-focused field; otherwise fall back to the node's primary text
    // field (the first textarea, else the first text input) so a pick is never a no-op.
    let el = lastFocused.current
    if (!el || !el.isConnected) {
      el =
        panelRef.current?.querySelector<HTMLTextAreaElement>('textarea') ??
        panelRef.current?.querySelector<HTMLInputElement>('input[type="text"]') ??
        null
    }
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const next = `${el.value.slice(0, start)}${token}${el.value.slice(end)}`
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    setter?.call(el, next)
    // Fire a native input event so the field's React onChange writes it back into config.
    el.dispatchEvent(new Event('input', { bubbles: true }))
    const caret = start + token.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }
  // Debounced editor-time syntax check for the Code node (runs in the main process).
  const [codeCheck, setCodeCheck] = useState<WorkflowCodeCheckResult | null>(null)
  const codeValue = node && node.type === 'code' ? node.config.code : ''
  const codeLanguage = node && node.type === 'code' ? node.config.language : 'javascript'
  useEffect(() => {
    if (node?.type !== 'code' || !codeValue.trim()) {
      setCodeCheck(null)
      return
    }
    let cancelled = false
    const handle = setTimeout(() => {
      window.kunGui
        .checkWorkflowCode(codeLanguage, codeValue)
        .then((result) => {
          if (!cancelled) setCodeCheck(result)
        })
        .catch(() => {
          if (!cancelled) setCodeCheck(null)
        })
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [node?.type, codeValue, codeLanguage])

  if (!node) {
    return (
      <div className="workflow-node-config-empty flex h-full items-center justify-center px-6 text-center text-[13px] text-ds-faint">
        {t('workflowNoSelection')}
      </div>
    )
  }

  const providers = getModelProviderSettings(settings).providers
  const danglingRefs = collectDanglingRefs(node, upstreamNodes)

  return (
    <div ref={panelRef} className="workflow-node-config-panel flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-ds-border px-4 py-3">
        <h2 className="text-[13px] font-semibold text-ds-ink">
          {t(`workflowNode_${node.type}`)}
        </h2>
        <div className="flex items-center gap-1.5">
          {!node.type.endsWith('-trigger') && workflowId ? (
            <button
              type="button"
              onClick={() => setTestOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ds-border text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              title={t('workflowTestNode')}
              aria-label={t('workflowTestNode')}
            >
              <FlaskConical className="h-4 w-4" strokeWidth={1.8} />
            </button>
          ) : null}
          {!node.type.endsWith('-trigger') ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPickerOpen((open) => !open)}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition ${
                  pickerOpen
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-ds-border text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                }`}
                title={t('workflowVarPicker')}
                aria-label={t('workflowVarPicker')}
              >
                <Braces className="h-4 w-4" strokeWidth={1.8} />
              </button>
              {pickerOpen ? (
                <VariablePicker upstreamNodes={upstreamNodes} onInsert={insertToken} onClose={() => setPickerOpen(false)} />
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => onDelete(node.id)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ds-border text-ds-muted transition hover:bg-red-500/10 hover:text-red-600"
            title={t('workflowDeleteNode')}
            aria-label={t('workflowDeleteNode')}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
        onFocusCapture={(event) => {
          const target = event.target
          if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
            lastFocused.current = target
          }
        }}
      >
        <Field label={t('workflowNodeName')}>
          <input
            className={INPUT_CLASS}
            value={node.name}
            placeholder={t(`workflowNode_${node.type}`)}
            onChange={(event) => onChange({ ...node, name: event.target.value })}
          />
        </Field>

        {danglingRefs.length > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              {t('workflowDanglingTitle')}
            </div>
            {danglingRefs.map((ref, index) => (
              <div key={index} className="flex items-center justify-between gap-2 text-[11px]">
                <code className="min-w-0 truncate font-mono text-amber-700/90 dark:text-amber-300/90">{ref.token}</code>
                <span className="shrink-0 text-ds-faint">
                  {t(ref.reason === 'node' ? 'workflowDanglingNode' : 'workflowDanglingField')}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {!node.type.endsWith('-trigger') ? (
          <InputBindingsEditor key={node.id} node={node} upstreamNodes={upstreamNodes} onChange={onChange} />
        ) : null}

        {node.type === 'manual-trigger' || node.type === 'schedule-trigger' || node.type === 'webhook-trigger' ? (
          <TriggerNodeEditor
            node={node}
            settings={settings}
            workflowName={workflowName}
            inputSchemaEditor={node.type === 'manual-trigger' ? (
              <div className="flex flex-col gap-2 border-t border-ds-border pt-3">
                <InputFieldsEditor
                  fields={node.config.inputSchema ?? []}
                  onChange={(next) => onChange({ ...node, config: { ...node.config, inputSchema: next } })}
                />
              </div>
            ) : undefined}
            onChange={onChange}
          />
        ) : null}

        {node.type === 'ai-agent' || node.type === 'generate-image' ? (
          <AiNodeEditor node={node} settings={settings} onChange={onChange} />
        ) : null}

        {node.type === 'condition' ? (
          <LogicAndHttpNodeEditor node={node} onChange={onChange} />
        ) : null}

        {node.type === 'set-fields' ? (
          <LogicAndHttpNodeEditor node={node} onChange={onChange} />
        ) : null}

        {node.type === 'http-request' ? (
          <LogicAndHttpNodeEditor node={node} onChange={onChange} />
        ) : null}

        {node.type === 'switch' ? (
          <LogicAndHttpNodeEditor node={node} onChange={onChange} />
        ) : null}

        {node.type === 'code' ? (
          <CodeNodeEditor node={node} codeCheck={codeCheck} onChange={onChange} />
        ) : null}

        {node.type === 'subworkflow' ? (
          <NestedNodeEditor node={node} settings={settings} onChange={onChange} />
        ) : null}

        {node.type === 'loop' ? (
          <NestedNodeEditor node={node} settings={settings} onChange={onChange} />
        ) : null}

        {isTransformNode(node) ? (
          <TransformNodeEditor node={node} onChange={onChange} />
        ) : null}









        {node.type === 'parameter-extractor' ? (
          <ExtractionNodeEditor node={node} providers={providers} onChange={onChange} />
        ) : null}

        {node.type === 'question-classifier' ? (
          <ExtractionNodeEditor node={node} providers={providers} onChange={onChange} />
        ) : null}

        {node.type === 'human-approval' ? (
          <ApprovalNodeEditor node={node} onChange={onChange} />
        ) : null}

        {node.type === 'custom' ? <CustomNodeForm node={node} settings={settings} onChange={onChange} /> : null}

        {!node.type.endsWith('-trigger') ? (
          <div className="flex flex-col gap-2.5 border-t border-ds-border pt-3">
            <span className="text-[12px] font-medium text-ds-muted">{t('workflowErrorHandling')}</span>
            <Field label={t('workflowOnError')}>
              <select
                className={INPUT_CLASS}
                value={node.onError ?? 'fail'}
                onChange={(event) =>
                  onChange({ ...node, onError: event.target.value as WorkflowNodeErrorMode })
                }
              >
                {(['fail', 'continue', 'fallback'] as const).map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`workflowOnError_${mode}`)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-center gap-2">
              <Field label={t('workflowRetries')}>
                <input
                  type="number"
                  min={0}
                  max={10}
                  className={INPUT_CLASS}
                  value={node.retries ?? 0}
                  onChange={(event) =>
                    onChange({ ...node, retries: Math.max(0, Math.min(10, Math.round(Number(event.target.value) || 0))) })
                  }
                />
              </Field>
              <Field label={t('workflowRetryDelay')}>
                <input
                  type="number"
                  min={0}
                  className={INPUT_CLASS}
                  value={node.retryDelayMs ?? 0}
                  onChange={(event) =>
                    onChange({ ...node, retryDelayMs: Math.max(0, Math.round(Number(event.target.value) || 0)) })
                  }
                />
              </Field>
            </div>
            {node.onError === 'fallback' ? (
              <Field label={t('workflowFallbackJson')} hint={t('workflowFallbackJsonHint')}>
                <textarea
                  className={`${INPUT_CLASS} min-h-[60px] resize-y font-mono text-[12px]`}
                  value={node.fallbackJson ?? ''}
                  placeholder='{ "ok": false }'
                  onChange={(event) => onChange({ ...node, fallbackJson: event.target.value })}
                />
              </Field>
            ) : null}
          </div>
        ) : null}

        <label className="mt-2 flex items-center gap-2 text-[13px] text-ds-muted">
          <input
            type="checkbox"
            checked={node.disabled}
            onChange={(event) => onChange({ ...node, disabled: event.target.checked })}
          />
          {t('workflowNodeDisabled')}
        </label>

        {onSavePreset ? (
          <div className="flex flex-col gap-1.5 border-t border-ds-border pt-3">
            <span className="text-[12px] font-medium text-ds-muted">{t('workflowSaveAsPreset')}</span>
            <div className="flex items-center gap-2">
              <input
                className={INPUT_CLASS}
                value={presetLabel}
                placeholder={node.name.trim() || t(`workflowNode_${node.type}`)}
                onChange={(event) => setPresetLabel(event.target.value)}
              />
              <button
                type="button"
                onClick={() => {
                  onSavePreset(node, presetLabel)
                  setPresetLabel('')
                  setPresetSaved(true)
                  window.setTimeout(() => setPresetSaved(false), 1500)
                }}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-ds-border px-3 text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover"
              >
                <Star className="h-3.5 w-3.5" strokeWidth={1.8} />
                {t('workflowSaveAsPresetButton')}
              </button>
            </div>
            {presetSaved ? (
              <span className="text-[11.5px] text-emerald-600">{t('workflowPresetSaved')}</span>
            ) : (
              <span className="text-[11px] leading-4 text-ds-faint">{t('workflowSaveAsPresetHint')}</span>
            )}
          </div>
        ) : null}

        {lastResult && (lastResult.message || lastResult.error || lastResult.outputJson) ? (
          <div className="flex flex-col gap-1.5 border-t border-ds-border pt-3">
            <span className="text-[12px] font-medium text-ds-muted">{t('workflowLastOutput')}</span>
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ds-subtle px-3 py-2 text-[11.5px] leading-5 text-ds-muted">
              {lastResult.error || lastResult.message || lastResult.outputJson}
            </pre>
          </div>
        ) : null}
      </div>

      {testOpen && workflowId ? (
        <TestNodeDialog
          workflowId={workflowId}
          node={node}
          initialMock={lastResult?.inputJson || '{}'}
          onBeforeTest={onBeforeTest}
          onClose={() => setTestOpen(false)}
        />
      ) : null}
    </div>
  )
}

/** Run one node in isolation against a mock upstream payload and show its result. */
function TestNodeDialog({
  workflowId,
  node,
  initialMock,
  onBeforeTest,
  onClose
}: {
  workflowId: string
  node: WorkflowNodeV1
  initialMock: string
  onBeforeTest?: () => Promise<void>
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [mock, setMock] = useState(initialMock)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<WorkflowNodeRunResultV1 | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      await onBeforeTest?.()
      const response = await window.kunGui.testWorkflowNode(workflowId, node.id, mock)
      if (response.ok) setResult(response.result)
      else setError(response.message)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-[520px] flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-ds-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
            <span className="text-[14px] font-semibold text-ds-ink">{t('workflowTestNode')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ds-muted">{t('workflowTestMock')}</span>
            <span className="text-[11px] text-ds-faint">{t('workflowTestMockHint')}</span>
            <textarea
              className={`${INPUT_CLASS} min-h-[120px] resize-y font-mono text-[12px]`}
              value={mock}
              onChange={(event) => setMock(event.target.value)}
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-ds-userbubble px-4 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:opacity-60"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <FlaskConical className="h-4 w-4" strokeWidth={1.9} />}
            {t('workflowTestRun')}
          </button>
          {error ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-red-500/10 px-3 py-2 text-[11.5px] leading-5 text-red-600">
              {error}
            </pre>
          ) : null}
          {result ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[12px]">
                <span
                  className={`h-2 w-2 rounded-full ${result.status === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`}
                />
                <span className="font-medium text-ds-ink">
                  {result.status === 'error' ? t('workflowRunStatus_error') : t('workflowRunStatus_success')}
                </span>
                {result.message ? <span className="truncate text-ds-faint">{result.message}</span> : null}
              </div>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ds-subtle px-3 py-2 font-mono text-[11.5px] leading-5 text-ds-muted">
                {result.error || result.outputJson || result.message || '—'}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
