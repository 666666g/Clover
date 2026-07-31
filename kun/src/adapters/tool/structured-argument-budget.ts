export type StructuredArgumentLimits = {
  label: string
  maxBytes: number
  maxNodes: number
  maxDepth: number
}

export type StructuredArgumentBudget = {
  bytes: number
  nodes: number
  depth: number
}

export type StructuredArgumentBudgetResult =
  | { ok: true; budget: StructuredArgumentBudget }
  | { ok: false; error: string }

/**
 * Bounds generic JSON-shaped tool arguments without depending on renderer or
 * domain-specific operation fields. Model arguments are already JSON, but the
 * iterative traversal avoids adding a second recursive parser stack here.
 */
export function validateStructuredArgumentBudget(
  value: unknown,
  limits: StructuredArgumentLimits
): StructuredArgumentBudgetResult {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return { ok: false, error: `${limits.label} arguments must be JSON-serializable` }
  }
  const bytes = Buffer.byteLength(serialized ?? '', 'utf8')
  if (bytes > limits.maxBytes) {
    return {
      ok: false,
      error: `${limits.label} arguments exceed ${limits.maxBytes} bytes; split the work into smaller batches`
    }
  }

  let nodes = 0
  let depth = 0
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (!current.value || typeof current.value !== 'object') continue
    nodes += 1
    depth = Math.max(depth, current.depth)
    if (nodes > limits.maxNodes) {
      return {
        ok: false,
        error: `${limits.label} arguments exceed ${limits.maxNodes} structured nodes; split the work into smaller batches`
      }
    }
    if (current.depth > limits.maxDepth) {
      return {
        ok: false,
        error: `${limits.label} arguments exceed nesting depth ${limits.maxDepth}; flatten or split the structure`
      }
    }
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>)
    for (const child of children) stack.push({ value: child, depth: current.depth + 1 })
  }
  return { ok: true, budget: { bytes, nodes, depth } }
}
