import type { ChatBlock, UserInputAnswer, UserInputOption, UserInputQuestion } from '../../agent/types'

type UserInputBlock = Extract<ChatBlock, { kind: 'user_input' }>

/**
 * A `user_input` request is actionable only while the live runtime is awaiting
 * it (`block.live`). A block rehydrated from a finished thread keeps its stored
 * `pending` status but is NOT live, so reopening that history must not re-prompt
 * the user (issue #606) — answering it would hit a dead gate ("user input not
 * found").
 */
export function isLivePendingUserInput(block: UserInputBlock): boolean {
  return block.status === 'pending' && block.live === true
}

/** The live, awaited `user_input` block in a thread, if any (latest wins). */
export function selectLivePendingUserInput(blocks: ChatBlock[]): UserInputBlock | null {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]
    if (block.kind === 'user_input' && isLivePendingUserInput(block)) return block
  }
  return null
}

/**
 * Shared, framework-free helpers for the user_input / ask-user interaction.
 *
 * The runtime models each question as having one answer object. Single-choice
 * answers keep using `{ id, label, value }`; multi-select answers add
 * `labels` / `values` while preserving the joined `label` / `value` string for
 * older consumers. Free-form questions (no options) and the "type your own"
 * escape hatch both resolve to a synthetic label below.
 *
 * Both the composer-docked panel and the (read-only) timeline bubble import
 * these so the answer shape never drifts between the two surfaces.
 */
export const USER_INPUT_OTHER_LABEL = 'Other'
export const USER_INPUT_FREEFORM_LABEL = 'Answer'
const USER_INPUT_MULTI_VALUE_SEPARATOR = ', '

export function answersByQuestionId(
  answers: UserInputAnswer[] | undefined
): Record<string, UserInputAnswer> {
  const out: Record<string, UserInputAnswer> = {}
  for (const answer of answers ?? []) {
    out[answer.id] = answer
  }
  return out
}

export function answerFromOption(
  question: UserInputQuestion,
  option: UserInputOption
): UserInputAnswer {
  return { id: question.id, label: option.label, value: option.label }
}

export function isMultipleChoiceQuestion(question: UserInputQuestion): boolean {
  return question.selectionMode === 'multiple' && question.options.length > 0
}

export function questionMaxSelections(question: UserInputQuestion): number | undefined {
  if (!isMultipleChoiceQuestion(question)) return undefined
  const raw = question.maxSelections
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const normalized = Math.floor(raw)
  return normalized > 0 ? Math.min(normalized, question.options.length) : undefined
}

export function questionMinSelections(question: UserInputQuestion): number {
  if (!isMultipleChoiceQuestion(question)) return 1
  const raw = question.minSelections
  const normalized = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 1
  const max = questionMaxSelections(question) ?? question.options.length
  return Math.min(Math.max(1, normalized), max)
}

export function answerDisplayValues(answer: UserInputAnswer | undefined): string[] {
  if (!answer) return []
  if (answer.values && answer.values.length > 0) return answer.values.filter((value) => value.trim())
  if (answer.labels && answer.labels.length > 0) return answer.labels.filter((label) => label.trim())
  if (answer.value.trim()) return [answer.value.trim()]
  if (answer.label !== USER_INPUT_OTHER_LABEL && answer.label.trim()) return [answer.label.trim()]
  return []
}

export function selectedOptionValues(answer: UserInputAnswer | undefined): string[] {
  if (!answer || answer.label === USER_INPUT_OTHER_LABEL) return []
  if (answer.values && answer.values.length > 0) return answer.values
  if (answer.labels && answer.labels.length > 0) return answer.labels
  return answer.value.trim() ? [answer.value.trim()] : []
}

export function answerFromOptions(
  question: UserInputQuestion,
  options: UserInputOption[]
): UserInputAnswer {
  const labels = options.map((option) => option.label)
  const value = labels.join(USER_INPUT_MULTI_VALUE_SEPARATOR)
  return {
    id: question.id,
    label: value,
    value,
    labels,
    values: labels
  }
}

export function toggleOptionAnswer(
  question: UserInputQuestion,
  answer: UserInputAnswer | undefined,
  option: UserInputOption
): UserInputAnswer | null {
  const selected = new Set(selectedOptionValues(answer))
  if (selected.has(option.label)) {
    selected.delete(option.label)
  } else {
    selected.add(option.label)
  }
  const ordered = question.options.filter((candidate) => selected.has(candidate.label))
  return ordered.length > 0 ? answerFromOptions(question, ordered) : null
}

/**
 * Map free-typed composer text onto the current question. An exact (case- and
 * whitespace-insensitive) match against an option collapses to that option;
 * otherwise it becomes a custom "Other" answer (options present) or a plain
 * free-form "Answer" (no options).
 */
export function answerFromTypedText(
  question: UserInputQuestion,
  text: string
): UserInputAnswer {
  const trimmed = text.trim()
  const matched = question.options.find(
    (option) => option.label.trim().toLowerCase() === trimmed.toLowerCase()
  )
  if (matched) {
    if (isMultipleChoiceQuestion(question)) return answerFromOptions(question, [matched])
    return { id: question.id, label: matched.label, value: matched.label }
  }
  const label = question.options.length > 0 ? USER_INPUT_OTHER_LABEL : USER_INPUT_FREEFORM_LABEL
  return { id: question.id, label, value: trimmed }
}

export function isQuestionAnswered(
  question: UserInputQuestion,
  answer: UserInputAnswer | undefined
): boolean {
  if (!answer) return false
  if (question.options.length === 0 || answer.label === USER_INPUT_OTHER_LABEL) {
    return answer.value.trim().length > 0
  }
  if (isMultipleChoiceQuestion(question)) {
    const selectedCount = selectedOptionValues(answer).length
    const max = questionMaxSelections(question)
    return selectedCount >= questionMinSelections(question) && (max === undefined || selectedCount <= max)
  }
  return true
}

export function allAnswered(
  questions: UserInputQuestion[],
  map: Record<string, UserInputAnswer>
): boolean {
  return questions.every((question) => isQuestionAnswered(question, map[question.id]))
}

export function orderedAnswers(
  questions: UserInputQuestion[],
  map: Record<string, UserInputAnswer>
): UserInputAnswer[] {
  const out: UserInputAnswer[] = []
  for (const question of questions) {
    const answer = map[question.id]
    if (answer) out.push(answer)
  }
  return out
}

/**
 * The next question that still needs an answer, scanning forward (wrapping)
 * from `from`. Returns `from` when everything is answered, so callers should
 * check {@link allAnswered} first to decide submit-vs-advance.
 */
export function nextUnansweredIndex(
  questions: UserInputQuestion[],
  map: Record<string, UserInputAnswer>,
  from: number
): number {
  const total = questions.length
  for (let offset = 1; offset <= total; offset += 1) {
    const idx = (from + offset) % total
    if (!isQuestionAnswered(questions[idx], map[questions[idx].id])) {
      return idx
    }
  }
  return from
}

/** Options carrying descriptions render as full-width rows; bare ones as chips. */
export function optionsNeedRows(options: UserInputOption[]): boolean {
  return options.some((option) => option.description?.trim().length > 0)
}

/**
 * The runtime sometimes sends a placeholder header of "input" for a lone
 * question; that adds no information, so it is suppressed.
 */
export function shouldShowQuestionHeader(
  question: UserInputQuestion,
  totalQuestions: number
): boolean {
  const header = question.header?.trim()
  if (!header) return false
  if (totalQuestions === 1 && header.toLowerCase() === 'input') return false
  return true
}
