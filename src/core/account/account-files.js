// @flow

import { type DiskletFile, type DiskletFolder, mapFiles } from 'disklet'
import { base16, base64 } from 'rfc4648'

import {
  type EdgePluginMap,
  type EdgeWalletInfo,
  type EdgeWalletStates,
  type JsonObject
} from '../../types/types.js'
import { makeKeyInfo } from '../login/keys.js'
import { type ApiInput } from '../root-pixie.js'
import {
  getStorageWalletFolder,
  hashStorageWalletFilename
} from '../storage/storage-selectors.js'
import { type SwapSettings } from './account-reducer.js'

const PLUGIN_SETTINGS_FILE = 'PluginSettings.json'

type PluginSettingsFile = {
  userSettings?: EdgePluginMap<JsonObject>,
  swapSettings?: EdgePluginMap<SwapSettings>
}

/**
 * Returns true if `Object.assign(a, b)` would alter `a`.
 */
function different(a: any, b: any): boolean {
  for (const key of Object.keys(b)) {
    if (a[key] !== b[key]) {
      return true
    }
  }
  return false
}

/**
 * Returns `value` if it is an object,
 * otherwise returns an empty fallback object.
 */
function getObject(value: any): any {
  if (value == null && typeof value !== 'object') return {}
  return value
}

function getJson(file: DiskletFile, fallback: any = {}): Promise<any> {
  return file
    .getText()
    .then(text => JSON.parse(text))
    .catch(e => fallback)
}

function getJsonFiles(folder: DiskletFolder): Promise<any[]> {
  return mapFiles(folder, (file, name) =>
    file
      .getText()
      .then(text => ({ file, name, json: JSON.parse(text) }))
      .catch(e => undefined)
  ).then(files => files.filter(file => file != null))
}

/**
 * Loads the legacy wallet list from the account folder.
 */
function loadWalletList(
  folder: DiskletFolder
): Promise<{
  walletInfos: EdgeWalletInfo[],
  walletStates: EdgeWalletStates
}> {
  return getJsonFiles(folder.folder('Wallets')).then(files => {
    const walletInfos = []
    const walletStates = {}

    files.forEach(file => {
      const { SortIndex, Archived, BitcoinSeed, MK, SyncKey } = file.json

      const dataKey = base16.parse(MK)
      const bitcoinKey = base16.parse(BitcoinSeed)
      const syncKey = base16.parse(SyncKey)
      const keys = {
        bitcoinKey: base64.stringify(bitcoinKey),
        dataKey: base64.stringify(dataKey),
        format: 'bip32',
        syncKey: base64.stringify(syncKey)
      }

      const keyInfo = makeKeyInfo('wallet:bitcoin', keys, dataKey)
      walletInfos.push(keyInfo)
      walletStates[keyInfo.id] = {
        sortIndex: SortIndex,
        archived: Archived,
        deleted: false,
        hidden: false
      }
    })

    return { walletInfos, walletStates }
  })
}

/**
 * Loads the modern key state list from the account folder.
 */
function loadWalletStates(folder: DiskletFolder): Promise<EdgeWalletStates> {
  return getJsonFiles(folder.folder('Keys')).then(files => {
    const keyStates = {}

    files.forEach(file => {
      const { id, archived, deleted, hidden, sortIndex } = file.json
      keyStates[id] = { archived, deleted, hidden, sortIndex }
    })

    return keyStates
  })
}

/**
 * Loads the keyStates and legacy wallet list,
 * diffs them with the current keyStates and legacy wallet list,
 * and returns true if there are any changes.
 */
export async function loadAllWalletStates(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const selfState = ai.props.state.accounts[accountId]
  const { accountWalletInfo, accountWalletInfos } = selfState

  // Read files from all repos:
  const [newStates, legacyLists] = await Promise.all([
    loadWalletStates(
      getStorageWalletFolder(ai.props.state, accountWalletInfo.id)
    ),
    Promise.all(
      accountWalletInfos.map(info =>
        loadWalletList(getStorageWalletFolder(ai.props.state, info.id))
      )
    )
  ])

  // Merge all that information together:
  const legacyWalletInfos: EdgeWalletInfo[] = [].concat(
    ...legacyLists.map(files => files.walletInfos)
  )
  const legacyWalletStates: EdgeWalletStates[] = legacyLists.map(
    files => files.walletStates
  )
  const walletStates = Object.assign({}, ...legacyWalletStates, newStates)

  ai.props.dispatch({
    type: 'ACCOUNT_KEYS_LOADED',
    payload: {
      accountId,
      legacyWalletInfos,
      walletStates
    }
  })
}

/**
 * Changes the wallet states within an account.
 */
export async function changeWalletStates(
  ai: ApiInput,
  accountId: string,
  newStates: EdgeWalletStates
) {
  const { accountWalletInfo, walletStates } = ai.props.state.accounts[accountId]

  // Find the changes between the new states and the old states:
  const toWrite = {}
  for (const id of Object.keys(newStates)) {
    if (walletStates[id] == null) {
      // We don't have this id, so everything is new:
      toWrite[id] = newStates[id]
    } else if (different(walletStates[id], newStates[id])) {
      // We already have this id, so only update if it has changed:
      toWrite[id] = { ...walletStates[id], ...newStates[id] }
    }
  }

  // If there are no changes, do nothing:
  const walletIds = Object.keys(toWrite)
  if (!walletIds.length) return

  const keyFolder = getStorageWalletFolder(
    ai.props.state,
    accountWalletInfo.id
  ).folder('Keys')
  await Promise.all(
    walletIds.map(walletId => {
      const { archived, deleted, hidden, sortIndex } = toWrite[walletId]
      const walletIdHash = hashStorageWalletFilename(
        ai.props.state,
        accountWalletInfo.id,
        walletId
      )
      return keyFolder
        .file(`${walletIdHash}.json`)
        .setText(
          JSON.stringify({ archived, deleted, hidden, sortIndex, id: walletId })
        )
    })
  )

  ai.props.dispatch({
    type: 'ACCOUNT_CHANGED_WALLET_STATES',
    payload: { accountId, walletStates: { ...walletStates, ...toWrite } }
  })
}

/**
 * Changes a currency plugin's settings within an account.
 */
export async function changePluginUserSettings(
  ai: ApiInput,
  accountId: string,
  pluginName: string,
  userSettings: JsonObject
) {
  const { accountWalletInfo } = ai.props.state.accounts[accountId]
  const file = getStorageWalletFolder(
    ai.props.state,
    accountWalletInfo.id
  ).file(PLUGIN_SETTINGS_FILE)

  // Write the new state to disk:
  const json: PluginSettingsFile = await getJson(file)
  json.userSettings = { ...ai.props.state.accounts[accountId].userSettings }
  json.userSettings[pluginName] = userSettings
  await file.setText(JSON.stringify(json))

  // Update Redux:
  ai.props.dispatch({
    type: 'ACCOUNT_PLUGIN_SETTINGS_CHANGED',
    payload: {
      accountId,
      pluginName,
      userSettings: { ...userSettings }
    }
  })
}

/**
 * Enables or disables swap plugins.
 */
export async function changeSwapSettings(
  ai: ApiInput,
  accountId: string,
  pluginName: string,
  swapSettings: SwapSettings
) {
  const { accountWalletInfo } = ai.props.state.accounts[accountId]
  const file = getStorageWalletFolder(
    ai.props.state,
    accountWalletInfo.id
  ).file(PLUGIN_SETTINGS_FILE)

  // Write the new state to disk:
  const json: PluginSettingsFile = await getJson(file)
  json.swapSettings = { ...ai.props.state.accounts[accountId].swapSettings }
  json.swapSettings[pluginName] = swapSettings
  await file.setText(JSON.stringify(json))

  // Update Redux:
  ai.props.dispatch({
    type: 'ACCOUNT_SWAP_SETTINGS_CHANGED',
    payload: { accountId, pluginName, swapSettings }
  })
}

/**
 * Loads the settings for all the currency plugins within an account.
 */
export async function reloadPluginSettings(ai: ApiInput, accountId: string) {
  const { accountWalletInfo } = ai.props.state.accounts[accountId]
  const file = getStorageWalletFolder(
    ai.props.state,
    accountWalletInfo.id
  ).file(PLUGIN_SETTINGS_FILE)

  const json: PluginSettingsFile = await getJson(file)

  const userSettings = getObject(json.userSettings)
  const swapSettings = getObject(json.swapSettings)

  // Add the final list to Redux:
  ai.props.dispatch({
    type: 'ACCOUNT_PLUGIN_SETTINGS_LOADED',
    payload: { accountId, userSettings, swapSettings }
  })
}
