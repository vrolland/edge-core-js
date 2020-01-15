import { makeMemoryDisklet } from 'disklet'

import {
  EdgeFetchFunction,
  EdgeIo,
  EdgeRandomFunction
} from '../../types/types'
import { scrypt } from '../../util/crypto/scrypt'

/**
 * Silences all logging.
 */
export const fakeConsole = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

/**
 * Generates deterministic "random" data for unit-testing.
 */
function makeFakeRandom(): EdgeRandomFunction {
  let seed = 0

  return (bytes: number) => {
    const out = new Uint8Array(bytes)

    for (let i = 0; i < bytes; ++i) {
      // Simplest numbers that give a full-period generator with
      // a good mix of high & low values within the first few bytes:
      seed = (5 * seed + 3) & 0xff
      out[i] = seed
    }

    return out
  }
}

const fakeFetch: EdgeFetchFunction = () => {
  return Promise.reject(new Error('Fake network error'))
}

/**
 * TODO: WebSocket mock.
 */
class FakeWebSocket {
  constructor(url: string) {
    this.url = url
  }

  readonly url: string
  close(code?: number, reason?: string): void {}
  send(data: string | ArrayBuffer): void {}

  static CONNECTING: 0
  static OPEN: 1
  static CLOSING: 2
  static CLOSED: 3
}
FakeWebSocket.CONNECTING = 0
FakeWebSocket.OPEN = 1
FakeWebSocket.CLOSING = 2
FakeWebSocket.CLOSED = 3

/**
 * Creates a simulated io context object.
 */
export function makeFakeIo(): EdgeIo {
  const flowHack: any = FakeWebSocket

  const out: EdgeIo = {
    // Crypto:
    random: makeFakeRandom(),
    scrypt,

    // Local io:
    console: fakeConsole,
    disklet: makeMemoryDisklet(),

    // Networking:
    fetch: fakeFetch,
    WebSocket: flowHack
  }
  return out
}
