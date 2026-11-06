/** Only the explicit import action may persist a staged import. */
export async function performCvEditorSave(
  action: 'section' | 'form' | 'import',
  reviewingImport: boolean,
  callbacks: { keepSection: () => void; persist: () => Promise<void> },
): Promise<void> {
  if (reviewingImport) {
    if (action === 'section') callbacks.keepSection()
    if (action === 'import') await callbacks.persist()
    return
  }
  if (action !== 'import') await callbacks.persist()
}
