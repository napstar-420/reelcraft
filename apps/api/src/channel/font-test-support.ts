/** A minimal TrueType file: the table directory and a `name` table, nothing else. */
export function sfnt(
  names: Array<{ platform: number; id: number; text: string }>,
  signature = 0x00010000,
) {
  const encoded = names.map((n) =>
    n.platform === 1 ? Buffer.from(n.text, 'latin1') : Buffer.from(n.text, 'utf16le').swap16(),
  );
  const records = 6 + names.length * 12;
  const name = Buffer.alloc(records + encoded.reduce((t, b) => t + b.length, 0));
  name.writeUInt16BE(0, 0);
  name.writeUInt16BE(names.length, 2);
  name.writeUInt16BE(records, 4);
  let offset = 0;
  names.forEach((n, i) => {
    const r = 6 + i * 12;
    name.writeUInt16BE(n.platform, r);
    name.writeUInt16BE(n.platform === 3 ? 1 : 0, r + 2);
    name.writeUInt16BE(n.platform === 3 ? 0x409 : 0, r + 4);
    name.writeUInt16BE(n.id, r + 6);
    name.writeUInt16BE(encoded[i]!.length, r + 8);
    name.writeUInt16BE(offset, r + 10);
    encoded[i]!.copy(name, records + offset);
    offset += encoded[i]!.length;
  });
  const header = Buffer.alloc(12 + 16);
  header.writeUInt32BE(signature, 0);
  header.writeUInt16BE(1, 4);
  header.write('name', 12, 'latin1');
  header.writeUInt32BE(header.length, 12 + 8);
  header.writeUInt32BE(name.length, 12 + 12);
  return Buffer.concat([header, name]);
}
