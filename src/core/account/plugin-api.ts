import { Bridgeable, bridgifyObject } from 'yaob'

import {
  EdgeCurrencyConfig,
  EdgeCurrencyInfo,
  EdgeOtherMethods,
  EdgeSwapConfig,
  EdgeSwapInfo,
  JsonObject
} from '../../types/types'
import { getCurrencyTools } from '../plugins/plugins-selectors'
import { ApiInput } from '../root-pixie'
import { changePluginUserSettings, changeSwapSettings } from './account-files'
import { swapPluginEnabled } from './account-selectors'

/**
 * Access to an individual currency plugin's methods.
 */
export class CurrencyConfig extends Bridgeable<EdgeCurrencyConfig> {
  _ai: ApiInput
  _accountId: string
  _pluginName: string

  otherMethods: EdgeOtherMethods

  constructor(ai: ApiInput, accountId: string, pluginName: string) {
    super()
    this._ai = ai
    this._accountId = accountId
    this._pluginName = pluginName

    const { otherMethods } = ai.props.state.plugins.currency[pluginName]
    if (otherMethods != null) {
      bridgifyObject(otherMethods)
      this.otherMethods = otherMethods
    } else {
      this.otherMethods = {}
    }
  }

  get currencyInfo(): EdgeCurrencyInfo {
    return this._ai.props.state.plugins.currency[this._pluginName].currencyInfo
  }

  get userSettings(): JsonObject {
    const selfState = this._ai.props.state.accounts[this._accountId]
    return selfState.userSettings[this._pluginName]
  }

  async changeUserSettings(settings: JsonObject): Promise<void> {
    await changePluginUserSettings(
      this._ai,
      this._accountId,
      this._pluginName,
      settings
    )
  }

  async importKey(userInput: string): Promise<JsonObject> {
    const tools = await getCurrencyTools(this._ai, this.currencyInfo.walletType)

    if (tools.importPrivateKey == null) {
      throw new Error('This wallet does not support importing keys')
    }
    return tools.importPrivateKey(userInput)
  }
}

export class SwapConfig extends Bridgeable<EdgeSwapConfig> {
  _ai: ApiInput
  _accountId: string
  _pluginName: string

  constructor(ai: ApiInput, accountId: string, pluginName: string) {
    super()
    this._ai = ai
    this._accountId = accountId
    this._pluginName = pluginName
  }

  get enabled(): boolean {
    const account = this._ai.props.state.accounts[this._accountId]
    return swapPluginEnabled(account.swapSettings, this._pluginName)
  }

  get needsActivation(): boolean {
    const plugin = this._ai.props.state.plugins.swap[this._pluginName]
    if (plugin.checkSettings == null) return false

    const selfState = this._ai.props.state.accounts[this._accountId]
    const settings = selfState.userSettings[this._pluginName] || {}
    return !!plugin.checkSettings(settings).needsActivation
  }

  get swapInfo(): EdgeSwapInfo {
    return this._ai.props.state.plugins.swap[this._pluginName].swapInfo
  }

  get userSettings(): JsonObject {
    const selfState = this._ai.props.state.accounts[this._accountId]
    return selfState.userSettings[this._pluginName]
  }

  async changeEnabled(enabled: boolean): Promise<void> {
    const account = this._ai.props.state.accounts[this._accountId]
    return changeSwapSettings(this._ai, this._accountId, this._pluginName, {
      ...account.swapSettings[this._pluginName],
      enabled
    })
  }

  async changeUserSettings(settings: JsonObject): Promise<void> {
    await changePluginUserSettings(
      this._ai,
      this._accountId,
      this._pluginName,
      settings
    )
  }
}
