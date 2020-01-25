import { Disklet } from 'disklet'

import {
  EdgeConsole,
  EdgeContext,
  EdgeContextOptions,
  EdgeFakeUser,
  EdgeFakeWorld,
  EdgeFetchOptions,
  EdgeNativeIo,
  EdgeScryptFunction
} from '../../types/types'
import { HttpResponse } from '../../util/http/http-types'

export interface ClientIo {
  readonly console: EdgeConsole
  readonly disklet: Disklet

  readonly entropy: string // base64
  readonly scrypt: EdgeScryptFunction

  // Networking:
  fetchCors(url: string, opts: EdgeFetchOptions): Promise<HttpResponse>
}

export interface WorkerApi {
  makeEdgeContext(
    nativeIo: EdgeNativeIo,
    opts: EdgeContextOptions
  ): Promise<EdgeContext>

  makeFakeEdgeWorld(
    nativeIo: EdgeNativeIo,
    users?: EdgeFakeUser[]
  ): Promise<EdgeFakeWorld>
}
