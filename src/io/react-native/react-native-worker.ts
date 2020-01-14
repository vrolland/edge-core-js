import './polyfills'

import hashjs from 'hash.js'
import HmacDRBG from 'hmac-drbg'
import { base64 } from 'rfc4648'
import { Bridge, bridgifyObject } from 'yaob'

import {
  addEdgeCorePlugins,
  lockEdgeCorePlugins,
  makeContext,
  makeFakeWorld
} from '../../core/core'
import {
  EdgeFetchOptions,
  EdgeFetchResponse,
  EdgeIo,
  EdgeNativeIo
} from '../../types/types'
import { makeFetchResponse } from '../../util/http/http-to-fetch'
import { ClientIo, WorkerApi } from './react-native-types'

// @ts-ignore `window` doesn't exist in React Native
const global: any = typeof window !== 'undefined' ? window : {}

const body = global.document.body
if (body != null && /debug=true/.test(global.location.search)) {
  const update = () => {
    const wave = Math.abs(((Date.now() / 2000) % 2) - 1)
    const color = 0x40 + 0x80 * wave
    body.style.backgroundColor = `rgb(${color}, ${color}, ${color})`

    setTimeout(update, 100)
  }
  update()
}

global.addEdgeCorePlugins = addEdgeCorePlugins
global.lockEdgeCorePlugins = lockEdgeCorePlugins

function makeIo(nativeIo: EdgeNativeIo): EdgeIo {
  const clientIo: ClientIo = nativeIo['edge-core']
  const { console, disklet, entropy, scrypt } = clientIo
  const csprng = new HmacDRBG({
    hash: hashjs.sha256,
    entropy: base64.parse(entropy)
  })

  return {
    console,
    disklet,

    random: bytes => csprng.generate(bytes),
    scrypt,

    // Networking:
    fetch(uri: string, opts?: EdgeFetchOptions): Promise<EdgeFetchResponse> {
      return global.fetch(uri, opts)
    },

    fetchCors(
      uri: string,
      opts: EdgeFetchOptions = {}
    ): Promise<EdgeFetchResponse> {
      return clientIo.fetchCors(uri, opts).then(makeFetchResponse)
    },

    WebSocket: global.WebSocket
  }
}

const workerApi: WorkerApi = bridgifyObject({
  makeEdgeContext(nativeIo, opts) {
    return makeContext(makeIo(nativeIo), nativeIo, opts)
  },

  makeFakeEdgeWorld(nativeIo, users = []) {
    return Promise.resolve(makeFakeWorld(makeIo(nativeIo), nativeIo, users))
  }
})

/**
 * Legacy WebView support.
 */
function oldSendRoot() {
  if (global.originalPostMessage != null) {
    const reactPostMessage = global.postMessage
    global.postMessage = global.originalPostMessage
    global.bridge = new Bridge({
      sendMessage: message => reactPostMessage(JSON.stringify(message))
    })
    global.bridge.sendRoot(workerApi)
  } else {
    setTimeout(oldSendRoot, 100)
  }
}

// Start the object bridge:
if (global.ReactNativeWebView != null) {
  global.bridge = new Bridge({
    sendMessage(message) {
      global.ReactNativeWebView.postMessage(JSON.stringify(message))
    }
  })
  global.bridge.sendRoot(workerApi)
} else {
  oldSendRoot()
}
