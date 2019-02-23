// @flow

import hashjs from 'hash.js'
import HmacDRBG from 'hmac-drbg'
import { base64 } from 'rfc4648'
import { Bridge, bridgifyObject } from 'yaob'

import {
  addEdgeCorePlugins,
  closeEdge,
  lockEdgeCorePlugins,
  makeContext,
  makeFakeWorld
} from '../../core/core.js'
import { type EdgeIo, type EdgeNativeIo } from '../../types/types.js'
import { type ClientIo, type WorkerApi } from './react-native-types.js'
import { changeStatus, showStatus } from './status.js'

if (/debug=true/.test(window.location)) showStatus()
window.addEdgeCorePlugins = addEdgeCorePlugins
window.lockEdgeCorePlugins = lockEdgeCorePlugins

function makeIo (nativeIo: EdgeNativeIo): EdgeIo {
  const clientIo: ClientIo = nativeIo['edge-core']
  const { console, disklet, entropy, scrypt } = clientIo
  const csprng = new HmacDRBG({
    hash: hashjs.sha256,
    entropy: base64.parse(entropy)
  })

  return {
    console,
    disklet,

    fetch: (...args) => window.fetch(...args),
    WebSocket: window.WebSocket,

    random: bytes => csprng.generate(bytes),
    scrypt
  }
}

const workerApi: WorkerApi = bridgifyObject({
  closeEdge () {
    closeEdge()
  },

  makeEdgeContext (nativeIo, opts) {
    return makeContext(makeIo(nativeIo), nativeIo, opts)
  },

  makeFakeEdgeWorld (nativeIo, users = []) {
    return Promise.resolve(makeFakeWorld(makeIo(nativeIo), nativeIo, users))
  }
})

// Start the object bridge:
function sendRoot () {
  if (window.originalPostMessage != null) {
    const reactPostMessage = window.postMessage
    window.postMessage = window.originalPostMessage

    window.bridge = new Bridge({
      sendMessage: message => reactPostMessage(JSON.stringify(message))
    })
    window.bridge.sendRoot(workerApi)
    changeStatus('sent root')
  } else {
    setTimeout(sendRoot, 100)
    changeStatus('waiting')
  }
}
sendRoot()