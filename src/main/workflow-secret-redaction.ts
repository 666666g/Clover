import type { AppSettingsV1 } from '../shared/app-settings'

/** Collect every configured workflow secret, including nested workflow values. */
export function collectWorkflowSecretValues(settings: AppSettingsV1): string[] {
  const values: string[] = []
  for (const workflow of settings.workflow.workflows) {
    for (const entry of workflow.env) {
      if (entry.type === 'secret' && entry.value.trim()) values.push(entry.value)
    }
  }
  return values
}

export function redactWorkflowSecrets(secretValues: readonly string[], text: string): string {
  return secretValues.reduce((acc, secret) => acc.split(secret).join('***'), text)
}
