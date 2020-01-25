import { isPixieShutdownError } from 'redux-pixies'
import { emit } from 'yaob'

import {
  EdgeCurrencyEngineCallbacks,
  EdgeTransaction
} from '../../../types/types'
import { compare } from '../../../util/compare'
import { enableTestMode, pushUpdate } from '../../../util/updateQueue'
import {
  getStorageWalletLastChanges,
  hashStorageWalletFilename
} from '../../storage/storage-selectors'
import { combineTxWithFile } from './currency-wallet-api'
import { loadAllFiles, setupNewTxMetadata } from './currency-wallet-files'
import {
  CurrencyWalletInput,
  CurrencyWalletProps
} from './currency-wallet-pixie'
import { mergeTx } from './currency-wallet-reducer'

let throttleRateLimitMs = 5000

/**
 * Wraps a transaction-accepting callback with throttling logic.
 * Returns a function that can be called at high frequency, and batches its
 * inputs to only call the real callback every 5 seconds.
 */
function makeThrottledTxCallback(
  input: CurrencyWalletInput,
  callback: (txArray: EdgeTransaction[]) => unknown
) {
  const walletId = input.props.id
  const { log } = input.props

  let delayCallback = false
  let lastCallbackTime = 0
  let pendingTxs: EdgeTransaction[] = []

  return (txArray: EdgeTransaction[]) => {
    if (delayCallback) {
      log(`throttledTxCallback delay, walletId: ${walletId}`)
      pendingTxs.push(...txArray)
    } else {
      const now = Date.now()
      if (now - lastCallbackTime > throttleRateLimitMs) {
        lastCallbackTime = now
        callback(txArray)
      } else {
        log(`throttledTxCallback delay, walletId: ${walletId}`)
        delayCallback = true
        pendingTxs = txArray
        setTimeout(() => {
          lastCallbackTime = Date.now()
          callback(pendingTxs)
          delayCallback = false
          pendingTxs = []
        }, throttleRateLimitMs)
      }
    }
  }
}

/**
 * Returns a callback structure suitable for passing to a currency engine.
 */
export function makeCurrencyWalletCallbacks(
  input: CurrencyWalletInput
): EdgeCurrencyEngineCallbacks {
  const walletId = input.props.id

  // If this is a unit test, lower throttling to something testable:
  if (walletId === 'narfavJN4rp9ZzYigcRj1i0vrU2OAGGp4+KksAksj54=') {
    throttleRateLimitMs = 25
    enableTestMode()
  }

  const throtteldOnTxChanged = makeThrottledTxCallback(
    input,
    (txArray: EdgeTransaction[]) => {
      if (
        input.props.selfOutput != null &&
        input.props.selfOutput.api != null
      ) {
        emit(input.props.selfOutput.api, 'transactionsChanged', txArray)
      }
    }
  )

  const throttledOnNewTx = makeThrottledTxCallback(
    input,
    (txArray: EdgeTransaction[]) => {
      if (
        input.props.selfOutput != null &&
        input.props.selfOutput.api != null
      ) {
        emit(input.props.selfOutput.api, 'newTransactions', txArray)
      }
    }
  )

  return {
    onAddressesChecked(ratio: number) {
      pushUpdate({
        id: walletId,
        action: 'onAddressesChecked',
        updateFunc: () => {
          input.props.dispatch({
            type: 'CURRENCY_ENGINE_CHANGED_SYNC_RATIO',
            payload: { ratio, walletId }
          })
        }
      })
    },

    onBalanceChanged(currencyCode: string, balance: string) {
      pushUpdate({
        id: walletId + '==' + currencyCode,
        action: 'onBalanceChanged',
        updateFunc: () => {
          input.props.dispatch({
            type: 'CURRENCY_ENGINE_CHANGED_BALANCE',
            payload: { balance, currencyCode, walletId }
          })
        }
      })
    },

    onBlockHeightChanged(height: number) {
      pushUpdate({
        id: walletId,
        action: 'onBlockHeightChanged',
        updateFunc: () => {
          input.props.dispatch({
            type: 'CURRENCY_ENGINE_CHANGED_HEIGHT',
            payload: { height, walletId }
          })
        }
      })
    },

    onTransactionsChanged(txs: EdgeTransaction[]) {
      // Sanity-check incoming transactions:
      if (!txs) return
      for (const tx of txs) {
        if (
          typeof tx.txid !== 'string' ||
          typeof tx.date !== 'number' ||
          typeof tx.networkFee !== 'string' ||
          typeof tx.blockHeight !== 'number' ||
          typeof tx.nativeAmount !== 'string' ||
          typeof tx.ourReceiveAddresses !== 'object'
        ) {
          input.props.onError(
            new Error('Plugin sent bogus tx: ' + JSON.stringify(tx, null, 2))
          )
          return
        }
      }
      const { state } = input.props
      const existingTxs = input.props.selfState.txs
      const txidHashes = {}
      const files = input.props.selfState.files || {}
      const fileNames = input.props.selfState.fileNames || []
      const defaultCurrency = input.props.selfState.currencyInfo.currencyCode
      const changed = []
      const created = []
      for (const rawTx of txs) {
        const tx = mergeTx(rawTx, defaultCurrency, existingTxs[rawTx.txid])
        const txid = tx.txid
        // If we already have it in the list, make sure something about it has changed:
        if (compare(tx, existingTxs[txid])) continue

        const txidHash = hashStorageWalletFilename(state, walletId, txid)
        const isNew = !fileNames[txidHash]
        const decryptedMetadata = files[txidHash]
        const combinedTx = combineTxWithFile(
          input,
          tx,
          decryptedMetadata,
          rawTx.currencyCode
        )
        if (isNew) {
          setupNewTxMetadata(input, tx).catch(e => input.props.onError(e))
          created.push(combinedTx)
        } else if (decryptedMetadata) {
          changed.push(combinedTx)
        }
        txidHashes[txidHash] = combinedTx.date
      }
      // Side Effect
      input.props.dispatch({
        type: 'CURRENCY_ENGINE_CHANGED_TXS',
        payload: { txs, walletId, txidHashes }
      })

      // Call the callbacks:
      if (changed.length) throtteldOnTxChanged(changed)
      if (created.length) throttledOnNewTx(created)
    },

    onTxidsChanged() {}
  }
}

/**
 * Monitors a currency wallet for changes and fires appropriate callbacks.
 */
export function watchCurrencyWallet(input: CurrencyWalletInput) {
  const walletId = input.props.id

  let lastChanges
  function checkChangesLoop(props: CurrencyWalletProps) {
    // Check for data changes:
    const changes = getStorageWalletLastChanges(props.state, walletId)
    if (changes !== lastChanges) {
      lastChanges = changes
      loadAllFiles(input).catch(e => input.props.onError(e))
    }

    input
      .nextProps()
      .then(checkChangesLoop)
      .catch(e => {
        if (!isPixieShutdownError(e)) input.props.onError(e)
      })
  }
  checkChangesLoop(input.props)
}
