import { useState, type ReactElement } from 'react'
import {
  CUSTOM_MUSIC_GENERATION_PROVIDER_ID,
  CUSTOM_TEXT_TO_SPEECH_PROVIDER_ID,
  CUSTOM_VIDEO_GENERATION_PROVIDER_ID,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  DEFAULT_VIDEO_GENERATION_PROTOCOL,
  MUSIC_GENERATION_PROTOCOLS,
  TEXT_TO_SPEECH_PROTOCOLS,
  VIDEO_GENERATION_PROTOCOLS,
  type VideoGenerationProtocol
} from '@shared/app-settings'
import { ModelSelect, SecretInput, SettingsCard, SettingRow, Toggle } from './settings-controls'
import { ImageGenerationSettingsSection } from './settings-section-image-generation'

const AUDIO_FORMATS = ['mp3', 'wav', 'flac'] as const
const VIDEO_RESOLUTIONS = ['768P', '1080P'] as const

const DEFAULT_TEXT_TO_SPEECH = {
  enabled: false,
  providerId: '',
  protocol: DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  baseUrl: '',
  apiKey: '',
  model: '',
  voice: '',
  format: 'mp3',
  timeoutMs: 120000
}

const DEFAULT_MUSIC_GENERATION = {
  enabled: false,
  providerId: '',
  protocol: DEFAULT_MUSIC_GENERATION_PROTOCOL,
  baseUrl: '',
  apiKey: '',
  model: '',
  format: 'mp3',
  timeoutMs: 300000
}

const DEFAULT_VIDEO_GENERATION = {
  enabled: false,
  providerId: '',
  protocol: DEFAULT_VIDEO_GENERATION_PROTOCOL,
  baseUrl: '',
  apiKey: '',
  model: '',
  defaultDuration: 6,
  defaultResolution: '1080P',
  timeoutMs: 900000,
  pollIntervalMs: 10000
}

type ProviderCapability = {
  protocol: string
  models: string[]
}

type ProviderProfile = {
  id: string
  name: string
  apiKey?: string
  textToSpeech?: ProviderCapability
  music?: ProviderCapability
  video?: ProviderCapability
}

const inputClass =
  'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
const compactInputClass =
  'w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

export function MediaGenerationSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    provider,
    kun,
    selectControlClass,
    updateKun
  } = ctx
  const textToSpeech = {
    ...DEFAULT_TEXT_TO_SPEECH,
    ...(kun.textToSpeech ?? {})
  }
  const musicGeneration = {
    ...DEFAULT_MUSIC_GENERATION,
    ...(kun.musicGeneration ?? {})
  }
  const videoGeneration = {
    ...DEFAULT_VIDEO_GENERATION,
    ...(kun.videoGeneration ?? {})
  }
  const providers = (provider?.providers ?? []) as ProviderProfile[]
  const textToSpeechProviders = providers.filter((item) => Boolean(item.textToSpeech))
  const musicProviders = providers.filter((item) => Boolean(item.music))
  const videoProviders = providers.filter((item) => Boolean(item.video))
  const [showTtsApiKey, setShowTtsApiKey] = useState(false)
  const [showMusicApiKey, setShowMusicApiKey] = useState(false)
  const [showVideoApiKey, setShowVideoApiKey] = useState(false)

  const updateTextToSpeech = (patch: Record<string, unknown>): void => {
    updateKun({
      textToSpeech: {
        ...textToSpeech,
        ...patch
      }
    })
  }
  const updateMusicGeneration = (patch: Record<string, unknown>): void => {
    updateKun({
      musicGeneration: {
        ...musicGeneration,
        ...patch
      }
    })
  }
  const updateVideoGeneration = (patch: Record<string, unknown>): void => {
    updateKun({
      videoGeneration: {
        ...videoGeneration,
        ...patch
      }
    })
  }

  const selectedTts = selectedProviderState({
    settingProviderId: textToSpeech.providerId,
    customProviderId: CUSTOM_TEXT_TO_SPEECH_PROVIDER_ID,
    providers: textToSpeechProviders,
    capabilityKey: 'textToSpeech'
  })
  const selectedMusic = selectedProviderState({
    settingProviderId: musicGeneration.providerId,
    customProviderId: CUSTOM_MUSIC_GENERATION_PROVIDER_ID,
    providers: musicProviders,
    capabilityKey: 'music'
  })
  const selectedVideo = selectedProviderState({
    settingProviderId: videoGeneration.providerId,
    customProviderId: CUSTOM_VIDEO_GENERATION_PROVIDER_ID,
    providers: videoProviders,
    capabilityKey: 'video'
  })

  return (
    <div className="grid gap-6">
      <SettingsCard title={t('mediaGeneration')}>
        <div className="px-5 py-4 text-[13px] leading-6 text-ds-muted">
          {t('mediaGenerationDesc')}
        </div>
      </SettingsCard>

      <ImageGenerationSettingsSection ctx={ctx} />

      <SettingsCard title={t('textToSpeech')}>
        <SettingRow
          title={t('textToSpeechEnabled')}
          description={t('textToSpeechEnabledDesc')}
          control={
            <Toggle
              checked={textToSpeech.enabled}
              onChange={(enabled) => updateTextToSpeech({ enabled })}
            />
          }
        />
        {textToSpeech.enabled ? (
          <>
            {renderProviderRow({
              t,
              selectControlClass,
              title: t('textToSpeechProvider'),
              description: t('textToSpeechProviderDesc'),
              providers: textToSpeechProviders,
              selected: selectedTts,
              capabilityKey: 'textToSpeech',
              customProviderId: CUSTOM_TEXT_TO_SPEECH_PROVIDER_ID,
              customLabel: t('textToSpeechProviderCustom'),
              missingKeyKey: 'textToSpeechProviderMissingKey',
              setting: textToSpeech,
              defaultProtocol: DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
              update: updateTextToSpeech
            })}
            {selectedTts.usingCustom ? (
              <>
                <SettingRow
                  title={t('textToSpeechProtocol')}
                  description={t('textToSpeechProtocolDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={textToSpeech.protocol}
                      onChange={(e) => updateTextToSpeech({ protocol: e.target.value })}
                    >
                      {TEXT_TO_SPEECH_PROTOCOLS.map((protocol) => (
                        <option key={protocol} value={protocol}>{textToSpeechProtocolLabel(t, protocol)}</option>
                      ))}
                    </select>
                  }
                />
                {renderBaseUrlRow(t, 'textToSpeech', textToSpeech.baseUrl, updateTextToSpeech)}
                {renderApiKeyRow({
                  t,
                  prefix: 'textToSpeech',
                  value: textToSpeech.apiKey,
                  visible: showTtsApiKey,
                  setVisible: setShowTtsApiKey,
                  update: updateTextToSpeech
                })}
              </>
            ) : null}
            {renderModelRow({
              t,
              selectControlClass,
              prefix: 'textToSpeech',
              usingCustom: selectedTts.usingCustom,
              model: textToSpeech.model,
              options: selectedTts.capability?.models ?? [],
              update: updateTextToSpeech
            })}
            <SettingRow
              title={t('textToSpeechVoice')}
              description={t('textToSpeechVoiceDesc')}
              control={
                <input
                  className={inputClass}
                  value={textToSpeech.voice}
                  placeholder={t('textToSpeechVoicePlaceholder')}
                  onChange={(e) => updateTextToSpeech({ voice: e.target.value })}
                />
              }
            />
            {renderAudioFormatRow(t, 'textToSpeechFormat', textToSpeech.format, updateTextToSpeech)}
            {renderTimeoutRow(t, 'textToSpeechTimeout', textToSpeech.timeoutMs, 10000, 900000, updateTextToSpeech)}
          </>
        ) : null}
      </SettingsCard>

      <SettingsCard title={t('musicGeneration')}>
        <SettingRow
          title={t('musicGenerationEnabled')}
          description={t('musicGenerationEnabledDesc')}
          control={
            <Toggle
              checked={musicGeneration.enabled}
              onChange={(enabled) => updateMusicGeneration({ enabled })}
            />
          }
        />
        {musicGeneration.enabled ? (
          <>
            {renderProviderRow({
              t,
              selectControlClass,
              title: t('musicGenerationProvider'),
              description: t('musicGenerationProviderDesc'),
              providers: musicProviders,
              selected: selectedMusic,
              capabilityKey: 'music',
              customProviderId: CUSTOM_MUSIC_GENERATION_PROVIDER_ID,
              customLabel: t('musicGenerationProviderCustom'),
              missingKeyKey: 'musicGenerationProviderMissingKey',
              setting: musicGeneration,
              defaultProtocol: DEFAULT_MUSIC_GENERATION_PROTOCOL,
              update: updateMusicGeneration
            })}
            {selectedMusic.usingCustom ? (
              <>
                <SettingRow
                  title={t('musicGenerationProtocol')}
                  description={t('musicGenerationProtocolDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={musicGeneration.protocol}
                      onChange={(e) => updateMusicGeneration({ protocol: e.target.value })}
                    >
                      {MUSIC_GENERATION_PROTOCOLS.map((protocol) => (
                        <option key={protocol} value={protocol}>{t('musicGenerationProtocolMiniMax')}</option>
                      ))}
                    </select>
                  }
                />
                {renderBaseUrlRow(t, 'musicGeneration', musicGeneration.baseUrl, updateMusicGeneration)}
                {renderApiKeyRow({
                  t,
                  prefix: 'musicGeneration',
                  value: musicGeneration.apiKey,
                  visible: showMusicApiKey,
                  setVisible: setShowMusicApiKey,
                  update: updateMusicGeneration
                })}
              </>
            ) : null}
            {renderModelRow({
              t,
              selectControlClass,
              prefix: 'musicGeneration',
              usingCustom: selectedMusic.usingCustom,
              model: musicGeneration.model,
              options: selectedMusic.capability?.models ?? [],
              update: updateMusicGeneration
            })}
            {renderAudioFormatRow(t, 'musicGenerationFormat', musicGeneration.format, updateMusicGeneration)}
            {renderTimeoutRow(t, 'musicGenerationTimeout', musicGeneration.timeoutMs, 10000, 1800000, updateMusicGeneration)}
          </>
        ) : null}
      </SettingsCard>

      <SettingsCard title={t('videoGeneration')}>
        <SettingRow
          title={t('videoGenerationEnabled')}
          description={t('videoGenerationEnabledDesc')}
          control={
            <Toggle
              checked={videoGeneration.enabled}
              onChange={(enabled) => updateVideoGeneration({ enabled })}
            />
          }
        />
        {videoGeneration.enabled ? (
          <>
            {renderProviderRow({
              t,
              selectControlClass,
              title: t('videoGenerationProvider'),
              description: t('videoGenerationProviderDesc'),
              providers: videoProviders,
              selected: selectedVideo,
              capabilityKey: 'video',
              customProviderId: CUSTOM_VIDEO_GENERATION_PROVIDER_ID,
              customLabel: t('videoGenerationProviderCustom'),
              missingKeyKey: 'videoGenerationProviderMissingKey',
              setting: videoGeneration,
              defaultProtocol: DEFAULT_VIDEO_GENERATION_PROTOCOL,
              update: updateVideoGeneration
            })}
            {selectedVideo.usingCustom ? (
              <>
                <SettingRow
                  title={t('videoGenerationProtocol')}
                  description={t('videoGenerationProtocolDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={videoGeneration.protocol}
                      onChange={(e) => updateVideoGeneration({ protocol: e.target.value })}
                    >
                      {VIDEO_GENERATION_PROTOCOLS.map((protocol) => {
                        const labelKey: Record<VideoGenerationProtocol, string> = {
                          'minimax-video': 'videoGenerationProtocolMiniMax',
                          'agnes-video': 'videoGenerationProtocolAgnes'
                        }
                        return (
                          <option key={protocol} value={protocol}>{t(labelKey[protocol])}</option>
                        )
                      })}
                    </select>
                  }
                />
                {renderBaseUrlRow(t, 'videoGeneration', videoGeneration.baseUrl, updateVideoGeneration)}
                {renderApiKeyRow({
                  t,
                  prefix: 'videoGeneration',
                  value: videoGeneration.apiKey,
                  visible: showVideoApiKey,
                  setVisible: setShowVideoApiKey,
                  update: updateVideoGeneration
                })}
              </>
            ) : null}
            {renderModelRow({
              t,
              selectControlClass,
              prefix: 'videoGeneration',
              usingCustom: selectedVideo.usingCustom,
              model: videoGeneration.model,
              options: selectedVideo.capability?.models ?? [],
              update: updateVideoGeneration
            })}
            <SettingRow
              title={t('videoGenerationDefaultDuration')}
              description={t('videoGenerationDefaultDurationDesc')}
              control={
                <input
                  type="number"
                  min={1}
                  max={30}
                  step={1}
                  className={compactInputClass}
                  value={videoGeneration.defaultDuration}
                  onChange={(e) => updateVideoGeneration({ defaultDuration: Number(e.target.value) })}
                />
              }
            />
            <SettingRow
              title={t('videoGenerationDefaultResolution')}
              description={t('videoGenerationDefaultResolutionDesc')}
              control={
                <select
                  className={`${selectControlClass} md:max-w-[160px]`}
                  value={videoGeneration.defaultResolution}
                  onChange={(e) => updateVideoGeneration({ defaultResolution: e.target.value })}
                >
                  {VIDEO_RESOLUTIONS.map((resolution) => (
                    <option key={resolution} value={resolution}>{resolution}</option>
                  ))}
                </select>
              }
            />
            {renderTimeoutRow(t, 'videoGenerationTimeout', videoGeneration.timeoutMs, 30000, 3600000, updateVideoGeneration)}
            <SettingRow
              title={t('videoGenerationPollInterval')}
              description={t('videoGenerationPollIntervalDesc')}
              control={
                <input
                  type="number"
                  min={1000}
                  max={120000}
                  step={1000}
                  className={compactInputClass}
                  value={videoGeneration.pollIntervalMs}
                  onChange={(e) => updateVideoGeneration({ pollIntervalMs: Number(e.target.value) })}
                />
              }
            />
          </>
        ) : null}
      </SettingsCard>
    </div>
  )
}

function selectedProviderState(input: {
  settingProviderId: string
  customProviderId: string
  providers: ProviderProfile[]
  capabilityKey: 'textToSpeech' | 'music' | 'video'
}): {
  providerId: string
  provider?: ProviderProfile
  capability?: ProviderCapability
  usingCustom: boolean
} {
  const providerId = input.settingProviderId || input.customProviderId
  const provider = input.providers.find((item) => item.id === providerId)
  return {
    providerId,
    provider,
    capability: provider?.[input.capabilityKey],
    usingCustom: providerId === input.customProviderId || !provider
  }
}

function renderProviderRow(input: {
  t: (key: string, values?: Record<string, unknown>) => string
  selectControlClass: string
  title: string
  description: string
  providers: ProviderProfile[]
  selected: ReturnType<typeof selectedProviderState>
  capabilityKey: 'textToSpeech' | 'music' | 'video'
  customProviderId: string
  customLabel: string
  missingKeyKey: string
  setting: { baseUrl: string; apiKey: string; protocol: string; model: string }
  defaultProtocol: string
  update: (patch: Record<string, unknown>) => void
}): ReactElement {
  return (
    <SettingRow
      title={input.title}
      description={input.description}
      control={
        <div className="w-full min-w-0 md:max-w-md">
          <select
            className={input.selectControlClass}
            value={input.selected.usingCustom ? input.customProviderId : input.selected.providerId}
            onChange={(e) => {
              const providerId = e.target.value
              const nextProvider = input.providers.find((item) => item.id === providerId)
              const capability = nextProvider?.[input.capabilityKey]
              input.update({
                providerId,
                baseUrl: providerId === input.customProviderId ? input.setting.baseUrl : '',
                apiKey: providerId === input.customProviderId ? input.setting.apiKey : '',
                protocol: providerId === input.customProviderId
                  ? input.setting.protocol
                  : capability?.protocol ?? input.defaultProtocol,
                model: providerId === input.customProviderId
                  ? input.setting.model
                  : capability?.models?.[0] ?? ''
              })
            }}
          >
            {input.providers.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
            <option value={input.customProviderId}>{input.customLabel}</option>
          </select>
          {!input.selected.usingCustom && !input.selected.provider?.apiKey?.trim() ? (
            <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300">
              {input.t(input.missingKeyKey, {
                provider: input.selected.provider?.name ?? input.selected.providerId
              })}
            </p>
          ) : null}
        </div>
      }
    />
  )
}

function renderBaseUrlRow(
  t: (key: string) => string,
  prefix: string,
  value: string,
  update: (patch: Record<string, unknown>) => void
): ReactElement {
  return (
    <SettingRow
      title={t(`${prefix}BaseUrl`)}
      description={t(`${prefix}BaseUrlDesc`)}
      control={
        <input
          className={`${inputClass} md:max-w-md`}
          value={value}
          placeholder={t(`${prefix}BaseUrlPlaceholder`)}
          onChange={(e) => update({ baseUrl: e.target.value })}
        />
      }
    />
  )
}

function renderApiKeyRow(input: {
  t: (key: string) => string
  prefix: string
  value: string
  visible: boolean
  setVisible: (value: boolean | ((prev: boolean) => boolean)) => void
  update: (patch: Record<string, unknown>) => void
}): ReactElement {
  return (
    <SettingRow
      title={input.t(`${input.prefix}ApiKey`)}
      description={input.t(`${input.prefix}ApiKeyDesc`)}
      control={
        <SecretInput
          value={input.value}
          onChange={(value) => input.update({ apiKey: value })}
          visible={input.visible}
          onToggleVisibility={() => input.setVisible((value) => !value)}
          autoComplete="off"
          showLabel={input.t('showSecret')}
          hideLabel={input.t('hideSecret')}
          className="md:max-w-md"
        />
      }
    />
  )
}

function renderModelRow(input: {
  t: (key: string, values?: Record<string, unknown>) => string
  selectControlClass: string
  prefix: string
  usingCustom: boolean
  model: string
  options: string[]
  update: (patch: Record<string, unknown>) => void
}): ReactElement {
  return (
    <SettingRow
      title={input.t(`${input.prefix}Model`)}
      description={input.t(`${input.prefix}ModelDesc`)}
      control={
        <div className="w-full min-w-0 md:max-w-md">
          {input.usingCustom ? (
            <input
              className={inputClass}
              value={input.model}
              placeholder={input.t(`${input.prefix}ModelPlaceholder`)}
              onChange={(e) => input.update({ model: e.target.value })}
            />
          ) : (
            <ModelSelect
              value={input.options.includes(input.model) ? input.model : ''}
              options={input.options}
              defaultLabel={input.t('modelSelectDefaultOption', {
                model: input.options[0] ?? ''
              })}
              selectClassName={input.selectControlClass}
              onChange={(model) => input.update({ model })}
            />
          )}
        </div>
      }
    />
  )
}

function renderAudioFormatRow(
  t: (key: string) => string,
  titleKey: string,
  value: string,
  update: (patch: Record<string, unknown>) => void
): ReactElement {
  return (
    <SettingRow
      title={t(titleKey)}
      description={t(`${titleKey}Desc`)}
      control={
        <select
          className="w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
          value={value}
          onChange={(e) => update({ format: e.target.value })}
        >
          {AUDIO_FORMATS.map((format) => (
            <option key={format} value={format}>{format}</option>
          ))}
        </select>
      }
    />
  )
}

function renderTimeoutRow(
  t: (key: string) => string,
  titleKey: string,
  value: number,
  min: number,
  max: number,
  update: (patch: Record<string, unknown>) => void
): ReactElement {
  return (
    <SettingRow
      title={t(titleKey)}
      description={t(`${titleKey}Desc`)}
      control={
        <input
          type="number"
          min={min}
          max={max}
          step={10000}
          className={compactInputClass}
          value={value}
          onChange={(e) => update({ timeoutMs: Number(e.target.value) })}
        />
      }
    />
  )
}

function textToSpeechProtocolLabel(
  t: (key: string) => string,
  protocol: string
): string {
  if (protocol === 'minimax-t2a') return t('textToSpeechProtocolMiniMax')
  if (protocol === 'mimo-tts') return t('textToSpeechProtocolMimo')
  return t('textToSpeechProtocolOpenAi')
}
