import { base64 } from 'rfc4648'
import { Bridgeable, close, emit } from 'yaob'

import { EdgeEdgeLoginOptions, EdgePendingEdgeLogin } from '../../types/types'
import { base58 } from '../../util/encoding'
import { makeAccount } from '../account/account-init'
import { ApiInput } from '../root-pixie'
import { LobbySubscription, makeLobby } from './lobby'
import { makeLoginTree, searchTree, syncLogin } from './login'
import { saveStash } from './loginStore'

/**
 * The public API for edge login requests.
 */
class PendingEdgeLogin extends Bridgeable<EdgePendingEdgeLogin> {
  id: string
  cancelRequest: () => void

  constructor(ai: ApiInput, lobbyId: string, subscription: LobbySubscription) {
    super()
    this.id = lobbyId
    this.cancelRequest = () => {
      close(this)
      subscription.unsubscribe()
    }

    // If the login starts, close this object:
    const offStart = ai.props.output.context.api.on('loginStart', () => {
      offStart()
      close(this)
    })
    const offError = ai.props.output.context.api.on('loginError', () => {
      offError()
      close(this)
    })
  }
}

/**
 * Turns a reply into a logged-in account.
 */
async function onReply(
  ai: ApiInput,
  subscription: LobbySubscription,
  reply: any,
  appId: string,
  opts: EdgeEdgeLoginOptions
): Promise<void> {
  subscription.unsubscribe()
  const stashTree = reply.loginStash
  const { log } = ai.props

  emit(ai.props.output.context.api, 'loginStart', {
    username: stashTree.username
  })

  // Find the appropriate child:
  const child = searchTree(stashTree, stash => stash.appId === appId)
  if (child == null) {
    throw new Error(`Cannot find requested appId: "${appId}"`)
  }

  // The Airbitz mobile will sometimes send the pin2Key in base58
  // instead of base64 due to an unfortunate bug. Fix that:
  if (child.pin2Key != null && child.pin2Key.slice(-1) !== '=') {
    log.warn('Fixing base58 pin2Key')
    child.pin2Key = base64.stringify(base58.parse(child.pin2Key))
  }
  await saveStash(ai, stashTree)

  // This is almost guaranteed to blow up spectacularly:
  const loginKey = base64.parse(reply.loginKey)
  const loginTree = makeLoginTree(stashTree, loginKey, appId)
  const login = searchTree(loginTree, login => login.appId === appId)
  if (login == null) {
    throw new Error(`Cannot find requested appId: "${appId}"`)
  }
  const newLoginTree = await syncLogin(ai, loginTree, login)
  const account = await makeAccount(ai, appId, newLoginTree, 'edgeLogin', opts)
  emit(ai.props.output.context.api, 'login', account)
}

/**
 * Creates a new account request lobby on the server.
 */
export function requestEdgeLogin(
  ai: ApiInput,
  appId: string,
  opts: EdgeEdgeLoginOptions
): Promise<EdgePendingEdgeLogin> {
  const request = {
    loginRequest: {
      appId,
      displayImageUrl: opts.displayImageUrl,
      displayName: opts.displayName
    }
  }

  return makeLobby(ai, request).then(lobby => {
    function handleError(error: any): void {
      emit(ai.props.output.context.api, 'loginError', { error })
    }
    function handleReply(reply: unknown): void {
      onReply(ai, subscription, reply, appId, opts).catch(handleError)
    }
    const subscription = lobby.subscribe(handleReply, handleError)

    return new PendingEdgeLogin(ai, lobby.lobbyId, subscription)
  })
}
