import { abs, div, lt } from 'biggystring'
import jsoncsv from 'json-csv'

import { EdgeTransaction } from '../../../types/types'

function padZero(val: string) {
  if (val.length === 1) {
    return '0' + val
  }
  return val
}

function escapeOFXString(str: string) {
  str = str.replace(/&/g, '&amp;')
  str = str.replace(/>/g, '&gt;')
  return str.replace(/</g, '&lt;')
}

function exportOfxHeader(inputObj: any) {
  let out = ''
  for (const key of Object.keys(inputObj)) {
    let element = inputObj[key]
    if (typeof element === 'string') {
      element = escapeOFXString(element)
      out += `${key}:${element}\n`
    } else {
      throw new Error('Invalid OFX header')
    }
  }
  return out
}

function exportOfxBody(inputObj: any) {
  let out = ''
  for (const key of Object.keys(inputObj)) {
    let element = inputObj[key]
    if (typeof element === 'string') {
      element = escapeOFXString(element)
      out += `<${key}>${element}\n`
    } else if (element instanceof Array) {
      for (const a of element) {
        out += `<${key}>\n`
        out += exportOfxBody(a)
        out += `</${key}>\n`
      }
    } else if (typeof element === 'object') {
      out += `<${key}>\n`
      out += exportOfxBody(element)
      out += `</${key}>\n`
    } else {
      throw new Error('Invalid OFX body')
    }
  }
  return out
}

function exportOfx(header: any, body: any) {
  let out = exportOfxHeader(header) + '\n'
  out += '<OFX>\n'
  out += exportOfxBody(body)
  out += '</OFX>\n'
  return out
}

function makeOfxDate(date: number): string {
  const d = new Date(date * 1000)
  const yyyy = d.getUTCFullYear().toString()
  const mm = padZero((d.getUTCMonth() + 1).toString())
  const dd = padZero(d.getUTCDate().toString())
  const hh = padZero(d.getUTCHours().toString())
  const min = padZero(d.getUTCMinutes().toString())
  const ss = padZero(d.getUTCSeconds().toString())
  return `${yyyy}${mm}${dd}${hh}${min}${ss}.000`
}

function makeCsvDateTime(date: number): { date: string; time: string } {
  const d = new Date(date * 1000)
  const yyyy = d.getUTCFullYear().toString()
  const mm = padZero((d.getUTCMonth() + 1).toString())
  const dd = padZero(d.getUTCDate().toString())
  const hh = padZero(d.getUTCHours().toString())
  const min = padZero(d.getUTCMinutes().toString())

  return {
    date: `${yyyy}-${mm}-${dd}`,
    time: `${hh}:${min}`
  }
}

export function exportTransactionsToQBOInner(
  edgeTransactions: EdgeTransaction[],
  currencyCode: string,
  fiatCurrencyCode: string,
  denom: string | null,
  dateNow: number
): string {
  const STMTTRN = []
  const now = makeOfxDate(dateNow / 1000)

  for (const edgeTx of edgeTransactions) {
    const TRNAMT: string = denom
      ? div(edgeTx.nativeAmount, denom, 18)
      : edgeTx.nativeAmount
    const TRNTYPE = lt(edgeTx.nativeAmount, '0') ? 'DEBIT' : 'CREDIT'
    const DTPOSTED = makeOfxDate(edgeTx.date)
    let NAME: string = ''
    let amountFiat: number = 0
    let category: string = ''
    let notes: string = ''
    if (edgeTx.metadata) {
      NAME = edgeTx.metadata.name ? edgeTx.metadata.name : ''
      amountFiat = edgeTx.metadata.amountFiat ? edgeTx.metadata.amountFiat : 0
      category = edgeTx.metadata.category ? edgeTx.metadata.category : ''
      notes = edgeTx.metadata.notes ? edgeTx.metadata.notes : ''
    }
    const absFiat = abs(amountFiat.toString())
    const absAmount = abs(TRNAMT)
    const CURRATE = absAmount !== '0' ? div(absFiat, absAmount, 8) : '0'
    let memo = `// Rate=${CURRATE} ${fiatCurrencyCode}=${amountFiat} category="${category}" memo="${notes}"`
    if (memo.length > 250) {
      memo = memo.substring(0, 250) + '...'
    }
    const qboTxNamed = {
      TRNTYPE,
      DTPOSTED,
      TRNAMT,
      FITID: edgeTx.txid,
      NAME,
      MEMO: memo,
      CURRENCY: {
        CURRATE: CURRATE,
        CURSYM: fiatCurrencyCode
      }
    }
    const qboTx = {
      TRNTYPE,
      DTPOSTED,
      TRNAMT,
      FITID: edgeTx.txid,
      MEMO: memo,
      CURRENCY: {
        CURRATE: CURRATE,
        CURSYM: fiatCurrencyCode
      }
    }
    const use = NAME === '' ? qboTx : qboTxNamed
    STMTTRN.push(use)
  }

  const header = {
    OFXHEADER: '100',
    DATA: 'OFXSGML',
    VERSION: '102',
    SECURITY: 'NONE',
    ENCODING: 'USASCII',
    CHARSET: '1252',
    COMPRESSION: 'NONE',
    OLDFILEUID: 'NONE',
    NEWFILEUID: 'NONE'
  }

  const body = {
    SIGNONMSGSRSV1: {
      SONRS: {
        STATUS: {
          CODE: '0',
          SEVERITY: 'INFO'
        },
        DTSERVER: now,
        LANGUAGE: 'ENG',
        'INTU.BID': '3000'
      }
    },
    BANKMSGSRSV1: {
      STMTTRNRS: {
        TRNUID: now,
        STATUS: {
          CODE: '0',
          SEVERITY: 'INFO',
          MESSAGE: 'OK'
        },
        STMTRS: {
          CURDEF: 'USD',
          BANKACCTFROM: {
            BANKID: '999999999',
            ACCTID: '999999999999',
            ACCTTYPE: 'CHECKING'
          },
          BANKTRANLIST: {
            DTSTART: now,
            DTEND: now,
            STMTTRN
          },
          LEDGERBAL: {
            BALAMT: '0.00',
            DTASOF: now
          },
          AVAILBAL: {
            BALAMT: '0.00',
            DTASOF: now
          }
        }
      }
    }
  }

  return exportOfx(header, body)
}

export async function exportTransactionsToCSVInner(
  edgeTransactions: EdgeTransaction[],
  currencyCode: string,
  fiatCurrencyCode: string,
  denom: string | null
): Promise<string> {
  return new Promise((resolve, reject) => {
    const currencyField = 'AMT_' + currencyCode
    const networkFeeField = 'AMT_NETWORK_FEES_' + currencyCode
    const items = []

    for (const edgeTx of edgeTransactions) {
      const amount: string = denom
        ? div(edgeTx.nativeAmount, denom, 18)
        : edgeTx.nativeAmount
      const networkFeeField: string = denom
        ? div(edgeTx.networkFee, denom, 18)
        : edgeTx.networkFee
      const { date, time } = makeCsvDateTime(edgeTx.date)
      let name: string = ''
      let amountFiat: number = 0
      let category: string = ''
      let notes: string = ''
      if (edgeTx.metadata) {
        name = edgeTx.metadata.name ? edgeTx.metadata.name : ''
        amountFiat = edgeTx.metadata.amountFiat ? edgeTx.metadata.amountFiat : 0
        category = edgeTx.metadata.category ? edgeTx.metadata.category : ''
        notes = edgeTx.metadata.notes ? edgeTx.metadata.notes : ''
      }

      const csvTx = {
        date,
        time,
        name,
        amount,
        amountFiat,
        category,
        notes,
        networkFeeField,
        txid: edgeTx.txid,
        ourReceiveAddresses: edgeTx.ourReceiveAddresses,
        version: 1
      }
      items.push(csvTx)
    }

    const options = {
      fields: [
        {
          name: 'date',
          label: 'DATE',
          quoted: true
        },
        {
          name: 'time',
          label: 'TIME',
          quoted: true
        },
        {
          name: 'name',
          label: 'PAYEE_PAYER_NAME',
          quoted: true
        },
        {
          name: 'amount',
          label: currencyField,
          quoted: true
        },
        {
          name: 'amountFiat',
          label: fiatCurrencyCode,
          quoted: true
        },
        {
          name: 'category',
          label: 'CATEGORY',
          quoted: true
        },
        {
          name: 'notes',
          label: 'NOTES',
          quoted: true
        },
        {
          name: 'networkFeeField',
          label: networkFeeField,
          quoted: true
        },
        {
          name: 'txid',
          label: 'TXID',
          quoted: true
        },
        {
          name: 'ourReceiveAddresses',
          label: 'OUR_RECEIVE_ADDRESSES',
          quoted: true
        },
        {
          name: 'version',
          label: 'VER'
        }
      ]
    }

    jsoncsv.csvBuffered(items, options, (err, csv) => {
      if (err) {
        reject(err)
      } else {
        resolve(csv)
      }
    })
  })
}
