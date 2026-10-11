import { readdir, readFile, writeFile } from 'node:fs/promises';
// Portable ZIP using uncompressed entries. No dependency or executable required.
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc=data=>{let n=0xffffffff;for(const byte of data)n=crcTable[(n^byte)&255]^(n>>>8);return(n^0xffffffff)>>>0;};
const local=[],central=[];let offset=0;
for(const file of (await readdir('qollab')).filter(f=>/\.(py|json|txt|md)$/.test(f)).sort()){
  const name=Buffer.from('QSwipe-qollab/'+file),data=await readFile('qollab/'+file),checksum=crc(data);
  const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50,0);head.writeUInt16LE(20,4);head.writeUInt16LE(33,12);head.writeUInt32LE(checksum,14);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(name.length,26);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(33,14);entry.writeUInt32LE(checksum,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);
  local.push(head,name,data);central.push(entry,name);offset+=head.length+name.length+data.length;
}
const index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
await writeFile('dist/qswipe-qollab.zip',Buffer.concat([...local,index,end]));
