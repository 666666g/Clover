export type ViewState = {
  count: number
}

export function increment(state: ViewState): ViewState {
  return { count: state.count + 1 }
}
