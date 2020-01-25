import { EdgeFakeUser } from '../../types/types'
import { JsonBox } from '../../util/crypto/crypto'
import { filterObject } from '../../util/util'
import { LobbyReply, LobbyRequest } from '../login/lobby'
import { LoginReply } from '../login/login-types'
import { JsonSnrp } from '../scrypt/scrypt-pixie'

export interface DbLobby {
  expires: string // date
  request: LobbyRequest
  replies: LobbyReply[]
}

export interface DbLogin {
  // Identity:
  appId: string
  loginId: string // base64
  parent?: string // loginId
  parentBox?: JsonBox

  // Key login:
  loginAuth?: string // base64
  loginAuthBox?: JsonBox

  // Password login:
  passwordAuth?: string
  passwordAuthBox?: JsonBox
  passwordAuthSnrp?: JsonSnrp
  passwordBox?: JsonBox
  passwordKeySnrp?: JsonSnrp

  // PIN v2:
  pin2Id?: string // base64
  pin2Auth?: string // base64
  pin2Box?: JsonBox
  pin2KeyBox?: JsonBox
  pin2TextBox?: JsonBox

  // Login Recovery v2:
  recovery2Id?: string // base64
  recovery2Auth?: string[]
  recovery2Box?: JsonBox
  recovery2KeyBox?: JsonBox
  question2Box?: JsonBox

  // OTP goodies:
  otpKey?: string
  otpResetDate?: string // date
  otpTimeout?: number

  // Keys and assorted goodies:
  keyBoxes: JsonBox[]
  mnemonicBox?: JsonBox
  rootKeyBox?: JsonBox
  syncKeyBox?: JsonBox
}

type DbLoginDump = DbLogin & { children?: DbLoginDump[] }

export interface DbRepo {
  [path: string]: JsonBox
}

// The database just includes these fields:
export const loginDbColumns = [
  // Identity:
  'appId',
  'loginId',
  // Login methods:
  'loginAuth',
  'loginAuthBox',
  'passwordAuth',
  'passwordAuthBox',
  'passwordAuthSnrp',
  'passwordBox',
  'passwordKeySnrp',
  'pin2Auth',
  'pin2Box',
  'pin2Id',
  'pin2KeyBox',
  'pin2TextBox',
  'recovery2Auth',
  'recovery2Box',
  'recovery2Id',
  'recovery2KeyBox',
  'question2Box',
  'otpKey',
  'otpResetDate',
  'otpTimeout',
  // Resources:
  'keyBoxes',
  'mnemonicBox',
  'parentBox',
  'rootKeyBox',
  'syncKeyBox',
  // Legacy:
  'pinBox',
  'pinId',
  'pinKeyBox'
]

// The v2 account creation endpoint doesn't accept legacy keys:
export const loginCreateColumns: string[] = loginDbColumns.filter(
  item => ['mnemonicBox', 'rootKeyBox', 'syncKeyBox'].indexOf(item) < 0
)

/**
 * Emulates the Airbitz login server database.
 */
export class FakeDb {
  logins: DbLogin[]
  pinKeyBox: JsonBox | undefined

  lobbies: { [lobbyId: string]: DbLobby }
  repos: { [syncKey: string]: DbRepo }

  constructor() {
    this.lobbies = {}
    this.pinKeyBox = undefined
    this.logins = []
    this.repos = {}
  }

  getLoginById(loginId: string): DbLogin | undefined {
    return this.logins.find(login => login.loginId === loginId)
  }

  getLoginByPin2Id(pin2Id: string): DbLogin | undefined {
    return this.logins.find(login => login.pin2Id === pin2Id)
  }

  getLoginByRecovery2Id(recovery2Id: string): DbLogin | undefined {
    return this.logins.find(login => login.recovery2Id === recovery2Id)
  }

  getLoginsByParent(parent: DbLogin): DbLogin[] {
    return this.logins.filter(child => child.parent === parent.loginId)
  }

  insertLogin(login: DbLogin): void {
    this.logins.push(login)
  }

  // Dumping & restoration --------------------------------------------

  setupFakeLogin(user: DbLoginDump, parent: string | null): void {
    // Fill in the database row for this login:
    const row = filterObject(user, loginDbColumns)
    row.parent = parent
    this.insertLogin(row)

    // Recurse into our children:
    if (user.children != null) {
      for (const child of user.children) {
        this.setupFakeLogin(child, user.loginId)
      }
    }
  }

  setupFakeUser(user: EdgeFakeUser): void {
    this.setupFakeLogin(user.server, null)

    // Create fake repos:
    for (const syncKey of Object.keys(user.repos)) {
      this.repos[syncKey] = { ...user.repos[syncKey] }
    }
  }

  dumpLogin(login: DbLogin): DbLoginDump {
    const out = filterObject(login, loginDbColumns)
    out.children = this.getLoginsByParent(login).map(child =>
      this.dumpLogin(child)
    )
    return out
  }
}

/**
 * Recursively builds up a login reply tree,
 * which the server sends back in response to a v2 login request.
 */
export function makeLoginReply(db: FakeDb, login: DbLogin): LoginReply {
  const children = db
    .getLoginsByParent(login)
    .map(child => makeLoginReply(db, child))

  return {
    // Identity:
    appId: login.appId,
    loginId: login.loginId,
    parentBox: login.parentBox,

    // Login methods:
    loginAuthBox: login.loginAuthBox,
    passwordAuthBox: login.passwordAuthBox,
    passwordAuthSnrp: login.passwordAuthSnrp,
    passwordBox: login.passwordBox,
    passwordKeySnrp: login.passwordKeySnrp,
    pin2Box: login.pin2Box,
    pin2KeyBox: login.pin2KeyBox,
    pin2TextBox: login.pin2TextBox,
    question2Box: login.question2Box,
    recovery2Box: login.recovery2Box,
    recovery2KeyBox: login.recovery2KeyBox,
    otpKey: login.otpKey,
    otpResetDate: login.otpResetDate,
    otpTimeout: login.otpTimeout,

    // Resources:
    keyBoxes: login.keyBoxes,
    mnemonicBox: login.mnemonicBox,
    rootKeyBox: login.rootKeyBox,
    syncKeyBox: login.syncKeyBox,
    children
  }
}
