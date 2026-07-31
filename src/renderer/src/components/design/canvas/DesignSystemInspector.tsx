import { useMemo, useRef, useState, type ReactElement } from 'react'
import { parseProjectDesignMd, patchProjectDesignMd, type DesignMdStructuredPatch } from '../../../design/design-md/design-md-adapter'
import { applyProjectDesignMdToNativeCanvas } from '../../../design/design-md/design-md-apply'
import { saveProjectDesignMd } from '../../../design/canvas/use-project-design-system-sync'
import { useProjectDesignSystemStore } from '../../../design/canvas/project-design-system-store'
import { DESIGN_MD_HIGHLIGHT_CLASS, highlightDesignMdLine } from './design-system-inspector-model'

function SectionTitle({ children }: { children: string }): ReactElement {
  return <h3 className="pt-2 text-xs font-semibold uppercase tracking-[0.14em] opacity-50">{children}</h3>
}

function SmallInput(props: React.InputHTMLAttributes<HTMLInputElement>): ReactElement {
  return <input {...props} className={`min-w-0 rounded-lg border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-blue-500 ${props.className ?? ''}`} />
}

export function DesignSystemInspector({ workspaceRoot }: { workspaceRoot: string }): ReactElement | null {
  const open = useProjectDesignSystemStore((state) => state.inspectorOpen)
  const setOpen = useProjectDesignSystemStore((state) => state.setInspectorOpen)
  const document = useProjectDesignSystemStore((state) => state.document)
  const draft = useProjectDesignSystemStore((state) => state.draft)
  const status = useProjectDesignSystemStore((state) => state.status)
  const conflict = useProjectDesignSystemStore((state) => state.conflict)
  const setDraft = useProjectDesignSystemStore((state) => state.setDraft)
  const discardDraft = useProjectDesignSystemStore((state) => state.discardDraft)
  const acceptConflictCurrent = useProjectDesignSystemStore((state) => state.acceptConflictCurrent)
  const rebaseConflictDraft = useProjectDesignSystemStore((state) => state.rebaseConflictDraft)
  const [tab, setTab] = useState<'theme' | 'raw'>('theme')
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>('dark')
  const [feedback, setFeedback] = useState('')
  const highlightRef = useRef<HTMLPreElement>(null)
  const content = draft?.content ?? document?.raw ?? ''
  const parsed = useMemo(() => parseProjectDesignMd(content), [content])
  if (!open || !document) return null

  const close = (): void => {
    if (draft?.dirty && !window.confirm('Discard unsaved DESIGN.md changes?')) return
    discardDraft()
    setOpen(false)
  }
  const patch = (entry: DesignMdStructuredPatch): void => {
    const result = patchProjectDesignMd(content, [entry])
    if (result.document) setDraft(result.document.raw)
  }
  const save = async (apply: boolean): Promise<void> => {
    setFeedback('')
    const ok = await saveProjectDesignMd(workspaceRoot, content, draft?.baseHash ?? document.sourceHash)
    if (!ok) return
    if (apply && parsed.document) {
      const result = applyProjectDesignMdToNativeCanvas(parsed.document)
      setFeedback(result.affectedIds.length ? `Saved and applied to ${result.affectedIds.length} linked layers.` : 'Saved; no linked layers needed updates.')
    } else setFeedback('Saved DESIGN.md.')
  }
  const reloadConflict = (): void => {
    if (!conflict) return
    const current = parseProjectDesignMd(conflict.currentContent)
    if (current.ok && current.document) acceptConflictCurrent(current.document)
  }
  const saveMineAfterConflict = (): void => {
    rebaseConflictDraft()
    queueMicrotask(() => {
      const state = useProjectDesignSystemStore.getState()
      if (state.draft) void saveProjectDesignMd(workspaceRoot, state.draft.content, state.draft.baseHash)
    })
  }
  const saveDisabled = !draft?.dirty || !parsed.ok || status === 'saving' || status === 'conflict'

  return (
    <aside className="absolute bottom-4 right-16 top-4 z-[70] flex w-[min(440px,calc(100%-32px))] flex-col overflow-hidden rounded-[28px] border border-black/10 bg-white/95 shadow-2xl backdrop-blur dark:bg-[#242528]/95" aria-label="DESIGN.md inspector">
      <header className="flex items-center justify-between px-6 py-5"><h2 className="truncate text-lg font-semibold">{document.name}</h2><button type="button" className="rounded-full px-3 py-1 hover:bg-black/5" onClick={close} aria-label="Close design system inspector">×</button></header>
      <div className="grid grid-cols-2 border-b px-5" role="tablist" aria-label="Design system inspector sections">
        <button type="button" role="tab" aria-selected={tab === 'theme'} className={`py-3 ${tab === 'theme' ? 'border-b-2 border-black font-semibold dark:border-white' : 'opacity-50'}`} onClick={() => setTab('theme')}>Theme</button>
        <button type="button" role="tab" aria-selected={tab === 'raw'} className={`py-3 ${tab === 'raw' ? 'border-b-2 border-black font-semibold dark:border-white' : 'opacity-50'}`} onClick={() => setTab('raw')}>DESIGN.md</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {tab === 'theme' ? (
          <div className="space-y-5" data-preview-mode={previewMode}>
            <SectionTitle>Preview mode</SectionTitle>
            <div className="grid grid-cols-2 rounded-full bg-black/5 p-1 dark:bg-white/5"><button type="button" className={`rounded-full py-2 text-sm ${previewMode === 'light' ? 'bg-white shadow dark:bg-white/15' : 'opacity-50'}`} onClick={() => setPreviewMode('light')}>☀ Light</button><button type="button" className={`rounded-full py-2 text-sm ${previewMode === 'dark' ? 'bg-white shadow dark:bg-white/15' : 'opacity-50'}`} onClick={() => setPreviewMode('dark')}>☾ Dark</button></div>
            <SectionTitle>Color palette</SectionTitle>
            {Object.entries(parsed.document?.colors ?? {}).map(([key, color]) => <label key={key} className="flex items-center gap-3"><input type="color" aria-label={`${key} color`} className="h-10 w-10 rounded border-0" value={color.hex ?? '#000000'} onChange={(event) => patch({ section: 'colors', key, value: event.target.value })} /><span className="min-w-0 flex-1 truncate text-sm">{key}</span><SmallInput aria-label={`${key} value`} className="w-28 font-mono" value={color.raw} onChange={(event) => patch({ section: 'colors', key, value: event.target.value })} /></label>)}
            <SectionTitle>Typography</SectionTitle>
            {Object.entries(parsed.document?.typography ?? {}).map(([key, type]) => <div key={key} className="rounded-xl border p-3"><div className="mb-2 text-sm font-medium">{key}</div><div className="grid grid-cols-2 gap-2"><SmallInput aria-label={`${key} font family`} value={type.fontFamily ?? ''} placeholder="Font family" onChange={(event) => patch({ section: 'typography', key, value: { ...type.raw, fontFamily: event.target.value } })} /><SmallInput aria-label={`${key} font size`} value={type.fontSize?.raw ?? ''} placeholder="16px" onChange={(event) => patch({ section: 'typography', key, value: { ...type.raw, fontSize: event.target.value } })} /></div></div>)}
            <SectionTitle>Rounded</SectionTitle>
            <div className="grid grid-cols-2 gap-2">{Object.entries(parsed.document?.rounded ?? {}).map(([key, value]) => <label key={key} className="grid grid-cols-[1fr_76px] items-center gap-2 rounded-xl border p-2 text-xs"><span className="truncate">{key}</span><SmallInput aria-label={`${key} rounded`} value={value.raw} onChange={(event) => patch({ section: 'rounded', key, value: event.target.value })} /></label>)}</div>
            <SectionTitle>Spacing</SectionTitle>
            <div className="grid grid-cols-2 gap-2">{Object.entries(parsed.document?.spacing ?? {}).map(([key, value]) => <label key={key} className="grid grid-cols-[1fr_76px] items-center gap-2 rounded-xl border p-2 text-xs"><span className="truncate">{key}</span><SmallInput aria-label={`${key} spacing`} value={value.raw} onChange={(event) => patch({ section: 'spacing', key, value: event.target.value })} /></label>)}</div>
            {Object.keys(parsed.document?.components ?? {}).length ? <><SectionTitle>Components</SectionTitle>{Object.entries(parsed.document?.components ?? {}).map(([key, properties]) => <div key={key} className="rounded-xl border p-3"><div className="mb-2 text-sm font-medium">{key}</div>{Object.entries(properties).map(([property, value]) => <label key={property} className="mt-2 grid grid-cols-[1fr_150px] items-center gap-2 text-xs"><span className="truncate">{property}</span><SmallInput aria-label={`${key} ${property}`} value={String(value)} onChange={(event) => patch({ section: 'components', key, value: { ...properties, [property]: event.target.value } })} /></label>)}</div>)}</> : null}
          </div>
        ) : (
          <div className="flex h-full min-h-[480px] flex-col gap-3">
            <div className="flex items-center justify-between text-xs opacity-60"><span>YAML + Markdown</span><button type="button" onClick={() => void navigator.clipboard.writeText(content)}>Copy</button></div>
            <div className="relative min-h-[420px] flex-1 overflow-hidden rounded-xl border bg-black/[.03] focus-within:border-blue-500 dark:bg-white/[.04]">
              <pre ref={highlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre p-4 font-mono text-xs leading-5">{content.split('\n').map((line, lineIndex) => <span key={lineIndex}>{highlightDesignMdLine(line).map((token, tokenIndex) => <span key={tokenIndex} className={DESIGN_MD_HIGHLIGHT_CLASS[token.kind]}>{token.text}</span>)}{'\n'}</span>)}</pre>
              <textarea
                aria-label="Raw DESIGN.md source"
                spellCheck={false}
                className="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent p-4 font-mono text-xs leading-5 text-transparent outline-none selection:bg-blue-300/40"
                style={{ caretColor: '#3b82f6' }}
                value={content}
                onScroll={(event) => { if (highlightRef.current) { highlightRef.current.scrollTop = event.currentTarget.scrollTop; highlightRef.current.scrollLeft = event.currentTarget.scrollLeft } }}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); if (!saveDisabled) void save(false) } }}
              />
            </div>
            {parsed.diagnostics.length ? <div className="max-h-32 space-y-1 overflow-auto text-xs" role="status">{parsed.diagnostics.slice(0, 8).map((item, index) => <div key={`${item.message}-${index}`} className={item.severity === 'error' ? 'text-red-500' : item.severity === 'warning' ? 'text-amber-500' : 'opacity-60'}>{item.path ? `${item.path}: ` : ''}{item.message}</div>)}</div> : null}
          </div>
        )}
      </div>
      {conflict ? <div className="mx-5 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"><div className="mb-2">DESIGN.md changed externally. Choose which revision to keep.</div><div className="flex gap-2"><button type="button" className="rounded-full border px-3 py-1" onClick={reloadConflict}>Reload external</button><button type="button" className="rounded-full bg-amber-600 px-3 py-1 text-white" onClick={saveMineAfterConflict}>Save my draft</button></div></div> : null}
      {feedback ? <div className="px-6 py-2 text-xs text-emerald-600" role="status">{feedback}</div> : null}
      <footer className="flex justify-end gap-2 border-t p-5"><button type="button" className="rounded-full border px-4 py-2" onClick={discardDraft} disabled={!draft?.dirty}>Reset</button><button type="button" className="rounded-full border px-4 py-2 disabled:opacity-30" disabled={saveDisabled} onClick={() => void save(false)}>Save</button><button type="button" className="rounded-full bg-black px-4 py-2 text-white disabled:opacity-30 dark:bg-white dark:text-black" disabled={saveDisabled} onClick={() => void save(true)}>{status === 'saving' ? 'Saving…' : 'Save & Apply'}</button></footer>
    </aside>
  )
}
