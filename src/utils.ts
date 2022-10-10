import { store, crypto, ethereum, BigDecimal } from '@graphprotocol/graph-ts'
import { BigInt, Address, ByteArray } from '@graphprotocol/graph-ts'
import {
  LidoDayData,
  LidoHourData,
  Totals,
  UserDayData,
  UserHourData
} from '../generated/schema'

import {
  ORACLE_RUNS_BUFFER,
  getOraclePeriod,
  getFirstOracleReport,
  ZERO,
  ONE,
  ZEROBD
} from './constants'

export function guessOracleRunsTotal(currentblockTime: BigInt): BigInt {
  // We know when first Oracle report happened
  // We can find out for how long Oracle report have been happening
  // Knowing how often they happen, we can estimate how many reports there have been

  let currentFullDaysSinceEpoch = currentblockTime
  let oracleFirstDaySinceEpoch = getFirstOracleReport()

  let runningTime = currentFullDaysSinceEpoch.minus(oracleFirstDaySinceEpoch)

  // TODO: Can we improve this?
  // Writing this would round the number to zero:
  // let probableId = runningTime.div(getOraclePeriod())
  // For it's best to overestimate than underestimate:
  let probableId = BigInt.fromI64(
    <i64>Math.ceil(<f64>runningTime.toI64() / <f64>getOraclePeriod().toI64())
  )

  // If estimation is requested before first report, number would be negative
  if (probableId.le(ZERO)) {
    return ZERO
  }

  // Our estimation is not 100% accurate - it needs a safety buffer
  // We will try to load this estimate and if it fails try n-1 each time until we load an entity successfully or reach zero
  return probableId.plus(ORACLE_RUNS_BUFFER)
}

export function lastIncrementalId(entityName: string, i: BigInt): string {
  // Wrong id, doesn't exist yet. Make sure it doesn't load.
  if (i.equals(ZERO)) {
    // 0 id doesn't exist (id start from 1), but
    // But allows us to still do newId = lastIncrementalId() + 1
    return ZERO.toString()
  }

  // Try to load entity with this id
  let entity = store.get(entityName, i.toString())

  if (entity) {
    // It exists, return id
    return i.toString()
  } else {
    // It doesn't exist, trying id - 1
    return lastIncrementalId(entityName, i.minus(ONE))
  }
}

export function nextIncrementalId(entityName: string, i: BigInt): string {
  if (i.equals(ZERO)) {
    // No entities, start from 1
    return ONE.toString()
  }

  // Try to load entity with this id
  let entity = store.get(entityName, i.toString())

  if (entity) {
    let nextItem = i.plus(ONE)
    return nextItem.toString()
  } else {
    return nextIncrementalId(entityName, i.minus(ONE))
  }
}

/**
Temporary solution until conversion is implemented in Address:
https://github.com/graphprotocol/support/issues/40
**/

export function toChecksumAddress(address: Address): string {
  let lowerCaseAddress = address.toHex().slice(2)
  // note that this is actually a hash of the string representation of the hex without the "0x"
  let hash = crypto
    .keccak256(ByteArray.fromUTF8(address.toHex().slice(2)))
    .toHex()
    .slice(2)
  let result = '0x'

  for (let i = 0; i < lowerCaseAddress.length; i++) {
    if (parseInt(hash.charAt(i), 16) >= 8) {
      result += toUpper(lowerCaseAddress.charAt(i))
    } else {
      result += lowerCaseAddress.charAt(i)
    }
  }

  return result
}

// because there is no String.toUpper() in assemblyscript
function toUpper(str: string): string {
  let result = ''
  for (let i = 0; i < str.length; i++) {
    let charCode = str.charCodeAt(i)
    // only operate on lowercase 'a' through lower case 'z'
    if (charCode >= 97 && charCode <= 122) {
      result += String.fromCharCode(charCode - 32)
    } else {
      result += str.charAt(i)
    }
  }
  return result
}

export function updateUserDayDataFromEvent(event: ethereum.Event): void {
  updateUserDayDataFromAddress(
    event.transaction.from,
    event.block.timestamp.toU64()
  )
  if (event.transaction.to)
    updateUserDayDataFromAddress(
      event.transaction.to!,
      event.block.timestamp.toU64()
    )
}

export function updateUserDayDataFromAddress(
  addr: Address,
  timestamp: u64
): void {
  // round to day precision
  let dayID = timestamp / 86400
  let id = addr
    .toHexString()
    .concat('-')
    .concat(dayID.toString())

  // if user has not been indexed before,
  // then increment the activeUsers counter to
  // only account for unique addresses
  let userDayData = UserDayData.load(id)
  if (!userDayData) {
    userDayData = new UserDayData(id)

    let dayData = LidoDayData.load(dayID.toString())
    if (dayData) {
      dayData.activeUsers = dayData.activeUsers.plus(ONE)
      dayData.save()
    }
  }

  userDayData.save()
}

export function updateDayData(event: ethereum.Event): void {
  let timestamp = event.block.timestamp.toI32()
  let dayID = timestamp / 86400
  let dayStartTimestamp = dayID * 86400
  let dayData = LidoDayData.load(dayID.toString())
  if (!dayData) {
    dayData = new LidoDayData(dayID.toString())
    dayData.periodStartUnix = dayStartTimestamp
    dayData.activeUsers = ZERO
    dayData.tvlETH = ZEROBD
    dayData.tvlUSD = ZEROBD
    dayData.txCount = ZERO
    dayData.activeUsers = ZERO
  }

  let totals = Totals.load('')
  if (totals) {
    dayData.tvlETH = totals.tvlETH
    dayData.tvlUSD = totals.tvlUSD
  }

  dayData.txCount = dayData.txCount.plus(ONE)

  dayData.save()
}

export function updateUserHourDataFromEvent(event: ethereum.Event): void {
  updateUserHourDataFromAddress(
    event.transaction.from,
    event.block.timestamp.toU64()
  )
  if (event.transaction.to)
    updateUserHourDataFromAddress(
      event.transaction.to!,
      event.block.timestamp.toU64()
    )
}

export function updateUserHourDataFromAddress(
  addr: Address,
  timestamp: u64
): void {
  // round to hour precision
  let hourIndex = timestamp / 3600
  let tokenHourID = hourIndex.toString()

  let id = addr
    .toHexString()
    .concat('-')
    .concat(tokenHourID)

  // if user has not been indexed before,
  // then increment the activeUsers counter to
  // only account for unique addresses
  let userHourData = UserHourData.load(id)
  if (!userHourData) {
    userHourData = new UserHourData(id)

    let hourData = LidoHourData.load(tokenHourID)
    if (hourData) {
      hourData.activeUsers = hourData.activeUsers.plus(ONE)
      hourData.save()
    }
  }

  userHourData.save()
}

export function updateHourData(event: ethereum.Event): void {
  let timestamp = event.block.timestamp.toI32()
  let hourIndex = timestamp / 3600
  let hourStartUnix = hourIndex * 3600
  let tokenHourID = hourIndex.toString()
  let hourData = LidoHourData.load(tokenHourID)

  if (!hourData) {
    hourData = new LidoHourData(tokenHourID)
    hourData.periodStartUnix = hourStartUnix
    hourData.activeUsers = ZERO
    hourData.tvlETH = ZEROBD
    hourData.tvlUSD = ZEROBD
    hourData.txCount = ZERO
    hourData.activeUsers = ZERO
  }

  let totals = Totals.load('')
  if (totals) {
    hourData.tvlETH = totals.tvlETH
    hourData.tvlUSD = totals.tvlUSD
  }

  hourData.txCount = hourData.txCount.plus(ONE)

  hourData.save()
}

export function updatePeriodicData(event: ethereum.Event): void {
  updateDayData(event)
  updateHourData(event)
  updateUserDayDataFromEvent(event)
  updateUserHourDataFromEvent(event)
}
