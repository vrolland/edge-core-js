import { compose, createStore, StoreEnhancer } from 'redux'
import { attachPixie, filterPixie, ReduxProps } from 'redux-pixies'
import { emit } from 'yaob'

import {
  EdgeContext,
  EdgeContextOptions,
  EdgeIo,
  EdgeNativeIo
} from '../types/types'
import { RootAction } from './actions'
import { makeLog } from './log/log'
import { watchPlugins } from './plugins/plugins-actions'
import { RootOutput, rootPixie, RootProps } from './root-pixie'
import { reducer, RootState } from './root-reducer'

let allContexts: EdgeContext[] = []

// @ts-ignore `window` doesn't exist in React Native
const global: any = typeof window !== 'undefined' ? window : {}

const composeEnhancers =
  global.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ != null
    ? global.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({ name: 'core' })
    : compose

/**
 * Creates the root object for the entire core state machine.
 * This core object contains the `io` object, context options,
 * Redux store, and tree of background workers.
 */
export async function makeContext(
  io: EdgeIo,
  nativeIo: EdgeNativeIo,
  opts: EdgeContextOptions
): Promise<EdgeContext> {
  const {
    apiKey,
    appId = '',
    authServer = 'https://auth.airbitz.co/api',
    hideKeys = false,
    plugins: pluginsInit = {}
  } = opts

  if (apiKey == null) {
    throw new Error('No API key provided')
  }

  // Load the login stashes from disk:
  const stashes = {}
  const listing = await io.disklet.list('logins')
  const files = Object.keys(listing).filter(path => listing[path] === 'file')
  for (const path of files) {
    try {
      stashes[path] = JSON.parse(await io.disklet.getText(path))
    } catch (e) {}
  }

  // Start Redux:
  const enhancers: StoreEnhancer<RootState> = composeEnhancers()
  const redux = createStore(reducer, enhancers)
  redux.dispatch({
    type: 'INIT',
    payload: { apiKey, appId, authServer, hideKeys, pluginsInit, stashes }
  })

  // Subscribe to new plugins:
  const closePlugins = watchPlugins(io, nativeIo, pluginsInit, redux.dispatch)

  // Start the pixie tree:
  const log = makeLog(io, 'edge-core')
  const mirror: { output: RootOutput } = { output: {} as any }
  const closePixie = attachPixie(
    redux,
    filterPixie(
      rootPixie,
      (props: ReduxProps<RootState, RootAction>): RootProps => ({
        ...props,
        close() {
          closePixie()
          closePlugins()
          redux.dispatch({ type: 'CLOSE' })
        },
        io,
        log,
        onError: error => {
          if (mirror.output.context && mirror.output.context.api) {
            emit(mirror.output.context.api, 'error', error)
          }
        }
      })
    ),
    e => log.error(e),
    output => (mirror.output = output)
  )

  const out = mirror.output.context.api
  allContexts.push(out)
  return out
}

/**
 * We use this for unit testing, to kill all core contexts.
 */
export function closeEdge() {
  for (const context of allContexts) context.close().catch(e => {})
  allContexts = []
}
