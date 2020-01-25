import { makeLocalStorageDisklet } from 'disklet'

import { fakeConsole } from '../../core/fake/fake-io'
import { EdgeFetchOptions, EdgeFetchResponse, EdgeIo } from '../../types/types'
import { scrypt } from '../../util/crypto/scrypt'

/**
 * Extracts the io functions we need from the browser.
 */
export function makeBrowserIo(): EdgeIo {
  if (typeof window === 'undefined') {
    throw new Error('No `window` object')
  }
  if (window.crypto == null || window.crypto.getRandomValues == null) {
    throw new Error('No secure random number generator in this browser')
  }
  if (window.WebSocket == null) {
    throw new Error('No `WebSocket` object')
  }

  return {
    // Crypto:
    random: size => {
      const out = new Uint8Array(size)
      window.crypto.getRandomValues(out)
      return out
    },
    scrypt,

    // Local io:
    console: typeof console !== 'undefined' ? console : fakeConsole,
    disklet: makeLocalStorageDisklet(window.localStorage, {
      prefix: 'airbitz'
    }),

    // Networking:
    fetch(uri: string, opts?: EdgeFetchOptions): Promise<EdgeFetchResponse> {
      return window.fetch(uri, opts)
    },
    WebSocket: window.WebSocket
  }
}
