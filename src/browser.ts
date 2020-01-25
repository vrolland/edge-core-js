import { makeContext, makeFakeWorld } from './core/core'
import { makeBrowserIo } from './io/browser/browser-io'
import {
  EdgeContext,
  EdgeContextOptions,
  EdgeFakeUser,
  EdgeFakeWorld
} from './types/types'

export { makeBrowserIo }
export {
  addEdgeCorePlugins,
  closeEdge,
  lockEdgeCorePlugins,
  makeFakeIo
} from './core/core'
export * from './types/types'

export function makeEdgeContext(
  opts: EdgeContextOptions
): Promise<EdgeContext> {
  return makeContext(makeBrowserIo(), {}, opts)
}

export function makeFakeEdgeWorld(
  users: EdgeFakeUser[] = []
): Promise<EdgeFakeWorld> {
  return Promise.resolve(makeFakeWorld(makeBrowserIo(), {}, users))
}
