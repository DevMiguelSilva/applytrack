export type TaskPhase = 'running' | 'saving' | 'completed' | 'failed'
export interface BackgroundTask<T> {
  jobId: string
  label: string
  phase: TaskPhase
  error?: string
  output?: T
  fingerprint: string
}

/** In-memory work only. Each run belongs to one account epoch and one input snapshot. */
export class BackgroundTasks<T> {
  tasks: Record<string, BackgroundTask<T>> = {}
  private epoch = 0
  private versions = new Map<string, number>()
  constructor(private notify: () => void) {}
  reset() { this.epoch++; this.tasks = {}; this.notify() }
  dismiss(id: string) {
    if (this.tasks[id]?.phase === 'running' || this.tasks[id]?.phase === 'saving') return
    delete this.tasks[id]; this.notify()
  }
  invalidate(id: string) {
    const task = this.tasks[id]
    if (!task || (task.phase !== 'running' && task.phase !== 'saving' && !task.output)) return
    this.versions.set(id, (this.versions.get(id) ?? 0) + 1)
    this.publish({ ...task, output: undefined, phase: 'failed', error: 'This job or its CV changed. Restart tailoring to use the latest information.' })
  }
  private publish(task: BackgroundTask<T>) { this.tasks = { ...this.tasks, [task.jobId]: task }; this.notify() }
  async start(jobId: string, label: string, fingerprint: string, generate: () => Promise<T>, validate: () => boolean, save: (output: T, valid: () => boolean) => Promise<void>) {
    const previous = this.tasks[jobId]
    if (previous?.phase === 'running' || previous?.phase === 'saving') return
    const epoch = this.epoch
    const version = (this.versions.get(jobId) ?? 0) + 1
    this.versions.set(jobId, version)
    const task: BackgroundTask<T> = { jobId, label, fingerprint, phase: 'running' }
    this.publish(task)
    try {
      const output = await generate()
      if (epoch !== this.epoch || this.versions.get(jobId) !== version) return
      task.output = output
      await this.persist(task, epoch, version, validate, save)
    } catch (error) {
      if (epoch !== this.epoch || this.versions.get(jobId) !== version) return
      this.publish({ ...task, phase: 'failed', error: error instanceof Error ? error.message : 'Tailoring failed. Please retry.' })
    }
  }
  async retry(jobId: string, validate: () => boolean, save: (output: T, valid: () => boolean) => Promise<void>) {
    const task = this.tasks[jobId]
    if (task?.phase !== 'failed' || !task.output) return
    await this.persist(task, this.epoch, this.versions.get(jobId)!, validate, save)
  }
  private async persist(task: BackgroundTask<T>, epoch: number, version: number, validate: () => boolean, save: (output: T, valid: () => boolean) => Promise<void>) {
    if (!validate()) {
      this.publish({ ...task, output: undefined, phase: 'failed', error: 'This job or its CV changed. Restart tailoring to use the latest information.' })
      return
    }
    this.publish({ ...task, phase: 'saving', error: undefined })
    try {
      await save(task.output!, () => epoch === this.epoch && this.versions.get(task.jobId) === version && validate())
      if (epoch !== this.epoch || this.versions.get(task.jobId) !== version) return
      if (!validate()) {
        this.publish({ ...task, output: undefined, phase: 'failed', error: 'This job or its CV changed. Restart tailoring to use the latest information.' })
        return
      }
      this.publish({ ...task, phase: 'completed', output: undefined, error: undefined })
    } catch (error) {
      if (epoch !== this.epoch || this.versions.get(task.jobId) !== version) return
      this.publish({ ...task, phase: 'failed', error: error instanceof Error ? error.message : 'Could not save. Retry saving your generated files.' })
    }
  }
}
