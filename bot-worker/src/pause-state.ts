/** Shared pause flags — set by index from DB status, read by runners */
const pausedJobs = new Set<string>();

export function setJobPaused(jobId: string, paused: boolean) {
  if (paused) pausedJobs.add(jobId);
  else pausedJobs.delete(jobId);
}

export function isJobPaused(jobId: string): boolean {
  return pausedJobs.has(jobId);
}

export function clearJobPaused(jobId: string) {
  pausedJobs.delete(jobId);
}
