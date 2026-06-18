let installed = false

export function installCursorSpotlightTracking(): void {
  if (installed || typeof document === 'undefined') return
  installed = true

  let frame = 0
  let targets: HTMLElement[] = []
  let clientX = 0
  let clientY = 0

  document.addEventListener('pointermove', (event) => {
    if (document.documentElement.dataset.cursorSpotlight !== 'on') return
    const nearestTarget = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-cursor-spotlight-target]')
      : null
    targets = cursorSpotlightTargets(nearestTarget)
    if (targets.length === 0) return
    clientX = event.clientX
    clientY = event.clientY
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      for (const target of targets) {
        const rect = target.getBoundingClientRect()
        target.style.setProperty('--spotlight-x', `${clientX - rect.left}px`)
        target.style.setProperty('--spotlight-y', `${clientY - rect.top}px`)
      }
    })
  }, { passive: true })
}

export function cursorSpotlightTargets(start: HTMLElement | null): HTMLElement[] {
  const targets: HTMLElement[] = []
  for (let element = start; element; element = element.parentElement) {
    if (element.hasAttribute('data-cursor-spotlight-target')) targets.push(element)
  }
  return targets
}
