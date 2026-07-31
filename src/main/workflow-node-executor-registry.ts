import type { WorkflowNodeV1 } from '../shared/app-settings'

export type WorkflowNodeKind = WorkflowNodeV1['type']
export type WorkflowNodeExecutorContext<TOutcome> = {
  executeCore: (node: WorkflowNodeV1) => Promise<TOutcome>
  executeAi: (node: WorkflowNodeV1) => Promise<TOutcome>
  executeImage: (node: WorkflowNodeV1) => Promise<TOutcome>
  executeCode: (node: WorkflowNodeV1) => Promise<TOutcome>
  executeNested: (node: WorkflowNodeV1) => Promise<TOutcome>
  executeHttp: (node: WorkflowNodeV1) => Promise<TOutcome>
  executeApproval: (node: WorkflowNodeV1) => Promise<TOutcome>
  executeCustom: (node: WorkflowNodeV1) => Promise<TOutcome>
}
export type WorkflowNodeExecutor<TOutcome> = (
  node: WorkflowNodeV1,
  context: WorkflowNodeExecutorContext<TOutcome>
) => Promise<TOutcome>

export class WorkflowNodeExecutorRegistry<TOutcome> {
  private readonly executors = new Map<WorkflowNodeKind, WorkflowNodeExecutor<TOutcome>>()

  registerFamily(
    kinds: readonly WorkflowNodeKind[],
    executor: WorkflowNodeExecutor<TOutcome>
  ): this {
    for (const kind of kinds) {
      if (this.executors.has(kind)) throw new Error(`Workflow node executor already registered: ${kind}`)
      this.executors.set(kind, executor)
    }
    return this
  }

  execute(
    node: WorkflowNodeV1,
    context: WorkflowNodeExecutorContext<TOutcome>
  ): Promise<TOutcome> {
    const executor = this.executors.get(node.type)
    if (!executor) throw new Error(`Workflow node executor is not registered: ${node.type}`)
    return executor(node, context)
  }

  registeredKinds(): WorkflowNodeKind[] {
    return [...this.executors.keys()]
  }
}

const CORE_KINDS = [
  'manual-trigger', 'schedule-trigger', 'webhook-trigger', 'condition', 'switch', 'filter',
  'merge', 'set-fields', 'sort', 'limit', 'aggregate', 'template', 'json', 'output', 'delay'
] as const
const AI_KINDS = ['ai-agent', 'parameter-extractor', 'question-classifier'] as const
const IMAGE_KINDS = ['generate-image'] as const
const CODE_KINDS = ['code'] as const
const NESTED_KINDS = ['subworkflow', 'loop'] as const
const HTTP_KINDS = ['http-request'] as const
const APPROVAL_KINDS = ['human-approval'] as const
const CUSTOM_KINDS = ['custom'] as const

type ExecutorKey = keyof WorkflowNodeExecutorContext<unknown>

function familyExecutor<TOutcome>(key: ExecutorKey): WorkflowNodeExecutor<TOutcome> {
  return (node, context) => context[key](node)
}

/** Registers every persisted node kind with exactly one concrete family owner. */
export function createWorkflowNodeExecutorRegistry<TOutcome>(): WorkflowNodeExecutorRegistry<TOutcome> {
  const registry = new WorkflowNodeExecutorRegistry<TOutcome>()
  return registry
    .registerFamily(CORE_KINDS, familyExecutor('executeCore'))
    .registerFamily(AI_KINDS, familyExecutor('executeAi'))
    .registerFamily(IMAGE_KINDS, familyExecutor('executeImage'))
    .registerFamily(CODE_KINDS, familyExecutor('executeCode'))
    .registerFamily(NESTED_KINDS, familyExecutor('executeNested'))
    .registerFamily(HTTP_KINDS, familyExecutor('executeHttp'))
    .registerFamily(APPROVAL_KINDS, familyExecutor('executeApproval'))
    .registerFamily(CUSTOM_KINDS, familyExecutor('executeCustom'))
}
