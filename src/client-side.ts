import { shareData } from 'yaob'

import {
  EdgeBalances,
  EdgeCurrencyCodeOptions,
  EdgeCurrencyInfo,
  EdgePasswordRules,
  EdgeWalletInfo,
  EdgeWalletInfoFull
} from './types/types'

/**
 * Client-side EdgeAccount methods.
 */
export class AccountSync {
  readonly allKeys: EdgeWalletInfoFull[]

  getFirstWalletInfo(type: string): EdgeWalletInfo | undefined {
    const allKeys: any = this.allKeys // WalletInfoFull -> WalletInfo
    return allKeys.find(info => info.type === type)
  }

  getWalletInfo(id: string): EdgeWalletInfo | undefined {
    const allKeys: any = this.allKeys // WalletInfoFull -> WalletInfo
    return allKeys.find(info => info.id === id)
  }

  listWalletIds(): string[] {
    return this.allKeys.map(info => info.id)
  }
}
shareData(AccountSync.prototype, 'AccountSync')

/**
 * Verifies that a password meets our suggested rules.
 */
export function checkPasswordRules(password: string): EdgePasswordRules {
  const tooShort = password.length < 10
  const noNumber = !/[0-9]/.test(password)
  const noLowerCase = !/[a-z]/.test(password)
  const noUpperCase = !/[A-Z]/.test(password)

  // Quick & dirty password strength estimation:
  const charset =
    (/[0-9]/.test(password) ? 10 : 0) +
    (/[A-Z]/.test(password) ? 26 : 0) +
    (/[a-z]/.test(password) ? 26 : 0) +
    (/[^0-9A-Za-z]/.test(password) ? 30 : 0)
  const secondsToCrack = Math.pow(charset, password.length) / 1e6

  return {
    secondsToCrack,
    tooShort,
    noNumber,
    noLowerCase,
    noUpperCase,
    passed:
      password.length >= 16 ||
      !(tooShort || noNumber || noUpperCase || noLowerCase)
  }
}
shareData({ checkPasswordRules })

/**
 * Client-side EdgeCurrencyWallet methods.
 */
export class CurrencyWalletSync {
  readonly balances: EdgeBalances
  readonly blockHeight: number
  readonly currencyInfo: EdgeCurrencyInfo
  readonly displayPrivateSeed: string | null
  readonly displayPublicSeed: string | null

  getBalance(opts: EdgeCurrencyCodeOptions = {}): string {
    const { currencyCode = this.currencyInfo.currencyCode } = opts
    return this.balances[currencyCode] || '0'
  }

  getBlockHeight(): number {
    return this.blockHeight
  }

  getDisplayPrivateSeed(): string | null {
    return this.displayPrivateSeed
  }

  getDisplayPublicSeed(): string | null {
    return this.displayPublicSeed
  }
}
shareData(CurrencyWalletSync.prototype, 'CurrencyWalletSync')

/**
 * Normalizes a username, and checks for invalid characters.
 * TODO: Support a wider character range via Unicode normalization.
 */
export function fixUsername(username: string): string {
  const out = username
    .toLowerCase()
    .replace(/[ \f\r\n\t\v]+/g, ' ')
    .replace(/ $/, '')
    .replace(/^ /, '')

  for (let i = 0; i < out.length; ++i) {
    const c = out.charCodeAt(i)
    if (c < 0x20 || c > 0x7e) {
      throw new Error('Bad characters in username')
    }
  }
  return out
}
shareData({ fixUsername })
