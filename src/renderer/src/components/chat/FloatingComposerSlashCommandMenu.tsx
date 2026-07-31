import { useEffect, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { SlashCommand, SlashCommandId } from './floating-composer-commands'
import { syncComposerMenuScroll } from './composer-menu-scroll'

type Props = {
  commands: SlashCommand[]
  highlighted: SlashCommand | null
  selectedIndex: number
  onSelect: (commandId: SlashCommandId) => void
}

/** Focused and scroll-synchronized view for the slash-command catalog. */
export function FloatingComposerSlashCommandMenu({
  commands,
  highlighted,
  selectedIndex,
  onSelect
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const menuRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const highlightedId = highlighted?.id ?? null

  useEffect(() => {
    if (!highlightedId) return
    syncComposerMenuScroll(menuRef.current, itemRefs.current.get(highlightedId) ?? null)
  }, [commands.length, highlightedId, selectedIndex])

  return (
    <div className="ds-card-strong absolute bottom-full left-1/2 z-30 mb-2 w-[calc(100%_-_1rem)] max-w-[760px] -translate-x-1/2 overflow-hidden rounded-[16px] p-1.5 shadow-[0_18px_46px_rgba(20,47,95,0.14)]">
      <div className="flex h-7 items-center px-2.5 text-[11.5px] font-semibold text-ds-muted">
        {t('slashCommandMenuTitle')}
      </div>
      {commands.length > 0 ? (
        <div
          ref={menuRef}
          className="flex max-h-[min(300px,calc(100vh-260px))] flex-col gap-0.5 overflow-y-auto pr-1"
        >
          {commands.map((command) => {
            const active = highlightedId === command.id
            return (
              <button
                key={command.id}
                ref={(node) => {
                  if (node) itemRefs.current.set(command.id, node)
                  else itemRefs.current.delete(command.id)
                }}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(command.id)}
                disabled={command.disabled}
                className={`flex min-h-[52px] w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                  active && !command.disabled
                    ? 'bg-ds-hover text-ds-ink shadow-[inset_0_0_0_1px_rgba(20,47,95,0.06)]'
                    : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:hover:bg-transparent disabled:hover:text-ds-muted'
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] ${
                    active && !command.disabled
                      ? 'bg-white text-accent shadow-sm dark:bg-ds-card'
                      : 'bg-ds-hover text-ds-muted'
                  }`}
                >
                  {command.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold leading-5 text-inherit">
                    {command.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] leading-4 text-ds-faint">
                    {command.description}
                  </span>
                </span>
                <span className="hidden min-w-[106px] shrink-0 flex-col items-end gap-1 sm:flex">
                  {command.scopeLabel ? (
                    <span className="text-[10.5px] font-semibold leading-none text-ds-muted">
                      {command.scopeLabel}
                    </span>
                  ) : null}
                  <span className="max-w-[150px] truncate rounded-full border border-ds-border-muted px-2 py-0.5 text-[10.5px] font-semibold leading-4 text-ds-faint">
                    {command.badge ?? `/${command.id}`}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="rounded-[12px] border border-dashed border-ds-border-muted px-3 py-3 text-[12px] text-ds-faint">
          {t('slashCommandEmpty')}
        </div>
      )}
    </div>
  )
}
