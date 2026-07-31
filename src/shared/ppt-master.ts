/**
 * Result returned after the desktop app has made the PPT Master skill usable
 * by the local Kun runtime.
 */
export type PptMasterEnsureResult =
  | {
      ok: true
      /** Absolute path to the installed skill package. */
      skillPath: string
      /** Absolute path to the Python interpreter in the skill's venv. */
      pythonPath: string
      /** True when this request downloaded the package or created its venv. */
      installed: boolean
    }
  | {
      ok: false
      message: string
    }
