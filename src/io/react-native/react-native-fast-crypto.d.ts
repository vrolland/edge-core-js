// We don't actually install this library in node_modules,
// so we need to provide its definition locally.

declare module 'react-native-fast-crypto' {
  function scrypt(
    data: Uint8Array,
    salt: Uint8Array,
    n: number,
    r: number,
    p: number,
    dklen: number
  ): Promise<Uint8Array>
}
