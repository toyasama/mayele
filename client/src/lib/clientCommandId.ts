type CommandIdCrypto = {
  randomUUID?: () => string
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T
}

const BYTE_TO_HEX = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, '0'))

function uuidFromRandomBytes(bytes: Uint8Array) {
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  return [
    BYTE_TO_HEX[bytes[0]],
    BYTE_TO_HEX[bytes[1]],
    BYTE_TO_HEX[bytes[2]],
    BYTE_TO_HEX[bytes[3]],
    '-',
    BYTE_TO_HEX[bytes[4]],
    BYTE_TO_HEX[bytes[5]],
    '-',
    BYTE_TO_HEX[bytes[6]],
    BYTE_TO_HEX[bytes[7]],
    '-',
    BYTE_TO_HEX[bytes[8]],
    BYTE_TO_HEX[bytes[9]],
    '-',
    BYTE_TO_HEX[bytes[10]],
    BYTE_TO_HEX[bytes[11]],
    BYTE_TO_HEX[bytes[12]],
    BYTE_TO_HEX[bytes[13]],
    BYTE_TO_HEX[bytes[14]],
    BYTE_TO_HEX[bytes[15]],
  ].join('')
}

export function createClientCommandId(cryptoSource: CommandIdCrypto | undefined = globalThis.crypto) {
  if (typeof cryptoSource?.randomUUID === 'function') {
    return cryptoSource.randomUUID()
  }

  if (typeof cryptoSource?.getRandomValues !== 'function') {
    throw new Error('Web Crypto indisponible: impossible de creer un identifiant de commande fiable.')
  }

  const bytes = new Uint8Array(16)
  cryptoSource.getRandomValues(bytes)
  return uuidFromRandomBytes(bytes)
}
