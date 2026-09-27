// Constructor de ZIP mínimo para los tests (tests/ingest.mjs, tests/zipbomb.mjs).
// Extraído de tests/ingest.mjs; además admite, por entrada, `declaredSize`
// (tamaño descomprimido que se ESCRIBE en las cabeceras, para simular una
// cabecera que miente) y `compData` (bytes ya comprimidos tal cual).

import { deflateRawSync } from 'node:zlib';

// ---------------------------------------------------------------------
// Constructor de ZIP mínimo (spec-compliant) para las pruebas. minizip.js
// NO verifica el CRC32 (confirmado leyendo readZipEntry), pero lo calculamos
// igualmente para que el fixture sea un ZIP de verdad, no un atajo.
// ---------------------------------------------------------------------
let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export const enc = new TextEncoder();

/**
 * files: [{ name, data: string|Uint8Array, method?: 'stored'|'deflate', rawMethod?: number }]
 * rawMethod fuerza un código de método arbitrario (para simular uno no soportado).
 */
export function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const dataBytes = f.data instanceof Uint8Array ? f.data : enc.encode(f.data);
    const method = f.rawMethod != null ? f.rawMethod : (f.method === 'deflate' ? 8 : 0);
    const compData = f.compData ? Buffer.from(f.compData) : (f.method === 'deflate' ? deflateRawSync(Buffer.from(dataBytes)) : Buffer.from(dataBytes));
    const declared = f.declaredSize != null ? f.declaredSize : dataBytes.length;
    const crc = crc32(dataBytes);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compData.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    Buffer.from(nameBytes).copy(local, 30);
    localParts.push(local, compData);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compData.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    Buffer.from(nameBytes).copy(central, 46);
    centralParts.push(central);

    offset += local.length + compData.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  const full = Buffer.concat([...localParts, centralBuf, eocd]);
  return full.buffer.slice(full.byteOffset, full.byteOffset + full.length);
}

export function qzaFile(name, dataFiles, uuid = 'a1b2c3d4-0000-0000-0000-000000000001') {
  const entries = [
    { name: `${uuid}/data/`, data: '', method: 'stored' },
    { name: `${uuid}/metadata.yaml`, data: `uuid: ${uuid}\ntype: Dummy\nformat: DummyFormat\n`, method: 'stored' },
    { name: `${uuid}/VERSION`, data: 'QIIME 2\narchive: 5\nframework: 2024.2.0\n', method: 'stored' },
    ...dataFiles.map((d) => ({ name: `${uuid}/data/${d.name}`, data: d.data, method: d.method || 'deflate', rawMethod: d.rawMethod })),
  ];
  return new File([buildZip(entries)], name);
}

