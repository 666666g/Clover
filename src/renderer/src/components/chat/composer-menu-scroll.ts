export function calculateComposerMenuScrollTop({
  containerScrollTop,
  containerClientHeight,
  itemOffsetTop,
  itemOffsetHeight
}: {
  containerScrollTop: number
  containerClientHeight: number
  itemOffsetTop: number
  itemOffsetHeight: number
}): number {
  const currentTop = Math.max(0, containerScrollTop)
  const visibleHeight = Math.max(0, containerClientHeight)
  if (visibleHeight <= 0) return currentTop

  const itemTop = Math.max(0, itemOffsetTop)
  const itemBottom = itemTop + Math.max(0, itemOffsetHeight)
  const currentBottom = currentTop + visibleHeight

  if (itemTop < currentTop) return itemTop
  if (itemBottom > currentBottom) return Math.max(0, itemBottom - visibleHeight)
  return currentTop
}

export function syncComposerMenuScroll(
  container: HTMLElement | null,
  item: HTMLElement | null
): void {
  if (!container || !item) return
  const nextScrollTop = calculateComposerMenuScrollTop({
    containerScrollTop: container.scrollTop,
    containerClientHeight: container.clientHeight,
    itemOffsetTop: item.offsetTop,
    itemOffsetHeight: item.offsetHeight
  })
  if (nextScrollTop !== container.scrollTop) container.scrollTop = nextScrollTop
}
