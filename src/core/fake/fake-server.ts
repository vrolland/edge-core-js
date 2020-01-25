import { checkTotp } from '../../util/crypto/hotp'
import { utf8 } from '../../util/encoding'
import { pickMethod, pickPath, pickServer } from '../../util/http/http-routing'
import { FetchServer } from '../../util/http/http-to-fetch'
import { HttpRequest, HttpResponse, Server } from '../../util/http/http-types'
import { addHiddenProperties, filterObject, softCat } from '../../util/util'
import {
  DbLobby,
  DbLogin,
  DbRepo,
  FakeDb,
  loginCreateColumns,
  makeLoginReply
} from './fake-db'
import {
  jsonResponse,
  loginResponse,
  otpErrorResponse,
  passwordErrorResponse,
  statusCodes,
  statusResponse
} from './fake-responses'

const OTP_RESET_TOKEN = 'Super secret reset token'

type ApiRequest = HttpRequest & {
  readonly db: FakeDb
  readonly json: any
}
type LoginRequest = ApiRequest & {
  readonly login: DbLogin
}

type ApiServer = Server<ApiRequest>
type LoginServer = Server<LoginRequest>

// Authentication middleware: ----------------------------------------------

const handleMissingCredentials: ApiServer = async request =>
  statusResponse(statusCodes.invalidRequest)

/**
 * Verifies that the request contains valid v1 authentication.
 */
const withLogin1 = (
  server: LoginServer,
  fallback: ApiServer = handleMissingCredentials
): ApiServer => async request => {
  const { db, json } = request

  // Password login:
  if (json.l1 != null && json.lp1 != null) {
    const login = db.getLoginById(json.l1)
    if (login == null) {
      return statusResponse(statusCodes.noAccount)
    }
    if (json.lp1 !== login.passwordAuth) {
      return passwordErrorResponse(0)
    }
    return server({ ...request, login })
  }
  return fallback(request)
}

/**
 * Verifies that the request contains valid v2 authentication.
 */
const withLogin2 = (
  server: LoginServer,
  fallback: ApiServer = handleMissingCredentials
): ApiServer => async request => {
  const { db, json } = request

  // Token login:
  if (json.loginId != null && json.loginAuth != null) {
    const login = db.getLoginById(json.loginId)
    if (login == null) {
      return statusResponse(statusCodes.noAccount)
    }
    if (json.loginAuth !== login.loginAuth) {
      return passwordErrorResponse(0)
    }
    if (login.otpKey != null && !checkTotp(login.otpKey, json.otp)) {
      return otpErrorResponse(OTP_RESET_TOKEN)
    }
    return server({ ...request, login })
  }

  // Password login:
  if (json.userId != null && json.passwordAuth != null) {
    const login = db.getLoginById(json.userId)
    if (login == null) {
      return statusResponse(statusCodes.noAccount)
    }
    if (json.passwordAuth !== login.passwordAuth) {
      return passwordErrorResponse(0)
    }
    if (login.otpKey != null && !checkTotp(login.otpKey, json.otp)) {
      return otpErrorResponse(OTP_RESET_TOKEN)
    }
    return server({ ...request, login })
  }

  // PIN2 login:
  if (json.pin2Id != null && json.pin2Auth != null) {
    const login = db.getLoginByPin2Id(json.pin2Id)
    if (login == null) {
      return statusResponse(statusCodes.noAccount)
    }
    if (json.pin2Auth !== login.pin2Auth) {
      return passwordErrorResponse(0)
    }
    if (login.otpKey != null && !checkTotp(login.otpKey, json.otp)) {
      return otpErrorResponse(OTP_RESET_TOKEN)
    }
    return server({ ...request, login })
  }

  // Recovery2 login:
  if (json.recovery2Id != null && json.recovery2Auth != null) {
    const login = db.getLoginByRecovery2Id(json.recovery2Id)
    if (login == null) {
      return statusResponse(statusCodes.noAccount)
    }
    const serverAuth = login.recovery2Auth
    const clientAuth = json.recovery2Auth
    if (serverAuth == null || clientAuth.length !== serverAuth.length) {
      return passwordErrorResponse(0)
    }
    for (let i = 0; i < clientAuth.length; ++i) {
      if (clientAuth[i] !== serverAuth[i]) {
        return passwordErrorResponse(0)
      }
    }
    if (login.otpKey != null && !checkTotp(login.otpKey, json.otp)) {
      return otpErrorResponse(OTP_RESET_TOKEN)
    }
    return server({ ...request, login })
  }

  return fallback(request)
}

// Account lifetime v1: ----------------------------------------------------

const availableRoute: ApiServer = pickMethod({
  POST: async request => {
    const { db, json } = request
    if (typeof json.l1 !== 'string') {
      return statusResponse(statusCodes.invalidRequest)
    }
    if (db.getLoginById(json.l1) != null) {
      return statusResponse(statusCodes.accountExists)
    }
    return statusResponse(statusCodes.success, 'Account available')
  }
})

const create1Route: ApiServer = pickMethod({
  POST: async request => {
    const { db, json } = request
    if (typeof json.l1 === 'string' && db.getLoginById(json.l1) != null) {
      return statusResponse(statusCodes.accountExists)
    }

    const carePackage = JSON.parse(json.care_package)
    const loginPackage = JSON.parse(json.login_package)
    db.insertLogin({
      appId: '',
      loginId: json.l1,
      passwordAuth: json.lp1,
      passwordKeySnrp: carePackage.SNRP2,
      passwordAuthBox: loginPackage.ELP1,
      passwordBox: loginPackage.EMK_LP2,
      syncKeyBox: loginPackage.ESyncKey,
      keyBoxes: []
    })
    db.repos[json.repo_account_key] = {}

    return statusResponse(statusCodes.created, 'Account created')
  }
})

const activateRoute: ApiServer = withLogin1(
  pickMethod({
    POST: async request => {
      return statusResponse(statusCodes.success, 'Account activated')
    }
  })
)

// Login v1: ---------------------------------------------------------------

const carePackageRoute: ApiServer = pickMethod({
  POST: async request => {
    const { db, json } = request
    if (typeof json.l1 !== 'string') {
      return statusResponse(statusCodes.invalidRequest)
    }
    const login = db.getLoginById(json.l1)
    if (login == null) {
      return statusResponse(statusCodes.noAccount)
    }

    return loginResponse({
      care_package: JSON.stringify({
        SNRP2: login.passwordKeySnrp
      })
    })
  }
})

const loginPackageRoute: ApiServer = withLogin1(
  pickMethod({
    POST: async request => {
      const { login } = request
      const results: any = {
        login_package: JSON.stringify({
          ELP1: login.passwordAuthBox,
          EMK_LP2: login.passwordBox,
          ESyncKey: login.syncKeyBox
        })
      }
      if (login.rootKeyBox != null) {
        results.rootKeyBox = login.rootKeyBox
      }
      return loginResponse(results)
    }
  })
)

const otpResetRoute: ApiServer = pickMethod({
  POST: async request => {
    const { db, json } = request
    if (typeof json.l1 !== 'string') {
      return statusResponse(statusCodes.invalidRequest)
    }
    const login = db.getLoginById(json.l1)
    if (login == null || json.otp_reset_auth !== OTP_RESET_TOKEN) {
      return statusResponse(statusCodes.invalidPassword)
    }
    const { otpKey, otpTimeout } = login
    if (otpKey == null || otpTimeout == null) {
      return statusResponse(
        statusCodes.invalidRequest,
        'OTP not setup for this account.'
      )
    }
    const resetDate = new Date(Date.now() + 1000 * otpTimeout)
    login.otpResetDate = resetDate.toISOString()
    return statusResponse(statusCodes.success, 'Reset requested')
  }
})

// PIN login v1: -----------------------------------------------------------

const pinUpdateRoute: ApiServer = withLogin1(
  pickMethod({
    POST: async request => {
      const { db, json } = request
      db.pinKeyBox = JSON.parse(json.pin_package)
      return statusResponse()
    }
  })
)

const pinGetRoute: ApiServer = pickMethod({
  POST: async request => {
    const { db } = request
    if (db.pinKeyBox == null) {
      return statusResponse(statusCodes.noAccount)
    }
    return loginResponse({
      pin_package: JSON.stringify(db.pinKeyBox)
    })
  }
})

// Repo server v1: ---------------------------------------------------------

const walletCreateRoute: ApiServer = withLogin1(
  pickMethod({
    POST: async request => {
      const { db, json } = request
      db.repos[json.repo_wallet_key] = {}
      return statusResponse(statusCodes.created, 'Wallet created')
    }
  })
)

const walletActivateRoute: ApiServer = withLogin1(
  pickMethod({
    POST: async request => {
      return statusResponse(statusCodes.success, 'Wallet updated')
    }
  })
)

// login v2: ---------------------------------------------------------------

const loginRoute: ApiServer = pickMethod({
  POST: withLogin2(
    // Authenticated version:
    async request => {
      const { db, login } = request
      return loginResponse(makeLoginReply(db, login))
    },
    // Fallback version:
    async request => {
      const { db, json } = request
      if (json.userId != null && json.passwordAuth == null) {
        const login = db.getLoginById(json.userId)
        if (login == null) {
          return statusResponse(statusCodes.noAccount)
        }
        return loginResponse({
          passwordAuthSnrp: login.passwordAuthSnrp
        })
      }
      if (json.recovery2Id != null && json.recovery2Auth == null) {
        const login = db.getLoginByRecovery2Id(json.recovery2Id)
        if (login == null) {
          return statusResponse(statusCodes.noAccount)
        }
        return loginResponse({
          question2Box: login.question2Box
        })
      }
      return statusResponse(statusCodes.invalidRequest)
    }
  )
})

async function createLogin(
  request: ApiRequest,
  login?: DbLogin
): Promise<HttpResponse> {
  const { db, json } = request
  const { data } = json
  if (data.appId == null || data.loginId == null) {
    return statusResponse(statusCodes.invalidRequest)
  }
  if (db.getLoginById(data.loginId) != null) {
    return statusResponse(statusCodes.accountExists)
  }

  // Set up repos:
  if (data.newSyncKeys != null) {
    for (const syncKey of data.newSyncKeys) {
      db.repos[syncKey] = {}
    }
  }

  // Set up login object:
  const row: DbLogin = filterObject(data, loginCreateColumns)
  if (login != null) {
    const children = db.getLoginsByParent(login)
    const appIdExists =
      children.find(child => child.appId === data.appId) != null
    if (appIdExists) {
      return statusResponse(statusCodes.invalidAppId)
    }
    row.parent = login.loginId
  }
  db.insertLogin(row)

  return statusResponse(statusCodes.created, 'Account created')
}

const create2Route: ApiServer = pickMethod({
  POST: withLogin2(
    request => createLogin(request, request.login),
    request => createLogin(request)
  )
})

const keysRoute: ApiServer = withLogin2(
  pickMethod({
    POST: async request => {
      const { db, json, login } = request
      const { data } = json
      if (data.keyBoxes == null) {
        return statusResponse(statusCodes.invalidRequest)
      }

      // Set up repos:
      if (data.newSyncKeys != null) {
        for (const syncKey of data.newSyncKeys) {
          db.repos[syncKey] = {}
        }
      }

      login.keyBoxes = softCat(login.keyBoxes, data.keyBoxes)

      return statusResponse()
    }
  })
)

const otp2Route: ApiServer = pickMethod({
  POST: withLogin2(async request => {
    const { json, login } = request
    const { data } = json
    if (data.otpKey == null || data.otpTimeout == null) {
      return statusResponse(statusCodes.invalidRequest)
    }

    login.otpKey = data.otpKey
    login.otpTimeout = data.otpTimeout
    login.otpResetDate = undefined

    return statusResponse()
  }),

  DELETE: withLogin2(
    // Authenticated version:
    async request => {
      const { login } = request
      login.otpKey = undefined
      login.otpTimeout = undefined
      login.otpResetDate = undefined

      return statusResponse()
    },
    // Fallback version:
    async request => {
      const { db, json } = request
      if (json.userId == null || json.otpResetAuth == null) {
        return statusResponse(statusCodes.invalidRequest)
      }
      const login = db.getLoginById(json.userId)
      if (login == null) {
        return statusResponse(statusCodes.noAccount)
      }
      if (json.otpResetAuth !== OTP_RESET_TOKEN) {
        return passwordErrorResponse(0)
      }
      const { otpKey, otpTimeout } = login
      if (otpKey == null || otpTimeout == null) {
        return statusResponse(
          statusCodes.invalidRequest,
          'OTP not setup for this account.'
        )
      }
      if (login.otpResetDate == null) {
        const resetDate = new Date(Date.now() + 1000 * otpTimeout)
        login.otpResetDate = resetDate.toISOString()
      }
      return loginResponse({
        otpResetDate: login.otpResetDate
      })
    }
  )
})

const password2Route: ApiServer = withLogin2(
  pickMethod({
    DELETE: async request => {
      const { login } = request
      login.passwordAuth = undefined
      login.passwordAuthBox = undefined
      login.passwordAuthSnrp = undefined
      login.passwordBox = undefined
      login.passwordKeySnrp = undefined

      return statusResponse()
    },

    POST: async request => {
      const { json, login } = request
      const { data } = json
      if (
        data.passwordAuth == null ||
        data.passwordAuthBox == null ||
        data.passwordAuthSnrp == null ||
        data.passwordBox == null ||
        data.passwordKeySnrp == null
      ) {
        return statusResponse(statusCodes.invalidRequest)
      }

      login.passwordAuth = data.passwordAuth
      login.passwordAuthBox = data.passwordAuthBox
      login.passwordAuthSnrp = data.passwordAuthSnrp
      login.passwordBox = data.passwordBox
      login.passwordKeySnrp = data.passwordKeySnrp

      return statusResponse()
    }
  })
)

const pin2Route: ApiServer = withLogin2(
  pickMethod({
    DELETE: async request => {
      const { login } = request
      login.pin2Auth = undefined
      login.pin2Box = undefined
      login.pin2Id = undefined
      login.pin2KeyBox = undefined
      login.pin2TextBox = undefined

      return statusResponse()
    },

    POST: async request => {
      const { json, login } = request
      const { data } = json

      const enablingPin =
        data.pin2Auth != null &&
        data.pin2Box != null &&
        data.pin2Id != null &&
        data.pin2KeyBox != null
      const disablingPin =
        data.pin2Auth == null &&
        data.pin2Box == null &&
        data.pin2Id == null &&
        data.pin2KeyBox == null &&
        data.pin2TextBox != null

      if (!enablingPin && !disablingPin) {
        return statusResponse(statusCodes.invalidRequest)
      }

      login.pin2Auth = data.pin2Auth
      login.pin2Box = data.pin2Box
      login.pin2Id = data.pin2Id
      login.pin2KeyBox = data.pin2KeyBox
      login.pin2TextBox = data.pin2TextBox

      return statusResponse()
    }
  })
)

const recovery2Route: ApiServer = withLogin2(
  pickMethod({
    DELETE: async request => {
      const { login } = request
      login.question2Box = undefined
      login.recovery2Auth = undefined
      login.recovery2Box = undefined
      login.recovery2Id = undefined
      login.recovery2KeyBox = undefined

      return statusResponse()
    },

    POST: async request => {
      const { json, login } = request
      const { data } = json
      if (
        data.question2Box == null ||
        data.recovery2Auth == null ||
        data.recovery2Box == null ||
        data.recovery2Id == null ||
        data.recovery2KeyBox == null
      ) {
        return statusResponse(statusCodes.invalidRequest)
      }

      login.question2Box = data.question2Box
      login.recovery2Auth = data.recovery2Auth
      login.recovery2Box = data.recovery2Box
      login.recovery2Id = data.recovery2Id
      login.recovery2KeyBox = data.recovery2KeyBox

      return statusResponse()
    }
  })
)

// lobby: ------------------------------------------------------------------

type LobbyIdRequest = ApiRequest & { lobbyId: string }

const handleMissingLobby: Server<LobbyIdRequest> = async request =>
  statusResponse(statusCodes.noLobby, `Cannot find lobby ${request.lobbyId}`)

const withLobby = (
  server: Server<LobbyIdRequest & { lobby: DbLobby }>,
  fallback: Server<LobbyIdRequest> = handleMissingLobby
): ApiServer => request => {
  const { db, path } = request
  const lobbyId = path.split('/')[4]
  const lobby = db.lobbies[lobbyId]
  return lobby != null
    ? server({ ...request, lobby, lobbyId })
    : fallback({ ...request, lobbyId })
}

const lobbyRoute: ApiServer = pickMethod({
  PUT: withLobby(
    async request =>
      statusResponse(
        statusCodes.accountExists,
        `Lobby ${request.lobbyId} already exists.`
      ),
    async request => {
      const { db, json, lobbyId } = request
      const { data } = json
      const { timeout = 600 } = data
      const expires = new Date(Date.now() + 1000 * timeout).toISOString()

      db.lobbies[lobbyId] = { request: data, replies: [], expires }
      return statusResponse()
    }
  ),

  POST: withLobby(async request => {
    const { json, lobby } = request
    lobby.replies.push(json.data)
    return statusResponse()
  }),

  GET: withLobby(async request => {
    const { lobby } = request
    return loginResponse(lobby)
  }),

  DELETE: withLobby(async request => {
    const { db, lobbyId } = request
    delete db.lobbies[lobbyId]
    return statusResponse()
  })
})

// messages: ---------------------------------------------------------------

const messagesRoute: ApiServer = pickMethod({
  POST: async request => {
    const { db, json } = request
    const { loginIds } = json

    const out = []
    for (const loginId of loginIds) {
      const login = db.getLoginById(loginId)
      if (login != null) {
        out.push({
          loginId,
          otpResetPending: login.otpResetDate != null,
          recovery2Corrupt: false
        })
      }
    }
    return loginResponse(out)
  }
})

// sync: -------------------------------------------------------------------

type RepoRequest = ApiRequest & { repo: DbRepo }

const withRepo = (server: Server<RepoRequest>): ApiServer => async request => {
  const { db, path } = request
  const elements = path.split('/')
  const syncKey = elements[4]
  // const hash = elements[5]

  const repo = db.repos[syncKey]
  if (repo == null) {
    // This is not the auth server, so we have a different format:
    return jsonResponse({ msg: 'Hash not found' }, { status: 404 })
  }

  return server({ ...request, repo })
}

const storeRoute: ApiServer = withRepo(
  pickMethod({
    GET: async request => {
      const { repo } = request
      return jsonResponse({ changes: repo })
    },

    POST: async request => {
      const { json, repo } = request
      const { changes } = json
      for (const change of Object.keys(changes)) {
        repo[change] = changes[change]
      }
      return jsonResponse({
        changes: repo,
        hash: '1111111111111111111111111111111111111111'
      })
    }
  })
)

// router: -----------------------------------------------------------------

const urls: ApiServer = pickPath({
  // Login v2 endpoints:
  '/api/v2/login/?': loginRoute,
  '/api/v2/login/create/?': create2Route,
  '/api/v2/login/keys/?': keysRoute,
  '/api/v2/login/otp/?': otp2Route,
  '/api/v2/login/password/?': password2Route,
  '/api/v2/login/pin2/?': pin2Route,
  '/api/v2/login/recovery2/?': recovery2Route,
  '/api/v2/messages/?': messagesRoute,

  // Login v1 endpoints:
  '/api/v1/account/available/?': availableRoute,
  '/api/v1/account/create/?': create1Route,
  '/api/v1/account/activate/?': activateRoute,
  '/api/v1/account/carepackage/get/?': carePackageRoute,
  '/api/v1/account/loginpackage/get/?': loginPackageRoute,
  '/api/v1/otp/reset/?': otpResetRoute,
  '/api/v1/wallet/create/?': walletCreateRoute,
  '/api/v1/wallet/activate/?': walletActivateRoute,

  // PIN v1 endpoints:
  '/api/v1/account/pinpackage/update/?': pinUpdateRoute,
  '/api/v1/account/pinpackage/get/?': pinGetRoute,

  // Lobby server endpoints:
  '/api/v2/lobby/[^/]+/?': lobbyRoute,

  // Sync server endpoints:
  '/api/v2/store/[^/]+/?': storeRoute
})

// Wrap a better 404 error handler around the server:
const server: ApiServer = pickServer(urls, async request =>
  statusResponse(statusCodes.notFound, `Unknown API endpoint ${request.path}`)
)

/**
 * Binds the fake server to a particular db instance.
 */
export function makeFakeServer(db: FakeDb): FetchServer & { offline: boolean } {
  const serveRequest: FetchServer = request => {
    if (out.offline) throw new Error('Fake network error')
    const json =
      request.body.byteLength > 0
        ? JSON.parse(utf8.stringify(new Uint8Array(request.body)))
        : undefined
    return server({ ...request, db, json })
  }
  const out = addHiddenProperties(serveRequest, { offline: false })
  return out
}
