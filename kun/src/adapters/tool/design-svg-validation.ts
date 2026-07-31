import type { Attr, Document, Element, Node } from '@xmldom/xmldom'

export const SVG_NS = 'http://www.w3.org/2000/svg'
export const MAX_SVG_SOURCE_BYTES = 1_000_000
export const MAX_SVG_ELEMENTS = 5_000

export const ALLOWED_SVG_TAGS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'metadata',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath', 'lineargradient', 'radialgradient', 'stop',
  'pattern', 'clippath', 'mask', 'marker', 'symbol', 'use', 'image',
  'filter', 'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite',
  'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap', 'fedistantlight',
  'fedropshadow', 'feflood', 'fefunca', 'fefuncb', 'fefuncg', 'fefuncr',
  'fegaussianblur', 'feimage', 'femerge', 'femergenode', 'femorphology',
  'feoffset', 'fepointlight', 'fespecularlighting', 'fespotlight', 'fetile',
  'feturbulence', 'animate', 'animatetransform', 'animatemotion', 'mpath', 'set', 'style'
])

export const SAFE_SVG_ANIMATION_ATTRIBUTES = new Set([
  'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
  'width', 'height', 'opacity', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity',
  'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'transform', 'd',
  'points', 'pathlength', 'offset', 'stop-color', 'stop-opacity'
])
const VISUAL_SVG_TAGS = new Set([
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'use', 'image'
])
const NON_VISUAL_SVG_CONTAINERS = new Set([
  'defs', 'symbol', 'clippath', 'mask', 'marker', 'pattern', 'filter'
])

export type SvgDiagnostic = {
  severity: 'error' | 'warning'
  code: string
  message: string
  elementId?: string
}

export function svgNodes(list: { length: number; item(index: number): Node | null }): Node[] {
  const result: Node[] = []
  for (let index = 0; index < list.length; index += 1) {
    const item = list.item(index)
    if (item) result.push(item)
  }
  return result
}

export function svgElements(root: Element): Element[] {
  return [root, ...svgNodes(root.getElementsByTagName('*')).filter((node): node is Element => node.nodeType === 1)]
}

export function svgElementName(element: Element): string {
  return (element.localName || element.tagName).toLowerCase()
}

export function svgRoot(document: Document): Element {
  const root = document.documentElement
  if (!root) throw new Error('SVG document has no root element')
  return root
}

export function safeSvgId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return /^[A-Za-z_][\w:.-]*$/.test(id) ? id : null
}

export function unsafeSvgCss(value: string): boolean {
  if (/@import|javascript\s*:|(?:https?|file|ftp)\s*:|expression\s*\(|behavior\s*:|-moz-binding/i.test(value)) return true
  const urls = value.match(/url\(([^)]+)\)/gi) ?? []
  return urls.some((entry) => {
    const target = entry.slice(entry.indexOf('(') + 1, -1).trim().replace(/^['"]|['"]$/g, '')
    return !/^#[A-Za-z_][\w:.-]*$/.test(target) && !/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(target)
  })
}

export function safeSvgAttribute(name: string, value: string): boolean {
  const normalized = name.toLowerCase()
  if (!/^[A-Za-z_:][\w:.-]*$/.test(name) || normalized.startsWith('on')) return false
  if (/javascript\s*:/i.test(value)) return false
  if (normalized === 'href' || normalized === 'xlink:href' || normalized === 'src') {
    return /^#[A-Za-z_][\w:.-]*$/.test(value.trim()) ||
      /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value.trim())
  }
  return !((normalized === 'style' || /url\(/i.test(value)) && unsafeSvgCss(value))
}

export function assertSvgSourceSize(source: string): void {
  if (Buffer.byteLength(source, 'utf8') > MAX_SVG_SOURCE_BYTES) {
    throw new Error(`SVG exceeds ${MAX_SVG_SOURCE_BYTES} bytes`)
  }
}

function validViewBox(value: string): boolean {
  const numbers = value.trim().split(/[\s,]+/).map(Number)
  return numbers.length === 4 && numbers.every(Number.isFinite) && numbers[2] > 0 && numbers[3] > 0
}

function nonPositiveOpacity(value: string | null | undefined): boolean {
  const text = value?.trim()
  if (!text) return false
  const percentage = /^([-+]?(?:\d+(?:\.\d+)?|\.\d+))%$/.exec(text)
  const numeric = percentage ? Number(percentage[1]) / 100 : Number(text)
  return Number.isFinite(numeric) && numeric <= 0
}

function hiddenPresentation(element: Element): boolean {
  if (element.getAttribute('display')?.trim().toLowerCase() === 'none') return true
  const visibility = element.getAttribute('visibility')?.trim().toLowerCase()
  if (visibility === 'hidden' || visibility === 'collapse') return true
  if (nonPositiveOpacity(element.getAttribute('opacity'))) return true
  const declarations = (element.getAttribute('style') ?? '').split(';')
  for (const declaration of declarations) {
    const colon = declaration.indexOf(':')
    if (colon < 0) continue
    const property = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).trim().replace(/\s*!important\s*$/i, '')
    if (property === 'display' && value.toLowerCase() === 'none') return true
    if (property === 'visibility' && ['hidden', 'collapse'].includes(value.toLowerCase())) return true
    if (property === 'opacity' && nonPositiveOpacity(value)) return true
  }
  return false
}

const PATH_ARGUMENT_COUNTS: Record<string, number> = {
  a: 7, c: 6, h: 1, l: 2, m: 2, q: 4, s: 4, t: 2, v: 1, z: 0
}

export function validSvgPathData(value: string): boolean {
  const source = value.trim()
  if (!source || source.length > 50_000) return false
  const tokens = source.match(/[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)
  if (!tokens || !/^[Mm]$/.test(tokens[0] ?? '')) return false
  const residue = source
    .replace(/[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g, '')
    .replace(/[\s,]+/g, '')
  if (residue) return false

  let index = 0
  let command = ''
  while (index < tokens.length) {
    const token = tokens[index]
    if (/^[A-Za-z]$/.test(token)) {
      command = token
      index += 1
    } else if (!command) return false
    const count = PATH_ARGUMENT_COUNTS[command.toLowerCase()]
    if (count === undefined) return false
    if (count === 0) {
      command = ''
      continue
    }
    let argumentCount = 0
    while (index < tokens.length && !/^[A-Za-z]$/.test(tokens[index])) {
      if (!Number.isFinite(Number(tokens[index]))) return false
      argumentCount += 1
      index += 1
    }
    if (argumentCount === 0 || argumentCount % count !== 0) return false
    if (command.toLowerCase() === 'm') command = command === 'm' ? 'l' : 'L'
  }
  return true
}

function validClockValue(
  value: string,
  options: { allowIndefinite?: boolean; allowZero?: boolean } = {}
): boolean {
  const text = value.trim()
  if (options.allowIndefinite && text === 'indefinite') return true
  const minimum = options.allowZero ? 0 : Number.MIN_VALUE
  if (/^(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s|min|h)$/i.test(text)) return Number.parseFloat(text) >= minimum
  const fullClock = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(text)
  if (fullClock) {
    const hours = Number(fullClock[1])
    const minutes = Number(fullClock[2])
    const seconds = Number(fullClock[3])
    return minutes < 60 && seconds < 60 && hours * 3600 + minutes * 60 + seconds >= minimum
  }
  const partialClock = /^(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(text)
  return Boolean(partialClock && Number(partialClock[2]) < 60 && Number(partialClock[1]) * 60 + Number(partialClock[2]) >= minimum)
}

const COMMON_SMIL_EVENTS = new Set([
  'activate', 'click', 'focusin', 'focusout', 'mousedown', 'mousemove',
  'mouseout', 'mouseover', 'mouseup'
])
const COMMON_SMIL_EVENT_PATTERN = [...COMMON_SMIL_EVENTS].join('|')

function validSignedClockOffset(value: string | undefined): boolean {
  if (value === undefined) return true
  const text = value.trim()
  if (!text) return false
  const unsigned = text.startsWith('+') || text.startsWith('-') ? text.slice(1) : text
  return validClockValue(unsigned, { allowZero: true })
}

function validSmilBegin(value: string): boolean {
  const entries = value.split(';').map((entry) => entry.trim())
  if (entries.length === 0 || entries.some((entry) => !entry)) return false
  return entries.every((entry) => {
    if (entry === 'indefinite' || validSignedClockOffset(entry)) return true
    const syncbase = /^([A-Za-z_][\w:.-]*)\.(begin|end)([+-].+)?$/.exec(entry)
    if (syncbase) return validSignedClockOffset(syncbase[3])
    const repeat = /^([A-Za-z_][\w:.-]*)\.repeat\((\d+)\)([+-].+)?$/.exec(entry)
    if (repeat) return Number(repeat[2]) >= 0 && validSignedClockOffset(repeat[3])
    // Keep the event token separate from a negative offset. A generic
    // `[\w-]+` event match greedily consumes `click-1s`, incorrectly rejecting
    // a valid event value. The explicit common-event alternation also avoids
    // accepting arbitrary event-like strings.
    const event = new RegExp(
      `^(?:[A-Za-z_][\\w:.-]*\\.)?(${COMMON_SMIL_EVENT_PATTERN})([+-].+)?$`,
      'i'
    ).exec(entry)
    return Boolean(event && validSignedClockOffset(event[2]))
  })
}

function semicolonValues(value: string): string[] {
  return value.split(';').map((entry) => entry.trim()).filter(Boolean)
}

function validKeyTimes(value: string, expected: number | null): boolean {
  const values = semicolonValues(value).map(Number)
  return values.length >= 2 &&
    (expected === null || values.length === expected) &&
    values[0] === 0 && values[values.length - 1] === 1 &&
    values.every((entry, index) =>
      Number.isFinite(entry) && entry >= 0 && entry <= 1 && (index === 0 || entry >= values[index - 1]))
}

function validKeySplines(value: string, segmentCount: number | null): boolean {
  const splines = value.split(';').map((entry) => entry.trim()).filter(Boolean)
  if (splines.length === 0 || (segmentCount !== null && splines.length !== segmentCount)) return false
  return splines.every((entry) => {
    const numbers = entry.split(/[\s,]+/).map(Number)
    return numbers.length === 4 && numbers.every((number) => Number.isFinite(number) && number >= 0 && number <= 1)
  })
}

function validTransformValue(value: string, type: string): boolean {
  const numbers = value.trim().split(/[\s,]+/).map(Number)
  if (numbers.some((number) => !Number.isFinite(number))) return false
  if (type === 'translate' || type === 'scale') return numbers.length === 1 || numbers.length === 2
  if (type === 'rotate') return numbers.length === 1 || numbers.length === 3
  return (type === 'skewx' || type === 'skewy') && numbers.length === 1
}

function validateAnimationElement(element: Element, diagnostics: SvgDiagnostic[], id?: string): void {
  const tag = svgElementName(element)
  const withId = id ? { elementId: id } : {}
  const add = (code: string, message: string) => diagnostics.push({ severity: 'error', code, message, ...withId })
  const attributeName = element.getAttribute('attributeName')?.trim().toLowerCase() ?? ''
  if ((tag === 'animate' || tag === 'animatetransform' || tag === 'set') && !attributeName) {
    add('missing-animation-attribute', `<${element.tagName}> requires attributeName.`)
  } else if (attributeName && !SAFE_SVG_ANIMATION_ATTRIBUTES.has(attributeName)) {
    add('unsafe-animation-property', `Animation property ${attributeName} is not allowed.`)
  }

  if (tag !== 'set') {
    const duration = element.getAttribute('dur')?.trim() ?? ''
    if (!duration) add('missing-animation-duration', `<${element.tagName}> requires dur.`)
    else if (!validClockValue(duration, { allowIndefinite: true })) add('invalid-animation-duration', `Invalid animation duration "${duration}".`)
  }
  const begin = element.getAttribute('begin')?.trim()
  if (begin && !validSmilBegin(begin)) add('invalid-animation-begin', `Invalid animation begin "${begin}".`)
  const repeatCount = element.getAttribute('repeatCount')?.trim()
  if (repeatCount && repeatCount !== 'indefinite' && !(Number.isFinite(Number(repeatCount)) && Number(repeatCount) > 0)) {
    add('invalid-animation-repeat', 'repeatCount must be a positive number or indefinite.')
  }
  const repeatDuration = element.getAttribute('repeatDur')?.trim()
  if (repeatDuration && !validClockValue(repeatDuration, { allowIndefinite: true })) add('invalid-animation-repeat-duration', `Invalid repeatDur "${repeatDuration}".`)
  const fill = element.getAttribute('fill')?.trim()
  if (fill && fill !== 'freeze' && fill !== 'remove') add('invalid-animation-fill', 'Animation fill must be freeze or remove.')
  const calcMode = element.getAttribute('calcMode')?.trim().toLowerCase()
  if (calcMode && !['discrete', 'linear', 'paced', 'spline'].includes(calcMode)) add('invalid-animation-calc-mode', `Unsupported calcMode "${calcMode}".`)

  const values = element.getAttribute('values')
  const valueEntries = values === null ? [] : semicolonValues(values)
  if (values !== null && valueEntries.length < 2) add('invalid-animation-values', 'Animation values must contain at least two entries.')
  const keyTimes = element.getAttribute('keyTimes')
  if (keyTimes !== null && !validKeyTimes(keyTimes, valueEntries.length >= 2 ? valueEntries.length : null)) add('invalid-animation-key-times', 'keyTimes must be ascending from 0 to 1 and match values.')
  const keySplines = element.getAttribute('keySplines')
  if (keySplines !== null && !validKeySplines(keySplines, valueEntries.length >= 2 ? valueEntries.length - 1 : null)) add('invalid-animation-key-splines', 'keySplines must contain one cubic-bezier tuple per animation segment.')
  if (keySplines !== null && calcMode !== 'spline') add('animation-spline-mode-required', 'keySplines requires calcMode="spline".')

  if (tag === 'set') {
    if (!element.hasAttribute('to')) add('missing-set-value', '<set> requires a to value.')
    return
  }
  if (tag === 'animatemotion') {
    const path = element.getAttribute('path')?.trim()
    const hasMotionValues = valueEntries.length >= 2 || element.hasAttribute('to') || element.hasAttribute('by')
    const hasMpath = svgNodes(element.getElementsByTagName('mpath')).some((node) => node.nodeType === 1)
    if (!path && !hasMpath && !hasMotionValues) add('missing-motion-path', '<animateMotion> requires path, mpath, values, to, or by.')
    else if (path && !validSvgPathData(path)) add('invalid-motion-path', 'animateMotion path is not valid SVG path data.')
    const rotate = element.getAttribute('rotate')?.trim()
    if (rotate && rotate !== 'auto' && rotate !== 'auto-reverse' && !Number.isFinite(Number(rotate))) add('invalid-motion-rotate', 'animateMotion rotate must be auto, auto-reverse, or a number.')
    return
  }

  if (valueEntries.length === 0 && !element.hasAttribute('to') && !element.hasAttribute('by')) add('missing-animation-values', `<${element.tagName}> requires values, to, or by.`)
  if (tag === 'animatetransform') {
    const type = element.getAttribute('type')?.trim().toLowerCase() ?? ''
    if (!['translate', 'scale', 'rotate', 'skewx', 'skewy'].includes(type)) add('invalid-transform-type', 'animateTransform requires a supported type.')
    else {
      const candidates = valueEntries.length > 0
        ? valueEntries
        : [element.getAttribute('from'), element.getAttribute('to'), element.getAttribute('by')].filter((value): value is string => value !== null)
      if (candidates.some((value) => !validTransformValue(value, type))) add('invalid-transform-value', `animateTransform values do not match ${type} syntax.`)
    }
  }
  if (tag === 'animate' && attributeName === 'd') {
    const candidates = valueEntries.length > 0
      ? valueEntries
      : [element.getAttribute('from'), element.getAttribute('to'), element.getAttribute('by')].filter((value): value is string => value !== null)
    if (candidates.some((value) => !validSvgPathData(value))) add('invalid-path-animation-value', 'Animated d values must be valid SVG path data.')
  }
}

export function validateSvgDocument(document: Document, parseErrors: readonly string[] = []): SvgDiagnostic[] {
  const diagnostics: SvgDiagnostic[] = parseErrors.map((message) => ({ severity: 'error', code: 'xml-parse', message }))
  const root = svgRoot(document)
  const all = svgElements(root)
  if (all.length > MAX_SVG_ELEMENTS) diagnostics.push({ severity: 'error', code: 'too-many-elements', message: `SVG exceeds ${MAX_SVG_ELEMENTS} elements.` })
  const namespace = root.getAttribute('xmlns')
  if (!namespace) diagnostics.push({ severity: 'warning', code: 'missing-namespace', message: `Add xmlns="${SVG_NS}" for a standalone SVG.` })
  else if (namespace !== SVG_NS) diagnostics.push({ severity: 'error', code: 'invalid-namespace', message: `SVG xmlns must be ${SVG_NS}.` })

  const ids = new Set<string>()
  for (const element of all) {
    const tag = svgElementName(element)
    const id = element.getAttribute('id') || undefined
    if (element.namespaceURI && element.namespaceURI !== SVG_NS) diagnostics.push({ severity: 'error', code: 'invalid-element-namespace', message: `<${element.tagName}> is not in the SVG namespace.`, ...(id ? { elementId: id } : {}) })
    else if (namespace === SVG_NS && element.namespaceURI !== SVG_NS) diagnostics.push({ severity: 'error', code: 'missing-element-namespace', message: `<${element.tagName}> lost the SVG namespace.`, ...(id ? { elementId: id } : {}) })
    if (!ALLOWED_SVG_TAGS.has(tag)) diagnostics.push({ severity: 'error', code: 'unsafe-element', message: `<${tag}> is not allowed.`, ...(id ? { elementId: id } : {}) })
    if (id) {
      if (!safeSvgId(id)) diagnostics.push({ severity: 'error', code: 'invalid-id', message: `Invalid id "${id}".`, elementId: id })
      else if (ids.has(id)) diagnostics.push({ severity: 'error', code: 'duplicate-id', message: `Duplicate id "${id}".`, elementId: id })
      else ids.add(id)
    }
    for (const attribute of svgNodes(element.attributes).filter((node): node is Attr => node.nodeType === 2)) {
      if (!safeSvgAttribute(attribute.name, attribute.value)) diagnostics.push({ severity: 'error', code: 'unsafe-attribute', message: `Unsafe ${attribute.name} attribute.`, ...(id ? { elementId: id } : {}) })
    }
    if (tag === 'style' && unsafeSvgCss(element.textContent ?? '')) diagnostics.push({ severity: 'error', code: 'unsafe-style', message: 'Style blocks cannot load external resources or executable CSS.', ...(id ? { elementId: id } : {}) })
    if (tag === 'path') {
      const path = element.getAttribute('d')?.trim() ?? ''
      if (!path) diagnostics.push({ severity: 'error', code: 'missing-path-data', message: '<path> requires d.', ...(id ? { elementId: id } : {}) })
      else if (!validSvgPathData(path)) diagnostics.push({ severity: 'error', code: 'invalid-path-data', message: '<path> d is not valid SVG path data.', ...(id ? { elementId: id } : {}) })
    }
    if ((tag === 'use' || tag === 'image' || tag === 'mpath' || tag === 'feimage') && !element.hasAttribute('href') && !element.hasAttribute('xlink:href')) diagnostics.push({ severity: 'error', code: 'missing-resource-reference', message: `<${element.tagName}> requires href.`, ...(id ? { elementId: id } : {}) })
    if (tag === 'animate' || tag === 'animatetransform' || tag === 'animatemotion' || tag === 'set') validateAnimationElement(element, diagnostics, id)
  }

  const viewBox = root.getAttribute('viewBox')
  if (!viewBox) diagnostics.push({ severity: 'warning', code: 'missing-viewbox', message: 'Add a viewBox for responsive scaling.' })
  else if (!validViewBox(viewBox)) diagnostics.push({ severity: 'error', code: 'invalid-viewbox', message: 'viewBox must contain four finite numbers with positive width and height.' })
  if (root.getElementsByTagName('title').length === 0) diagnostics.push({ severity: 'warning', code: 'missing-title', message: 'Add an accessible <title>.' })
  if (root.getElementsByTagName('desc').length === 0) diagnostics.push({ severity: 'warning', code: 'missing-description', message: 'Add an accessible <desc>.' })
  const visualElementCount = all.filter((element) => {
    if (!VISUAL_SVG_TAGS.has(svgElementName(element))) return false
    let current: Element | null = element
    while (current) {
      if (hiddenPresentation(current)) return false
      if (current !== element && NON_VISUAL_SVG_CONTAINERS.has(svgElementName(current))) return false
      if (current === root) break
      const parentNode: Node | null = current.parentNode
      current = parentNode?.nodeType === 1 ? parentNode as Element : null
    }
    return true
  }).length
  if (visualElementCount === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'missing-visible-content',
      message: 'SVG requires at least one visible graphic element outside definitions.'
    })
  }

  for (const element of all) {
    for (const attribute of svgNodes(element.attributes).filter((node): node is Attr => node.nodeType === 2)) {
      const refs = [...attribute.value.matchAll(/url\(#([A-Za-z_][\w:.-]*)\)/g)].map((match) => match[1])
      if ((attribute.name === 'href' || attribute.name === 'xlink:href') && attribute.value.startsWith('#')) refs.push(attribute.value.slice(1))
      for (const reference of refs) {
        const elementId = element.getAttribute('id') || undefined
        if (!ids.has(reference)) diagnostics.push({ severity: 'error', code: 'missing-reference', message: `Reference #${reference} does not exist.`, ...(elementId ? { elementId } : {}) })
      }
    }
  }
  return diagnostics
}
