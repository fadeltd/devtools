/**
 * Just enough DER to turn the key wrappers people actually paste into the SPKI
 * that WebCrypto imports, and to recognise an ASN.1 ECDSA signature. This is a
 * walker, not a parser: it reads lengths and skips, and every read is bounds
 * checked so a malformed blob is `null`, never a throw or an out-of-range read.
 * WebCrypto's own import is what validates the key itself.
 */

export interface Tlv {
  tag: number
  /** Offset of the tag byte. */
  start: number
  /** Offset of the first content byte. */
  contentStart: number
  /** Offset one past the last content byte. */
  end: number
}

const SEQUENCE = 0x30
const INTEGER = 0x02
const BIT_STRING = 0x03
const OID = 0x06

/** One TLV at `offset`, or null if it overruns `limit` or is not DER. */
export function readTlv(bytes: Uint8Array, offset: number, limit = bytes.length): Tlv | null {
  if (offset + 2 > limit) return null
  const tag = bytes[offset]!
  // A high-tag-number form never occurs in the structures walked here.
  if ((tag & 0x1f) === 0x1f) return null
  let length = bytes[offset + 1]!
  let p = offset + 2
  if (length & 0x80) {
    const n = length & 0x7f
    // n === 0 is BER's indefinite length, which DER forbids. Four length bytes
    // is 4 GB, far past any key, so more is malformed rather than large.
    if (n === 0 || n > 4 || p + n > limit) return null
    length = 0
    for (let i = 0; i < n; i++) length = length * 256 + bytes[p++]!
  }
  const end = p + length
  return end > limit ? null : { tag, start: offset, contentStart: p, end }
}

/** The children of a constructed TLV, or null if they do not exactly fill it. */
export function readChildren(bytes: Uint8Array, parent: Tlv): Tlv[] | null {
  const out: Tlv[] = []
  let p = parent.contentStart
  while (p < parent.end) {
    const child = readTlv(bytes, p, parent.end)
    if (child === null) return null
    out.push(child)
    p = child.end
  }
  return out
}

export function encodeTlv(tag: number, content: Uint8Array): Uint8Array {
  const n = content.length
  const length =
    n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 0xff] : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]
  const out = new Uint8Array(1 + length.length + n)
  out[0] = tag
  out.set(length, 1)
  out.set(content, 1 + length.length)
  return out
}

/** Dotted form of an OBJECT IDENTIFIER's content bytes. */
export function oidToString(content: Uint8Array): string {
  if (content.length === 0) return ''
  const first = content[0]!
  const arcs = [first < 80 ? Math.floor(first / 40) : 2, first < 80 ? first % 40 : first - 80]
  let value = 0
  for (let i = 1; i < content.length; i++) {
    const b = content[i]!
    value = value * 128 + (b & 0x7f)
    if ((b & 0x80) === 0) {
      arcs.push(value)
      value = 0
    }
  }
  return arcs.join('.')
}

export interface SpkiAlgorithm {
  oid: string
  /** The parameter OID, when there is one: the named curve for an EC key. */
  param?: string
}

/** The AlgorithmIdentifier of a SubjectPublicKeyInfo. */
export function spkiAlgorithm(der: Uint8Array): SpkiAlgorithm | null {
  const spki = readTlv(der, 0)
  if (spki === null || spki.tag !== SEQUENCE || spki.end !== der.length) return null
  const [algId, key] = readChildren(der, spki) ?? []
  if (algId?.tag !== SEQUENCE || key?.tag !== BIT_STRING) return null
  const [oid, param] = readChildren(der, algId) ?? []
  if (oid?.tag !== OID) return null
  const out: SpkiAlgorithm = { oid: oidToString(der.subarray(oid.contentStart, oid.end)) }
  if (param?.tag === OID) out.param = oidToString(der.subarray(param.contentStart, param.end))
  return out
}

// AlgorithmIdentifier { rsaEncryption, NULL }: the fixed prefix of every RSA SPKI.
const RSA_ALGORITHM_ID = Uint8Array.of(
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
)

/**
 * PKCS#1 `RSA PUBLIC KEY` is the bare { n, e } sequence; SPKI is that same
 * sequence inside a BIT STRING with an algorithm identifier in front. So the
 * conversion is a wrap, not a parse.
 */
export function pkcs1ToSpki(pkcs1: Uint8Array): Uint8Array | null {
  const seq = readTlv(pkcs1, 0)
  if (seq === null || seq.tag !== SEQUENCE || seq.end !== pkcs1.length) return null
  const parts = readChildren(pkcs1, seq)
  if (parts?.length !== 2 || parts.some((p) => p.tag !== INTEGER)) return null
  const bits = new Uint8Array(pkcs1.length + 1) // leading 0: no unused bits
  bits.set(pkcs1, 1)
  const key = encodeTlv(BIT_STRING, bits)
  const body = new Uint8Array(RSA_ALGORITHM_ID.length + key.length)
  body.set(RSA_ALGORITHM_ID)
  body.set(key, RSA_ALGORITHM_ID.length)
  return encodeTlv(SEQUENCE, body)
}

/**
 * The SubjectPublicKeyInfo inside an X.509 certificate (RFC 5280 §4.1):
 * Certificate → tbsCertificate → [0] version (optional), serialNumber,
 * signature, issuer, validity, subject, then the SPKI. The certificate's own
 * signature is not checked: verifying a JWT needs the key, not trust in the CA.
 */
export function certificateSpki(der: Uint8Array): Uint8Array | null {
  const cert = readTlv(der, 0)
  if (cert === null || cert.tag !== SEQUENCE) return null
  const tbs = readTlv(der, cert.contentStart, cert.end)
  if (tbs === null || tbs.tag !== SEQUENCE) return null
  const fields = readChildren(der, tbs)
  if (fields === null) return null
  const rest = fields[0]?.tag === 0xa0 ? fields.slice(1) : fields
  const expected = [INTEGER, SEQUENCE, SEQUENCE, SEQUENCE, SEQUENCE, SEQUENCE]
  if (rest.length < expected.length || expected.some((tag, i) => rest[i]!.tag !== tag)) return null
  const spki = rest[5]!
  return der.slice(spki.start, spki.end)
}

/**
 * True for an ASN.1 `SEQUENCE { INTEGER r, INTEGER s }`: what OpenSSL, Java
 * and most HSMs emit for ECDSA, and what JWS forbids (RFC 7518 §3.4 wants the
 * fixed-width r‖s that WebCrypto also uses).
 */
export function isDerEcdsaSignature(sig: Uint8Array): boolean {
  const seq = readTlv(sig, 0)
  if (seq === null || seq.tag !== SEQUENCE || seq.end !== sig.length) return false
  const parts = readChildren(sig, seq)
  return parts?.length === 2 && parts.every((p) => p.tag === INTEGER)
}
