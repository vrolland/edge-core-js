// How often to run jobs from the queue
let QUEUE_RUN_DELAY = 500

// How many jobs to run from the queue on each cycle
let QUEUE_JOBS_PER_RUN = 3

interface UpdateQueue {
  id: string
  action: string
  updateFunc: Function
}

const updateQueue: UpdateQueue[] = []
let timeOut

export function enableTestMode(): void {
  QUEUE_JOBS_PER_RUN = 99
  QUEUE_RUN_DELAY = 1
}

export function pushUpdate(update: UpdateQueue): void {
  if (!updateQueue.length) {
    startQueue()
  }
  let didUpdate = false
  for (const u of updateQueue) {
    if (u.id === update.id && u.action === update.action) {
      u.updateFunc = update.updateFunc
      didUpdate = true
      break
    }
  }
  if (!didUpdate) {
    updateQueue.push(update)
  }
}

export function removeIdFromQueue(id: string): void {
  for (let i = 0; i < updateQueue.length; i++) {
    const update = updateQueue[i]
    if (id === update.id) {
      updateQueue.splice(i, 1)
      break
    }
  }
  if (!updateQueue.length) {
    clearTimeout(timeOut)
  }
}

function startQueue(): void {
  timeOut = setTimeout(() => {
    const numJobs =
      QUEUE_JOBS_PER_RUN < updateQueue.length
        ? QUEUE_JOBS_PER_RUN
        : updateQueue.length
    for (let i = 0; i < numJobs; i++) {
      if (updateQueue.length) {
        const u = updateQueue.shift()
        u.updateFunc()
      }
    }
    if (updateQueue.length) {
      startQueue()
    }
  }, QUEUE_RUN_DELAY)
}
