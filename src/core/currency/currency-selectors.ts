import {
  EdgeCurrencyInfo,
  EdgeCurrencyWallet,
  EdgeMetaToken
} from '../../types/types'
import { ApiInput, RootProps } from '../root-pixie'

export function getCurrencyMultiplier(
  currencyInfos: EdgeCurrencyInfo[],
  metaTokens: EdgeMetaToken[],
  currencyCode: string
): string {
  for (const info of currencyInfos) {
    for (const denomination of info.denominations) {
      if (denomination.name === currencyCode) {
        return denomination.multiplier
      }
    }
  }

  for (const info of currencyInfos) {
    for (const token of info.metaTokens) {
      for (const denomination of token.denominations) {
        if (denomination.name === currencyCode) {
          return denomination.multiplier
        }
      }
    }
  }

  for (const token of metaTokens) {
    for (const denomination of token.denominations) {
      if (denomination.name === currencyCode) {
        return denomination.multiplier
      }
    }
  }

  return '1'
}

export function waitForCurrencyWallet(
  ai: ApiInput,
  walletId: string
): Promise<EdgeCurrencyWallet> {
  const out: any = ai.waitFor((props: RootProps):
    | EdgeCurrencyWallet
    | undefined => {
    // If the wallet id doesn't even exist, bail out:
    if (!props.state.currency.wallets[walletId]) {
      throw new Error(`Wallet id ${walletId} does not exist in this account`)
    }

    // Return the error if one exists:
    if (props.state.currency.wallets[walletId].engineFailure) {
      throw props.state.currency.wallets[walletId].engineFailure
    }

    // Return the API if that exists:
    if (props.output.currency.wallets[walletId]) {
      return props.output.currency.wallets[walletId].api
    }
  })
  return out
}
