import { makeLocalBridge } from 'yaob'

import { makeContext, makeFakeWorld } from './core/core'
import { makeNodeIo } from './io/node/node-io'
import {
  EdgeContext,
  EdgeContextOptions,
  EdgeFakeUser,
  EdgeFakeWorld
} from './types/types'

export { makeNodeIo }
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
  const { path = './edge' } = opts
  return makeContext(makeNodeIo(path), {}, opts)
}

export function makeFakeEdgeWorld(
  users: EdgeFakeUser[] = []
): Promise<EdgeFakeWorld> {
  return Promise.resolve(
    makeLocalBridge(makeFakeWorld(makeNodeIo('.'), {}, users), {
      cloneMessage: message => JSON.parse(JSON.stringify(message))
    })
  )
}
