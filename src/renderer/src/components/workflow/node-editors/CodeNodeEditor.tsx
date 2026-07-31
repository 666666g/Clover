import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  WorkflowCodeCheckResult,
  WorkflowCodeLanguage,
  WorkflowNodeV1
} from '@shared/app-settings'
import {
  NODE_INPUT_CLASS,
  NodeEditorField
} from './NodeEditorPrimitives'

type CodeNode = Extract<WorkflowNodeV1, { type: 'code' }>

const CODE_PLACEHOLDERS: Record<WorkflowCodeLanguage, string> = {
  javascript: 'return { value: $json }',
  python: 'import sys, json\ndata = json.load(sys.stdin)\nprint(data.get("text", ""))',
  bash: 'echo "$WORKFLOW_TEXT" | tr a-z A-Z'
}

export function CodeNodeEditor({
  node,
  codeCheck,
  onChange
}: {
  node: CodeNode
  codeCheck: WorkflowCodeCheckResult | null
  onChange: (node: WorkflowNodeV1) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <>
      <NodeEditorField label={t('workflowCodeLanguage')}>
        <select
          className={NODE_INPUT_CLASS}
          value={node.config.language}
          onChange={(event) =>
            onChange({
              ...node,
              config: {
                ...node.config,
                language: event.target.value === 'python' || event.target.value === 'bash'
                  ? event.target.value
                  : 'javascript'
              }
            })
          }
        >
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="bash">Shell (bash)</option>
        </select>
      </NodeEditorField>
      <NodeEditorField label={t('workflowCode')}>
        <textarea
          className={`${NODE_INPUT_CLASS} min-h-[160px] resize-y font-mono`}
          value={node.config.code}
          placeholder={CODE_PLACEHOLDERS[node.config.language]}
          onChange={(event) => onChange({ ...node, config: { ...node.config, code: event.target.value } })}
        />
      </NodeEditorField>
      <p className="text-[11.5px] leading-5 text-ds-faint">
        {t(node.config.language === 'javascript' ? 'workflowCodeHintJs' : 'workflowCodeHintCmd')}
      </p>
      {codeCheck?.status === 'error' ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2">
          <div className="text-[11.5px] font-semibold text-red-600">{t('workflowCodeSyntaxError')}</div>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-red-600/90">
            {codeCheck.message}
          </pre>
        </div>
      ) : codeCheck?.status === 'ok' ? (
        <div className="text-[11.5px] font-medium text-emerald-600">✓ {t('workflowCodeSyntaxOk')}</div>
      ) : codeCheck?.status === 'unavailable' ? (
        <div className="text-[11.5px] text-ds-faint">{codeCheck.message}</div>
      ) : null}
    </>
  )
}
