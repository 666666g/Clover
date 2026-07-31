const LINUX_V8_DEPRECATION_UNDEFINE = '-UV8_DEPRECATION_WARNINGS'

function appendCompilerFlag(value, flag) {
  const current = String(value || '').trim()
  if (current.split(/\s+/).includes(flag)) return current
  return [current, flag].filter(Boolean).join(' ')
}

function configureElectronNativeBuildEnvironment(
  platform = process.platform,
  env = process.env
) {
  if (platform !== 'linux') return env

  // Electron 43 reports v8_deprecation_warnings=1 through process.config even
  // though its external-addon common.gypi defaults the setting to 0.
  // @electron/rebuild propagates that value after its normal compiler defines;
  // GCC then rejects V8's `[[deprecated]]` + visibility attribute ordering.
  // Undefining only this diagnostic macro restores the supported external-addon
  // header path without disabling Electron-ABI rebuilds for native modules.
  env.CXXFLAGS = appendCompilerFlag(env.CXXFLAGS, LINUX_V8_DEPRECATION_UNDEFINE)
  return env
}

module.exports = {
  LINUX_V8_DEPRECATION_UNDEFINE,
  appendCompilerFlag,
  configureElectronNativeBuildEnvironment
}
