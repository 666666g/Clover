import type { ReactElement, MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Download,
  Image as ImageIcon,
  Redo,
  RefreshCw,
  Sparkles,
  Undo,
  Upload
} from 'lucide-react'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'

type Selection = {
  x: number
  y: number
  width: number
  height: number
}

type HistoryEntry = {
  dataUrl: string
  width: number
  height: number
}

type GenerateState =
  | { kind: 'idle' }
  | { kind: 'generating'; selection: Selection }
  | { kind: 'error'; message: string }

function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = dataUrl
  })
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function createMaskDataUrl(
  width: number,
  height: number,
  selection: Selection
): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  // OpenAI-style mask: transparent area indicates where to edit.
  // So the selected region is transparent, everything else is opaque white.
  ctx.fillStyle = 'rgba(255, 255, 255, 1)'
  ctx.fillRect(0, 0, width, height)
  ctx.clearRect(selection.x, selection.y, selection.width, selection.height)
  return canvas.toDataURL('image/png')
}

function createTransparentMaskDataUrl(width: number, height: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  // Fully transparent: edit the entire image.
  ctx.clearRect(0, 0, width, height)
  return canvas.toDataURL('image/png')
}

function canvasFromImage(
  img: HTMLImageElement,
  width: number,
  height: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.drawImage(img, 0, 0, width, height)
  }
  return canvas
}

function cropCanvasToDataUrl(
  source: HTMLCanvasElement,
  selection: Selection
): string {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(selection.width))
  canvas.height = Math.max(1, Math.round(selection.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.drawImage(
    source,
    selection.x,
    selection.y,
    selection.width,
    selection.height,
    0,
    0,
    canvas.width,
    canvas.height
  )
  return canvas.toDataURL('image/png')
}

function dataUrlToBlob(dataUrl: string): Blob {
  const byteString = atob(dataUrl.split(',')[1])
  const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0]
  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i)
  }
  return new Blob([ab], { type: mimeString })
}

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
}

export function ImageEditView({ leftSidebarCollapsed, onToggleLeftSidebar }: Props): ReactElement {
  const { t } = useTranslation('common')
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const [displayScale, setDisplayScale] = useState(1)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [prompt, setPrompt] = useState('')
  const [showPrompt, setShowPrompt] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [generateState, setGenerateState] = useState<GenerateState>({ kind: 'idle' })
  const [exportOpen, setExportOpen] = useState(false)

  const hasImage = imageSize !== null
  const canUndo = historyIndex > 0
  const canRedo = historyIndex < history.length - 1

  /**
   * 将当前画布内容记录到历史栈，并截断 redo 分支。
   */
  const pushHistory = useCallback((canvas: HTMLCanvasElement) => {
    const dataUrl = canvas.toDataURL('image/png')
    setHistory((prev) => {
      const next = prev.slice(0, historyIndex + 1)
      next.push({ dataUrl, width: canvas.width, height: canvas.height })
      return next
    })
    setHistoryIndex((prev) => prev + 1)
  }, [historyIndex])

  const undo = useCallback(() => {
    if (!canUndo) return
    setHistoryIndex(historyIndex - 1)
    setSelection(null)
    setShowPrompt(false)
  }, [canUndo, historyIndex])

  const redo = useCallback(() => {
    if (!canRedo) return
    setHistoryIndex(historyIndex + 1)
    setSelection(null)
    setShowPrompt(false)
  }, [canRedo, historyIndex])

  /**
   * 计算图片在画布中的实际缩放比例，使画布 CSS 尺寸与内部像素坐标对应。
   */
  const refreshDisplayScale = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !imageSize) return
    const rect = canvas.getBoundingClientRect()
    setDisplayScale(imageSize.width > 0 ? rect.width / imageSize.width : 1)
  }, [imageSize])

  useEffect(() => {
    refreshDisplayScale()
    window.addEventListener('resize', refreshDisplayScale)
    return () => window.removeEventListener('resize', refreshDisplayScale)
  }, [refreshDisplayScale])

  /**
   * 初始化画布并压入历史栈。
   */
  const loadImage = useCallback(async (dataUrl: string) => {
    try {
      const img = await dataUrlToImage(dataUrl)
      // 先渲染画布元素到 DOM，再由 useEffect 将历史记录绘制上去
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
      setHistory([{ dataUrl, width: img.naturalWidth, height: img.naturalHeight }])
      setHistoryIndex(0)
      setSelection(null)
      setShowPrompt(false)
      setGenerateState({ kind: 'idle' })
      setTimeout(refreshDisplayScale, 0)
    } catch {
      setGenerateState({ kind: 'error', message: t('imageEditAddFailed') })
    }
  }, [refreshDisplayScale, t])

  const handleAddImage = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const dataUrl = await fileToDataUrl(file)
      await loadImage(dataUrl)
    } catch {
      setGenerateState({ kind: 'error', message: t('imageEditAddFailed') })
    }
    e.target.value = ''
  }, [loadImage, t])

  const handleCopyImage = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith('image/'))
        if (!imageType) continue
        const blob = await item.getType(imageType)
        const dataUrl = await blobToDataUrl(blob)
        await loadImage(dataUrl)
        return
      }
      setGenerateState({ kind: 'error', message: t('imageEditCopyFailed') })
    } catch {
      setGenerateState({ kind: 'error', message: t('imageEditCopyFailed') })
    }
  }, [loadImage, t])

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent): void => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (!item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (!file) continue
        void (async () => {
          try {
            const dataUrl = await blobToDataUrl(file)
            await loadImage(dataUrl)
          } catch {
            setGenerateState({ kind: 'error', message: t('imageEditCopyFailed') })
          }
        })()
        e.preventDefault()
        return
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => {
      window.removeEventListener('paste', handlePaste)
    }
  }, [loadImage, t])

  /**
   * 将鼠标坐标转换为画布内部像素坐标。
   */
  const toCanvasPoint = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current
    if (!canvas || !imageSize) return null
    const rect = canvas.getBoundingClientRect()
    const scaleX = imageSize.width / rect.width
    const scaleY = imageSize.height / rect.height
    return {
      x: Math.max(0, Math.min(imageSize.width, (clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(imageSize.height, (clientY - rect.top) * scaleY))
    }
  }, [imageSize])

  const handleMouseDown = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!hasImage || generateState.kind === 'generating') return
    const point = toCanvasPoint(e.clientX, e.clientY)
    if (!point) return
    setSelection(null)
    setShowPrompt(false)
    setIsDragging(true)
    setDragStart(point)
  }, [hasImage, generateState.kind, toCanvasPoint])

  const handleMouseMove = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !dragStart || !imageSize) return
    const point = toCanvasPoint(e.clientX, e.clientY)
    if (!point) return
    const x = Math.min(dragStart.x, point.x)
    const y = Math.min(dragStart.y, point.y)
    const width = Math.abs(point.x - dragStart.x)
    const height = Math.abs(point.y - dragStart.y)
    setSelection({ x, y, width, height })
  }, [isDragging, dragStart, imageSize, toCanvasPoint])

  const handleMouseUp = useCallback(() => {
    if (!isDragging) return
    setIsDragging(false)
    setDragStart(null)
    if (selection && selection.width > 8 && selection.height > 8) {
      setShowPrompt(true)
      setPrompt('')
    } else {
      setSelection(null)
      setShowPrompt(false)
    }
  }, [isDragging, selection])

  /**
   * 将当前历史记录中的图片绘制到底层画布（仅在历史记录变化时重绘，避免闪烁）。
   */
  useEffect(() => {
    const canvas = canvasRef.current
    const entry = history[historyIndex]
    if (!canvas || !entry) return

    canvas.width = entry.width
    canvas.height = entry.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    }
    img.src = entry.dataUrl
  }, [history, historyIndex])

  /**
   * 在透明覆盖画布上绘制选框（跟随鼠标实时更新，不重新加载底层图片）。
   */
  useEffect(() => {
    const overlay = overlayCanvasRef.current
    const base = canvasRef.current
    if (!overlay || !base) return

    overlay.width = base.width
    overlay.height = base.height
    const ctx = overlay.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, overlay.width, overlay.height)
    if (selection && selection.width > 0 && selection.height > 0) {
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.9)'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.strokeRect(selection.x, selection.y, selection.width, selection.height)
      ctx.fillStyle = 'rgba(59, 130, 246, 0.1)'
      ctx.fillRect(selection.x, selection.y, selection.width, selection.height)
      ctx.setLineDash([])
    }
  }, [selection])

  /**
   * 提交编辑请求：仅裁剪框选区域进行生成，再将结果合成回原图。
   */
  const submitEdit = useCallback(async () => {
    const trimmed = prompt.trim()
    if (!trimmed || !selection || !imageSize || !canvasRef.current) return
    const canvas = canvasRef.current
    setGenerateState({ kind: 'generating', selection })
    try {
      if (typeof window.kunGui?.editImage !== 'function') {
        throw new Error(t('imageEditProviderNotConfigured'))
      }
      // 1. 裁剪出框选区域
      const patchDataUrl = cropCanvasToDataUrl(canvas, selection)
      const patchImg = await dataUrlToImage(patchDataUrl)
      const patchMask = createTransparentMaskDataUrl(patchImg.naturalWidth, patchImg.naturalHeight)
      // 2. 仅对裁剪区域调用图片生成
      const result = await window.kunGui.editImage({
        originalImage: patchDataUrl,
        maskImage: patchMask,
        prompt: trimmed
      })
      if (!result.ok) {
        throw new Error(result.error ?? 'unknown error')
      }
      // 3. 将生成结果合成回原画布
      const generatedImg = await dataUrlToImage(result.imageDataUrl)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(
        generatedImg,
        0,
        0,
        generatedImg.naturalWidth,
        generatedImg.naturalHeight,
        selection.x,
        selection.y,
        selection.width,
        selection.height
      )
      pushHistory(canvas)
      setSelection(null)
      setShowPrompt(false)
      setPrompt('')
      setGenerateState({ kind: 'idle' })
    } catch (error) {
      setGenerateState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [historyIndex, imageSize, prompt, pushHistory, selection, t])

  const handlePromptKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void submitEdit()
    }
  }, [submitEdit])

  const regenerate = useCallback(() => {
    if (!selection) return
    void submitEdit()
  }, [selection, submitEdit])

  const exportImage = useCallback((format: 'png' | 'jpeg' | 'webp') => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dataUrl = canvas.toDataURL(`image/${format}`)
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `image-edit-${Date.now()}.${format === 'jpeg' ? 'jpg' : format}`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setExportOpen(false)
  }, [])

  const promptDialogPosition = useMemo(() => {
    if (!selection || !imageSize) return { left: 0, top: 0 }
    return {
      left: (selection.x + selection.width / 2) / imageSize.width,
      top: (selection.y + selection.height + 8) / imageSize.height
    }
  }, [selection, imageSize])

  return (
    <div ref={containerRef} className="ds-no-drag flex h-full flex-col bg-ds-main">
      {/* 顶部工具栏 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-ds-line px-3">
        <div className="flex items-center gap-2">
          {leftSidebarCollapsed && (
            <SidebarTitlebarToggleButton title="Toggle sidebar" onClick={onToggleLeftSidebar} />
          )}
          <ImageIcon className="h-4 w-4 text-ds-muted" strokeWidth={1.75} />
          <span className="text-sm font-medium text-ds-text">{t('imageEdit')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ToolbarButton icon={<Upload className="h-4 w-4" />} label={t('imageEditAddImage')} onClick={handleAddImage} />
          <ToolbarButton icon={<ImageIcon className="h-4 w-4" />} label={t('imageEditCopyImage')} onClick={handleCopyImage} />
          <div className="mx-1.5 h-5 w-px bg-ds-line" />
          <ToolbarButton icon={<Undo className="h-4 w-4" />} label={t('imageEditUndo')} onClick={undo} disabled={!canUndo} />
          <ToolbarButton icon={<Redo className="h-4 w-4" />} label={t('imageEditRedo')} onClick={redo} disabled={!canRedo} />
          <ToolbarButton icon={<RefreshCw className="h-4 w-4" />} label={t('imageEditRegenerate')} onClick={regenerate} disabled={!selection || generateState.kind === 'generating'} />
          <div className="relative">
            <ToolbarButton icon={<Download className="h-4 w-4" />} label={t('imageEditExport')} onClick={() => setExportOpen((v) => !v)} disabled={!hasImage} />
            {exportOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-md border border-ds-line bg-ds-popover py-1 shadow-lg">
                <ExportItem label={t('imageEditExportPng')} onClick={() => exportImage('png')} />
                <ExportItem label={t('imageEditExportJpeg')} onClick={() => exportImage('jpeg')} />
                <ExportItem label={t('imageEditExportWebp')} onClick={() => exportImage('webp')} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 隐藏的文件选择器：使用 opacity-0 而不是 hidden，确保在 Electron 中调用 click() 能打开对话框 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="pointer-events-none absolute h-px w-px opacity-0"
        tabIndex={-1}
        onChange={handleFileChange}
      />

      {/* 全局错误提示 */}
      {generateState.kind === 'error' && (
        <div className="mx-3 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {generateState.message}
        </div>
      )}

      {/* 主体画布区域 */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        {!hasImage ? (
          <EmptyState
            icon={<ImageIcon className="h-10 w-10" strokeWidth={1.5} />}
            title={t('imageEditNoImage')}
            hint={t('imageEditAddImageHint')}
            actions={
              <div className="mt-4 flex items-center gap-2">
                <ActionButton icon={<Upload className="h-4 w-4" />} label={t('imageEditAddImage')} onClick={handleAddImage} />
                <ActionButton icon={<ImageIcon className="h-4 w-4" />} label={t('imageEditCopyImage')} onClick={handleCopyImage} />
              </div>
            }
          />
        ) : (
          <div className="relative shadow-lg">
            <canvas
              ref={canvasRef}
              className="ds-no-drag max-h-[calc(100vh-8rem)] max-w-[calc(100vw-4rem)] cursor-crosshair object-contain"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
            <canvas
              ref={overlayCanvasRef}
              className="ds-no-drag pointer-events-none absolute left-0 top-0 max-h-[calc(100vh-8rem)] max-w-[calc(100vw-4rem)] object-contain"
            />
            {showPrompt && selection && imageSize && (
              <form
                className="image-edit-prompt absolute z-40 -translate-x-1/2"
                style={{
                  left: `${promptDialogPosition.left * 100}%`,
                  top: `${promptDialogPosition.top * 100}%`
                }}
                onSubmit={(event) => {
                  event.preventDefault()
                  void submitEdit()
                }}
              >
                <Sparkles className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handlePromptKeyDown}
                  placeholder={t('imageEditPromptPlaceholder')}
                  className="image-edit-prompt-input"
                  autoFocus
                  disabled={generateState.kind === 'generating'}
                />
                <button
                  type="submit"
                  aria-label={generateState.kind === 'generating' ? t('imageEditGenerating') : t('imageEditSend')}
                  title={generateState.kind === 'generating' ? t('imageEditGenerating') : t('imageEditSend')}
                  disabled={!prompt.trim() || generateState.kind === 'generating'}
                  className="image-edit-prompt-submit"
                >
                  {generateState.kind === 'generating' ? (
                    <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <Sparkles className="h-4 w-4" strokeWidth={2} />
                  )}
                </button>
              </form>
            )}
          </div>
        )}

        {hasImage && !showPrompt && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-ds-line bg-ds-popover/90 px-3 py-1.5 text-xs text-ds-muted shadow">
            {t('imageEditSelectionHint')}
          </div>
        )}
      </div>
    </div>
  )
}

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled = false
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="ds-no-drag flex h-7 items-center gap-1.5 rounded-md border border-ds-line bg-ds-button px-2 text-xs font-medium text-ds-text hover:bg-ds-button-hover disabled:opacity-40"
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function ActionButton({
  icon,
  label,
  onClick
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ds-no-drag flex h-9 items-center gap-1.5 rounded-md bg-ds-primary px-3 text-sm font-medium text-ds-primary-text hover:opacity-90"
    >
      {icon}
      {label}
    </button>
  )
}

function ExportItem({ label, onClick }: { label: string; onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-3 py-1.5 text-left text-xs text-ds-text hover:bg-ds-subtle"
    >
      {label}
    </button>
  )
}

function EmptyState({
  icon,
  title,
  hint,
  actions
}: {
  icon: React.ReactNode
  title: string
  hint: string
  actions: React.ReactNode
}): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center">
      <div className="text-ds-faint">{icon}</div>
      <p className="text-base font-medium text-ds-text">{title}</p>
      <p className="max-w-sm text-sm text-ds-muted">{hint}</p>
      {actions}
    </div>
  )
}
