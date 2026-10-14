/** Clipboard success starts the timer; late responses and disposed views cannot announce. */
export class CopyFeedback {
  private request = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(private success: (id: number) => void, private failure: (error: unknown) => void, private schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = (callback, delay) => setTimeout(callback, delay), private cancel: (timer: ReturnType<typeof setTimeout>) => void = timer => clearTimeout(timer)) {}
  dispose() { this.request++; if (this.timer) this.cancel(this.timer) }
  async copy(text: string, write: (text: string) => Promise<void>) {
    const request = ++this.request
    if (this.timer) this.cancel(this.timer)
    this.success(0)
    try {
      await write(text)
      if (request !== this.request) return
      this.success(request)
      this.timer = this.schedule(() => this.success(0), 2000)
    } catch (error) {
      if (request === this.request) { this.success(0); this.failure(error) }
    }
  }
}
