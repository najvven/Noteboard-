import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {importSpreadsheet,exportSpreadsheet,parseDelimited} from '../src/features/spreadsheet/exchange';
import {createWorkbookDocument,parseWorkbookDocument} from '../src/features/spreadsheet/workbook';
import {createBoardArchive,readBoardPackageFile} from '../src/features/board/board-package';
import JSZip from 'jszip';
import {assertZipExpansionWithinLimits} from '../shared/board-package-stream.js';

test('single-cell headings do not hide later CSV or TSV columns, and TSV filenames determine their delimiter',async()=>{
  for(const delimiter of [',',';','\t'])
    assert.deepEqual(parseDelimited(`Header\n1${delimiter}2\n`),[['Header'],['1','2']]);
  const imported=await importSpreadsheet(new TextEncoder().encode('A title, with punctuation\n1\t2\n').buffer,'Report.TSV');
  const cells=imported.document.workbook.sheets!['sheet-1'].cellData;
  assert.equal(cells[0][0].v,'A title, with punctuation');
  assert.equal(cells[1][0].v,1);assert.equal(cells[1][1].v,2);
});

test('CSV quoting, numeric data, formula cells and multiple lines are imported without evaluation as code',async()=>{
  assert.deepEqual(parseDelimited('Name;Value\r\n"a;b";"one\nline"\r\n"say ""hello""";3'),[['Name','Value'],['a;b','one\nline'],['say "hello"','3']]);
  assert.throws(()=>parseDelimited('a,"unfinished'),/unclosed/);
  assert.deepEqual(parseDelimited('"a;b;c\nlabel",Value\nName,7'),[['a;b;c\nlabel','Value'],['Name','7']]);
  const result=await importSpreadsheet(new TextEncoder().encode('Amount,Double\n7,=A2*2\n9,=A3*2').buffer,'Values.csv');
  const sheet=result.document.workbook.sheets!['sheet-1'];
  assert.equal(sheet.cellData[1][0].v,7);assert.equal(sheet.cellData[1][1].f,'=A2*2');
});

test('XLSX preserves formulas, values, basic cell formatting, merges and row/column sizes through a round trip',async()=>{
  const book=createWorkbookDocument('Budget',[[12,'=A1*2'],['Heading','']]);
  const sheet=book.workbook.sheets!['sheet-1'];
  sheet.cellData[0][0].s={bl:1,cl:{rgb:'#123456'},bg:{rgb:'#ffcc00'},n:{pattern:'0.00'}};
  sheet.cellData[0][1].v=24;sheet.mergeData=[{startRow:1,endRow:1,startColumn:0,endColumn:1}];
  sheet.rowData={0:{h:40,hd:1}};sheet.columnData={0:{w:145,hd:1}};
  const bytes=await exportSpreadsheet(book,'xlsx');
  const decoded=await importSpreadsheet(bytes.buffer as ArrayBuffer,'Budget.xlsx');
  const imported=decoded.document.workbook.sheets![decoded.document.activeSheetId!];
  assert.equal(imported.cellData[0][0].v,12);assert.equal(imported.cellData[0][1].f,'=A1*2');
  assert.equal((imported.cellData[0][0].s as any).bl,1);assert.equal((imported.cellData[0][0].s as any).cl.rgb,'#123456');
  assert.deepEqual(imported.mergeData,sheet.mergeData);assert.equal(imported.columnData[0].w,145);assert.equal(imported.rowData[0].h,40);assert.equal(imported.columnData[0].hd,1);assert.equal(imported.rowData[0].hd,1);
  assert.ok(parseWorkbookDocument(JSON.stringify(decoded.document)));
  const excel=new ExcelJS.Workbook();await excel.xlsx.load(bytes as any);
  assert.equal(excel.worksheets[0].getCell('B1').result,24);
});

test('XLSX preserves default dimensions separately from row and column overrides',async()=>{
  const book=createWorkbookDocument('Defaults',[[1]],{width:240,height:60});
  const bytes=await exportSpreadsheet(book,'xlsx');
  const excel=new ExcelJS.Workbook();await excel.xlsx.load(bytes as any);
  assert.equal(excel.worksheets[0].properties.defaultRowHeight,45);
  assert.ok(Math.abs(excel.worksheets[0].properties.defaultColWidth!-((240-5)/7))<1e-10);
  const imported=await importSpreadsheet(bytes.buffer as ArrayBuffer,'Defaults.xlsx');
  const sheet=imported.document.workbook.sheets![imported.document.activeSheetId!];
  assert.equal(sheet.defaultRowHeight,60);
  assert.equal(sheet.defaultColumnWidth,240);
  assert.equal(sheet.rowData?.[0]?.h,undefined);
  assert.equal(sheet.columnData?.[0]?.w,undefined);
});

test('CSV export uses the active sheet and keeps line breaks and quotes intact',async()=>{
  const book=createWorkbookDocument('Text',[['A,"B"','two\nlines'],[42,'']]);
  const bytes=await exportSpreadsheet(book,'csv');
  assert.deepEqual(parseDelimited(new TextDecoder().decode(bytes)),[['A,"B"','two\nlines'],['42','']]);
});

test('CSV preserves quoted empty final records without inventing a row after a final newline',()=>{
  assert.deepEqual(parseDelimited('""'),[['']]);
  assert.deepEqual(parseDelimited('Name\r\n""'),[['Name'],['']]);
  assert.deepEqual(parseDelimited('a,""'),[['a','']]);
  assert.deepEqual(parseDelimited('a,""\r\n'),[['a','']]);
  assert.deepEqual(parseDelimited('a\r\n'),[['a']]);
});

test('XLSX import preserves cached formula results and explicitly declared empty columns',async()=>{
  const source=new ExcelJS.Workbook(),worksheet=source.addWorksheet('Data');
  worksheet.getCell('A1').value={formula:'1+2',result:3};
  worksheet.getCell('B1').value={formula:'0',result:0};
  worksheet.getCell('C1').value={formula:'1=1',result:true};
  worksheet.getCell('D1').value={formula:'""',result:''};
  worksheet.getCell('E1').value={formula:'DATE(2020,1,1)',result:new Date('2020-01-01T00:00:00.000Z')};
  worksheet.getCell('F1').value={formula:'NA()',result:{error:'#N/A'}};
  worksheet.getColumn(40).width=25;worksheet.getColumn(40).hidden=true;
  const imported=await importSpreadsheet(await source.xlsx.writeBuffer() as ArrayBuffer,'Cached.xlsx');
  const sheet=imported.document.workbook.sheets![imported.document.activeSheetId!];
  assert.deepEqual([sheet.cellData[0][0].f,sheet.cellData[0][0].v,sheet.cellData[0][0].t],['=1+2',3,2]);
  assert.deepEqual([sheet.cellData[0][1].f,sheet.cellData[0][1].v,sheet.cellData[0][1].t],['=0',0,2]);
  assert.deepEqual([sheet.cellData[0][2].f,sheet.cellData[0][2].v,sheet.cellData[0][2].t],['=1=1',true,3]);
  assert.deepEqual([sheet.cellData[0][3].f,sheet.cellData[0][3].v,sheet.cellData[0][3].t],['=""','',1]);
  assert.deepEqual([sheet.cellData[0][4].f,sheet.cellData[0][4].t],['=DATE(2020,1,1)',2]);
  assert.deepEqual([sheet.cellData[0][5].f,sheet.cellData[0][5].v,sheet.cellData[0][5].t],['=NA()','#N/A',4]);
  assert.ok(Math.abs(sheet.columnData![39].w!-180)<1e-9);
  assert.equal(sheet.columnData![39].hd,1);
  const exported=await exportSpreadsheet(imported.document,'xlsx');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(exported as any);
  assert.equal(workbook.worksheets[0].getCell('A1').result,3);
  assert.equal(workbook.worksheets[0].getCell('B1').result,0);
  assert.equal(workbook.worksheets[0].getCell('C1').result,true);
  const exportedZip=await JSZip.loadAsync(exported);
  const exportedXml=await exportedZip.file('xl/worksheets/sheet1.xml')!.async('string');
  assert.match(exportedXml,/<c r="D1"[^>]*><f>&quot;&quot;<\/f><v><\/v><\/c>/);
});

test('XLSX rejects giant merged ranges before ExcelJS materializes their cells',async()=>{
  const source=new ExcelJS.Workbook(),worksheet=source.addWorksheet('Data');
  worksheet.getCell('A1').value='bounded';
  const zip=await JSZip.loadAsync(await source.xlsx.writeBuffer());
  const xml=await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  zip.file('xl/worksheets/sheet1.xml',xml.replace('</worksheet>','<mergeCells count="1"><mergeCell ref="A1:XFD1000"/></mergeCells></worksheet>'));
  const bytes=await zip.generateAsync({type:'arraybuffer'});
  await assert.rejects(()=>importSpreadsheet(bytes,'Merged.xlsx'),/merged ranges exceeding the 200,000 cell limit/);
});

test('CSV exports literal formula-like strings as text and exports cached formula values',async()=>{
  const workbook=createWorkbookDocument('Safe CSV',[]),sheet=workbook.workbook.sheets!['sheet-1'];
  sheet.cellData={0:{0:{v:'=1+1',t:1},1:{v:'  @SUM(A1)',t:1},2:{v:-12,t:2},3:{f:'=1+1',v:2,t:2},4:{f:'=UNKNOWN()',t:2}}};
  const text=new TextDecoder().decode(await exportSpreadsheet(workbook,'csv'));
  assert.equal(text,"'=1+1,'  @SUM(A1),-12,2,'=UNKNOWN()");
});

test('spreadsheet ZIP preflight measures actual inflated bytes when headers understate them',async()=>{
  const zip=new JSZip();zip.file('xl/worksheets/sheet1.xml','x'.repeat(256));
  const archive=await zip.generateAsync({type:'uint8array'});
  const forged=archive.slice(),view=new DataView(forged.buffer,forged.byteOffset,forged.byteLength),decoder=new TextDecoder();
  for(let offset=0;offset<=forged.length-46;offset++){
    const signature=view.getUint32(offset,true);
    if(signature===0x04034b50){const size=view.getUint16(offset+26,true),name=decoder.decode(forged.subarray(offset+30,offset+30+size));if(name==='xl/worksheets/sheet1.xml')view.setUint32(offset+22,1,true);}
    if(signature===0x02014b50){const size=view.getUint16(offset+28,true),name=decoder.decode(forged.subarray(offset+46,offset+46+size));if(name==='xl/worksheets/sheet1.xml')view.setUint32(offset+24,1,true);}
  }
  const loaded=await JSZip.loadAsync(forged);
  await assert.rejects(()=>assertZipExpansionWithinLimits(Object.values(loaded.files),{maxEntryBytes:128,maxArchiveBytes:128,archiveLabel:'Expanded workbook'}),/too large/);
});

test('a large valid spreadsheet survives portable board export and import',async()=>{
  const workbook=createWorkbookDocument('Large',Array.from({length:500},()=>Array.from({length:60},()=> 'x'.repeat(300))));
  const content=JSON.stringify(workbook);assert.ok(content.length>8*1024*1024);
  const page={id:'large-workbook',title:'Large workbook',width:1000,height:700,updatedAt:1,isPinned:false,elements:[{id:'sheet',type:'table' as const,position:{x:0,y:0},size:{width:700,height:400},content,zIndex:1}]};
  const bytes=await createBoardArchive(page),file=new File([bytes as BlobPart],'large_noteboard.zip',{type:'application/zip'});
  const imported=await readBoardPackageFile(file);assert.ok(!Array.isArray(imported));
  const restored=parseWorkbookDocument(imported.elements[0].content)!;
  assert.equal(restored.workbook.sheets!['sheet-1'].cellData[499][59].v,'x'.repeat(300));
});

test('tall CSV ranges stay within supported dimensions without exhausting the call stack',async()=>{
  const text='9\n'.repeat(130_000),bytes=new TextEncoder().encode(text);
  const result=await importSpreadsheet(bytes.buffer,'Tall.csv');
  assert.equal(result.document.workbook.sheets!['sheet-1'].cellData[129_999][0].v,9);
  const exported=await exportSpreadsheet(result.document,'csv');
  assert.equal(new TextDecoder().decode(exported).split('\r\n').length,130_000);
});
