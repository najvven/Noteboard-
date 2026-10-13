import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {importSpreadsheet,exportSpreadsheet,parseDelimited} from '../src/features/spreadsheet/exchange';
import {createWorkbookDocument,parseWorkbookDocument} from '../src/features/spreadsheet/workbook';
import {createBoardArchive,readBoardPackageFile} from '../src/features/board/board-package';

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
