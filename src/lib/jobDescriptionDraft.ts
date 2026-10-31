/** Incomplete postings keep their saved snippet out of the manual paste field. */
export function jobDescriptionDraftForEditor(jobDescription: string, jdComplete: boolean): string {
  return jdComplete ? jobDescription : ''
}
