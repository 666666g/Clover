import type { ReactElement } from 'react'
import { lazy, Suspense } from 'react'

const LazyStreamdownAssistant = lazy(() =>
  import('./StreamdownAssistant').then((module) => ({ default: module.StreamdownAssistant }))
)

export function AssistantMarkdown({
  text,
  streaming,
  className,
  hideHtmlComments = false
}: {
  text: string
  streaming: boolean
  className?: string
  hideHtmlComments?: boolean
}): ReactElement {
  const fallbackText = hideHtmlComments
    ? text.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    : text

  return (
    <Suspense
      fallback={
        <div className={className}>
          {fallbackText}
        </div>
      }
    >
      <LazyStreamdownAssistant
        text={text}
        streaming={streaming}
        className={className}
        hideHtmlComments={hideHtmlComments}
      />
    </Suspense>
  )
}
