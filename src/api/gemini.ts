import type { MasterCv } from '../types/cv'
import type { JobApplication, ParsedJobPosting, UserProfile } from '../types/job'
import { callGemini } from './client'
import type { SkillJobContext } from '../../shared/skillContext'
import { validJobRequirementAnalysis } from '../../shared/jobRequirements'

// A fresh model run can vary. Reuse verified complete results for identical
// text during this app session, and coalesce simultaneous requests.
const jobParseCache = new Map<string, ParsedJobPosting>()
const pendingJobParses = new Map<string, Promise<ParsedJobPosting>>()
const JOB_PARSE_CACHE_LIMIT = 32

function cloneParsedPosting(posting: ParsedJobPosting): ParsedJobPosting {
  return {
    ...posting,
    skills: [...posting.skills],
    requirements: [...posting.requirements],
    requirementAnalysis: {
      ...posting.requirementAnalysis,
      sections: posting.requirementAnalysis.sections.map(section => ({ ...section })),
      requirements: posting.requirementAnalysis.requirements.map(requirement => ({
        ...requirement,
        components: [...requirement.components],
        constraints: [...requirement.constraints],
      })),
    },
  }
}

export async function parseJobPosting(description: string, options: { force?: boolean } = {}): Promise<ParsedJobPosting> {
  const cached = options.force ? undefined : jobParseCache.get(description)
  if (cached && validJobRequirementAnalysis(cached.requirementAnalysis, description) && cached.requirementAnalysis.status === 'complete') {
    return cloneParsedPosting(cached)
  }
  const pending = pendingJobParses.get(description)
  if (pending) return cloneParsedPosting(await pending)

  const request = callGemini<ParsedJobPosting>({ action: 'parse', description })
  const sharedRequest = request.then((parsed) => {
    if (validJobRequirementAnalysis(parsed.requirementAnalysis, description) && parsed.requirementAnalysis.status === 'complete') {
      jobParseCache.delete(description)
      jobParseCache.set(description, cloneParsedPosting(parsed))
      while (jobParseCache.size > JOB_PARSE_CACHE_LIMIT) {
        const oldest = jobParseCache.keys().next().value
        if (oldest === undefined) break
        jobParseCache.delete(oldest)
      }
    }
    return parsed
  }).finally(() => {
    if (pendingJobParses.get(description) === sharedRequest) pendingJobParses.delete(description)
  })
  pendingJobParses.set(description, sharedRequest)
  return cloneParsedPosting(await sharedRequest)
}

export async function generateCoverLetter(
  job: JobApplication,
  profile: UserProfile
): Promise<string> {
  return callGemini<string>({ action: 'coverLetter', job, profile })
}

export interface TailorCvResult {
  headline?: string
  summary?: string
  skills?: MasterCv['skills']
  experience?: MasterCv['experience']
  projects?: MasterCv['projects']
  coverLetter?: string
  /** Set by the server when a fallback model wrote the draft. */
  tailorModel?: string
}

export async function tailorMasterCv(
  job: JobApplication,
  masterCv: MasterCv,
  profile: UserProfile
): Promise<TailorCvResult> {
  return callGemini<TailorCvResult>({
    action: 'tailorCv',
    job,
    profile,
    masterCv,
    claimedSkills: job.claimedSkills ?? [],
  })
}

/** High-quota models, separate from resume tailoring. */
export async function explainSkill(skill: string, context: SkillJobContext): Promise<string> {
  return callGemini<string>({ action: 'explainSkill', skill, context })
}

export async function parseResumeText(
  resumeText: string,
  track: string,
  templateName?: string
): Promise<Partial<MasterCv>> {
  return callGemini<Partial<MasterCv>>({
    action: 'parseResume',
    resumeText,
    track,
    templateName,
  })
}
