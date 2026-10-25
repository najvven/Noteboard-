import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {importSpreadsheet,exportSpreadsheet,parseDelimited} from '../src/features/spreadsheet/exchange';
import {createWorkbookDocument,parseWorkbookDocument} from '../src/features/spreadsheet/workbook';
import {gridObjectSize} from '../src/features/spreadsheet/grid-geometry';
import {createBoardArchive,readBoardPackageFile} from '../src/features/board/board-package';
import JSZip from 'jszip';
import {assertZipExpansionWithinLimits} from '../shared/board-package-stream.js';

const columnLetters=(column:number)=>{
  let result='';
  while(column>0){column-=1;result=String.fromCharCode(65+column%26)+result;column=Math.floor(column/26);}
  return result;
};

async function emptyCellRecordXlsx(cellsPerSheet:number[]){
  const workbook=new ExcelJS.Workbook();
  for(let index=0;index<cellsPerSheet.length;index++){
    const sheet=workbook.addWorksheet(`Budget ${index+1}`);
    sheet.getCell('A1').value='fixture';
  }
  const zip=await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  for(let sheetIndex=0;sheetIndex<cellsPerSheet.length;sheetIndex++){
    let remaining=cellsPerSheet[sheetIndex],row=1;
    const rows:string[]=[];
    while(remaining>0){
      const columns=Math.min(16_384,remaining);
      const cells=Array.from({length:columns},(_,index)=>`<c r="${columnLetters(index+1)}${row}"/>`).join('');
      rows.push(`<row r="${row}">${cells}</row>`);
      remaining-=columns;row+=1;
    }
    const path=`xl/worksheets/sheet${sheetIndex+1}.xml`,xml=await zip.file(path)!.async('string');
    const updated=xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/,`<sheetData>${rows.join('')}</sheetData>`);
    assert.notEqual(updated,xml,`${path} should receive the synthetic bounded cell records`);
    zip.file(path,updated);
  }
  return zip.generateAsync({type:'arraybuffer'});
}

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
  assert.equal(sheet.columnCount,40);assert.equal(sheet.cellData[0][39],undefined);
  assert.ok(Math.abs(sheet.columnData![39].w!-180)<1e-9);
  assert.equal(sheet.columnData![39].hd,1);
  assert.ok(parseWorkbookDocument(JSON.stringify(imported.document)));
  const exported=await exportSpreadsheet(imported.document,'xlsx');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(exported as any);
  assert.equal(workbook.worksheets[0].getCell('A1').result,3);
  assert.equal(workbook.worksheets[0].getCell('B1').result,0);
  assert.equal(workbook.worksheets[0].getCell('C1').result,true);
  const exportedZip=await JSZip.loadAsync(exported);
  const exportedXml=await exportedZip.file('xl/worksheets/sheet1.xml')!.async('string');
  assert.match(exportedXml,/<c r="D1"[^>]*><f>&quot;&quot;<\/f><v><\/v><\/c>/);
});

test('XLSX import includes defined empty columns when sizing an otherwise empty worksheet',async()=>{
  const source=new ExcelJS.Workbook(),worksheet=source.addWorksheet('Empty');
  worksheet.getColumn(35).width=18;
  const imported=await importSpreadsheet(await source.xlsx.writeBuffer() as ArrayBuffer,'Empty.xlsx');
  const sheet=imported.document.workbook.sheets![imported.document.activeSheetId!];
  assert.deepEqual(sheet.cellData,{});
  assert.equal(sheet.columnCount,35);
  assert.equal(sheet.columnData![34].w,131);
  assert.ok(parseWorkbookDocument(JSON.stringify(imported.document)));
});

test('XLSX import accepts a declared XFD column at the worksheet limit',async()=>{
  const source=new ExcelJS.Workbook(),worksheet=source.addWorksheet('XFD');
  worksheet.getColumn(16_384).width=12;
  const imported=await importSpreadsheet(await source.xlsx.writeBuffer() as ArrayBuffer,'XFD.xlsx');
  const sheet=imported.document.workbook.sheets![imported.document.activeSheetId!];
  assert.equal(sheet.columnCount,16_384);
  assert.equal(sheet.columnData![16_383].w,89);
  assert.ok(parseWorkbookDocument(JSON.stringify(imported.document)));
  const roundTrip=await importSpreadsheet((await exportSpreadsheet(imported.document,'xlsx')).buffer as ArrayBuffer,'XFD-roundtrip.xlsx');
  const restored=roundTrip.document.workbook.sheets![roundTrip.document.activeSheetId!];
  assert.equal(restored.columnCount,16_384);
  assert.equal(restored.columnData![16_383].w,89);
});

test('XLSX wide default and hidden-tail column spans do not expand simple or advanced geometry',async()=>{
  const scenarios=[
    {name:'default span',column:'<col min="1" max="16384" width="8.43" customWidth="1"/>',hiddenTail:false},
    {name:'hidden tail',column:'<col min="6" max="16384" width="8.43" hidden="1" customWidth="1"/>',hiddenTail:true},
  ];
  for(const scenario of scenarios){
    const source=new ExcelJS.Workbook(),worksheet=source.addWorksheet(scenario.name);
    worksheet.properties.defaultColWidth=8.43;
    for(let column=1;column<=5;column++)worksheet.getCell(1,column).value=column;
    const zip=await JSZip.loadAsync(await source.xlsx.writeBuffer());
    const path='xl/worksheets/sheet1.xml',xml=await zip.file(path)!.async('string');
    const withColumns=xml.replace('<sheetData>',`<cols>${scenario.column}</cols><sheetData>`);
    assert.notEqual(withColumns,xml,`${scenario.name} should inject a full-width span`);
    zip.file(path,withColumns);
    const imported=await importSpreadsheet(await zip.generateAsync({type:'arraybuffer'}),`${scenario.name}.xlsx`);
    const sheet=imported.document.workbook.sheets![imported.document.activeSheetId!];
    assert.equal(sheet.columnCount,26);
    assert.deepEqual([0,1,2,3,4].map(column=>sheet.cellData[0][column].v),[1,2,3,4,5]);
    const advancedWidth=gridObjectSize(imported.document).width;
    const simpleWidth=gridObjectSize({...imported.document,mode:'simple'}).width;
    assert.equal(simpleWidth,advancedWidth);
    assert.ok(advancedWidth<5000,`${scenario.name} must not create XFD-sized board geometry`);
    if(scenario.hiddenTail){
      assert.equal(sheet.columnData![5].hd,1);
      assert.equal(Object.keys(sheet.columnData!).length,21);
    }else assert.equal(Object.keys(sheet.columnData ?? {}).length,0);
    const roundTrip=await importSpreadsheet((await exportSpreadsheet(imported.document,'xlsx')).buffer as ArrayBuffer,`${scenario.name}-roundtrip.xlsx`);
    const roundTripSheet=roundTrip.document.workbook.sheets![roundTrip.document.activeSheetId!];
    assert.equal(roundTripSheet.columnCount,26);
    assert.ok(Math.abs(roundTripSheet.defaultColumnWidth!-sheet.defaultColumnWidth!)<1e-9);
    assert.deepEqual([0,1,2,3,4].map(column=>roundTripSheet.cellData[0][column].v),[1,2,3,4,5]);
    if(scenario.hiddenTail)assert.equal(Object.keys(roundTripSheet.columnData!).length,21);
    else assert.equal(Object.keys(roundTripSheet.columnData ?? {}).length,0);
  }
});

test('XLSX import retains a real sparse cell at XFD',async()=>{
  const source=new ExcelJS.Workbook(),worksheet=source.addWorksheet('Sparse XFD');
  worksheet.getCell('XFD1').value='far cell';
  const imported=await importSpreadsheet(await source.xlsx.writeBuffer() as ArrayBuffer,'Sparse-XFD.xlsx');
  const sheet=imported.document.workbook.sheets![imported.document.activeSheetId!];
  assert.equal(sheet.columnCount,16_384);
  assert.equal(sheet.cellData[0][16_383].v,'far cell');
  assert.ok(parseWorkbookDocument(JSON.stringify(imported.document)));
  const roundTrip=await importSpreadsheet((await exportSpreadsheet(imported.document,'xlsx')).buffer as ArrayBuffer,'Sparse-XFD-roundtrip.xlsx');
  const restored=roundTrip.document.workbook.sheets![roundTrip.document.activeSheetId!];
  assert.equal(restored.columnCount,16_384);
  assert.equal(restored.cellData[0][16_383].v,'far cell');
});

test('XLSX import counts a valid two-cell merge ending at XFD',async()=>{
  const source=new ExcelJS.Workbook(),worksheet=source.addWorksheet('XFD merge');
  worksheet.mergeCells('XFC1:XFD1');
  const imported=await importSpreadsheet(await source.xlsx.writeBuffer() as ArrayBuffer,'XFD-merge.xlsx');
  const sheet=imported.document.workbook.sheets![imported.document.activeSheetId!];
  assert.equal(sheet.columnCount,16_384);
  assert.deepEqual(sheet.mergeData,[{startRow:0,endRow:0,startColumn:16_382,endColumn:16_383}]);
  assert.ok(parseWorkbookDocument(JSON.stringify(imported.document)));
});

test('XLSX rejects an out-of-range XFE column declaration before ExcelJS loads the workbook',async()=>{
  const source=new ExcelJS.Workbook(),worksheet=source.addWorksheet('XFE');
  worksheet.getColumn(1).width=10;
  const zip=await JSZip.loadAsync(await source.xlsx.writeBuffer());
  const path='xl/worksheets/sheet1.xml',xml=await zip.file(path)!.async('string');
  const invalidXml=xml.replace(/<col\b[^>]*\/>/,'<col min="16385" max="16385" width="10" customWidth="1"/>');
  assert.notEqual(invalidXml,xml,'the fixture must replace the valid column definition');
  zip.file(path,invalidXml);
  const bytes=await zip.generateAsync({type:'arraybuffer'});
  const xlsxPrototype=Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as any;
  const originalLoad=xlsxPrototype.load;
  let loadCalls=0;
  xlsxPrototype.load=function(){loadCalls+=1;throw Error('ExcelJS test load reached');};
  try{
    await assert.rejects(()=>importSpreadsheet(bytes,'XFE.xlsx'),/invalid column definitions/);
    assert.equal(loadCalls,0,'invalid column declarations must fail before ExcelJS materializes a workbook');
  }finally{
    xlsxPrototype.load=originalLoad;
  }
});

test('XLSX rejects more than 256 worksheet parts before ExcelJS loads the workbook',async()=>{
  const source=new ExcelJS.Workbook();
  for(let index=0;index<257;index++)source.addWorksheet(`Sheet ${index+1}`);
  const bytes=await source.xlsx.writeBuffer() as ArrayBuffer;
  const xlsxPrototype=Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as any;
  const originalLoad=xlsxPrototype.load;
  let loadCalls=0;
  xlsxPrototype.load=function(this:any,...args:any[]){loadCalls+=1;return originalLoad.apply(this,args);};
  try{
    await assert.rejects(()=>importSpreadsheet(bytes,'Too many sheets.xlsx'),/up to 256 sheets/);
    assert.equal(loadCalls,0,'worksheet resource limits must be enforced before ExcelJS loads the workbook');
  }finally{
    xlsxPrototype.load=originalLoad;
  }
});

test('XLSX XML preflight accepts namespace-prefixed tags and rejects malformed tags before ExcelJS',async()=>{
  const source=new ExcelJS.Workbook(),worksheet=source.addWorksheet('XML scan');
  worksheet.getCell('A1').value='fixture';worksheet.getColumn(4).width=18;
  const zip=await JSZip.loadAsync(await source.xlsx.writeBuffer());
  const path='xl/worksheets/sheet1.xml',xml=await zip.file(path)!.async('string');
  const prefixXml=xml.replace(/<(\/)?([A-Za-z_][\w.-]*)(?=[\s/>])/g,'<$1x:$2')
    .replace('<x:worksheet ','<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ');
  zip.file(path,prefixXml);
  const namespaced=await zip.generateAsync({type:'arraybuffer'});
  const xlsxPrototype=Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as any;
  const originalLoad=xlsxPrototype.load;
  let loadCalls=0;
  xlsxPrototype.load=function(){loadCalls+=1;throw Error('ExcelJS test load reached');};
  try{
    await assert.rejects(()=>importSpreadsheet(namespaced,'Namespaced.xlsx'),/ExcelJS test load reached/);
    assert.equal(loadCalls,1,'namespace-prefixed worksheet tags should pass preflight');
  }finally{
    xlsxPrototype.load=originalLoad;
  }

  const malformedRewrites=[
    (base:string)=>base.replace(/<c\b[^>]*>/,`<c${' '.repeat(100_000)}`),
    (base:string)=>base.replace('<sheetData>',`<cols>${'<col '.repeat(2_000)}</cols><sheetData>`),
  ];
  for(const rewrite of malformedRewrites){
    const malformedZip=await JSZip.loadAsync(await source.xlsx.writeBuffer());
    const base=await malformedZip.file(path)!.async('string');
    const candidate=rewrite(base);
    assert.notEqual(candidate,base,'malformed XML fixture must alter the worksheet part');
    malformedZip.file(path,candidate);
    const malformed=await malformedZip.generateAsync({type:'arraybuffer'});
    const prototype=Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as any;
    const load=prototype.load;let calls=0;
    prototype.load=function(this:any,...args:any[]){calls+=1;return load.apply(this,args);};
    try{
      await assert.rejects(()=>importSpreadsheet(malformed,'Malformed.xlsx'),/malformed XML/);
      assert.equal(calls,0,'malformed tag streams must be rejected before ExcelJS loads');
    }finally{
      prototype.load=load;
    }
  }
});

test('XLSX rejects sparse out-of-range cell and row references before ExcelJS loads the workbook',async()=>{
  const invalidReferences=[
    {
      name:'XFE cell column',
      pattern:/invalid cell reference/,
      rewrite:(xml:string)=>xml.replace(/(<c\b[^>]*\br=")A1("[^>]*>)/,(_match,start,end)=>`${start}XFE1${end}`),
    },
    {
      name:'worksheet row index',
      pattern:/invalid row reference/,
      rewrite:(xml:string)=>xml.replace(/(<row\b[^>]*\br=")\d+("[^>]*>)/,(_match,start,end)=>`${start}1048577${end}`),
    },
    {
      name:'cell row index',
      pattern:/invalid cell reference/,
      rewrite:(xml:string)=>xml.replace(/(<c\b[^>]*\br=")A1("[^>]*>)/,(_match,start,end)=>`${start}A1048577${end}`),
    },
    {
      name:'implicit first cell without row number',
      pattern:/without a reference or row number/,
      rewrite:(xml:string)=>xml
        .replace(/(<row\b[^>]*?)\s+r="1"/,'$1')
        .replace(/(<c\b[^>]*?)\s+r="A1"/,'$1'),
    },
    {
      name:'duplicate worksheet row',
      pattern:/duplicate worksheet row references/,
      rewrite:(xml:string)=>{
        const row=xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/)?.[0];
        return row?xml.replace('</sheetData>',`${row}</sheetData>`):xml;
      },
    },
  ];
  for(const scenario of invalidReferences){
    const source=new ExcelJS.Workbook(),worksheet=source.addWorksheet('Sparse');
    worksheet.getCell('A1').value='fixture';
    const zip=await JSZip.loadAsync(await source.xlsx.writeBuffer());
    const path='xl/worksheets/sheet1.xml',xml=await zip.file(path)!.async('string');
    const invalidXml=scenario.rewrite(xml);
    assert.notEqual(invalidXml,xml,`${scenario.name} fixture must change the worksheet XML`);
    zip.file(path,invalidXml);
    const bytes=await zip.generateAsync({type:'arraybuffer'});
    const xlsxPrototype=Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as any;
    const originalLoad=xlsxPrototype.load;
    let loadCalls=0;
    xlsxPrototype.load=function(this:any,...args:any[]){loadCalls+=1;return originalLoad.apply(this,args);};
    try{
      await assert.rejects(()=>importSpreadsheet(bytes,`${scenario.name}.xlsx`),scenario.pattern);
      assert.equal(loadCalls,0,`${scenario.name} must be rejected before ExcelJS loads the workbook`);
    }finally{
      xlsxPrototype.load=originalLoad;
    }
  }
});

test('XLSX rejects row-mismatched and duplicate cell addresses before ExcelJS loads the workbook',async()=>{
  const scenarios=[
    {
      name:'row mismatch',
      expected:/does not match its worksheet row/,
      rewrite:(xml:string)=>xml.replace(/(<c\b[^>]*\br=")B1("[^>]*>)/,(_match,start,end)=>`${start}A2${end}`),
    },
    {
      name:'duplicate cell',
      expected:/duplicate cell references/,
      rewrite:(xml:string)=>xml.replace(/(<c\b[^>]*\br=")B1("[^>]*>)/,(_match,start,end)=>`${start}A1${end}`),
    },
  ];
  for(const scenario of scenarios){
    const source=new ExcelJS.Workbook(),worksheet=source.addWorksheet('Cells');
    worksheet.getCell('A1').value='first';worksheet.getCell('B1').value='second';
    const zip=await JSZip.loadAsync(await source.xlsx.writeBuffer());
    const path='xl/worksheets/sheet1.xml',xml=await zip.file(path)!.async('string');
    const invalidXml=scenario.rewrite(xml);
    assert.notEqual(invalidXml,xml,`${scenario.name} fixture must change the cell address`);
    zip.file(path,invalidXml);
    const bytes=await zip.generateAsync({type:'arraybuffer'});
    const xlsxPrototype=Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as any;
    const originalLoad=xlsxPrototype.load;
    let loadCalls=0;
    xlsxPrototype.load=function(this:any,...args:any[]){loadCalls+=1;return originalLoad.apply(this,args);};
    try{
      await assert.rejects(()=>importSpreadsheet(bytes,`${scenario.name}.xlsx`),scenario.expected);
      assert.equal(loadCalls,0,`${scenario.name} must be rejected before ExcelJS loads the workbook`);
    }finally{
      xlsxPrototype.load=originalLoad;
    }
  }
});

test('XLSX import infers a missing cell r attribute from the preceding cell',async()=>{
  const source=new ExcelJS.Workbook(),worksheet=source.addWorksheet('Cells without r');
  worksheet.getCell('A1').value='first';worksheet.getCell('B1').value='second';
  const zip=await JSZip.loadAsync(await source.xlsx.writeBuffer());
  const path='xl/worksheets/sheet1.xml',xml=await zip.file(path)!.async('string');
  const withoutSecondAddress=xml.replace(/(<c\b[^>]*?)\s+r="B1"/,'$1');
  assert.notEqual(withoutSecondAddress,xml,'the second cell reference must be omitted');
  zip.file(path,withoutSecondAddress);
  const imported=await importSpreadsheet(await zip.generateAsync({type:'arraybuffer'}),'Cells-without-r.xlsx');
  const sheet=imported.document.workbook.sheets![imported.document.activeSheetId!];
  assert.equal(sheet.cellData[0][0].v,'first');
  assert.equal(sheet.cellData[0][1].v,'second');
  assert.ok(parseWorkbookDocument(JSON.stringify(imported.document)));
});

test('XLSX infers an implicit first cell as column A from its explicit row without mutating input bytes',async()=>{
  const source=new ExcelJS.Workbook(),worksheet=source.addWorksheet('Implicit A');
  worksheet.getCell('A7').value='implicit first';
  worksheet.getCell('C7').value='explicit C';
  worksheet.getCell('D7').value='implicit next';
  const zip=await JSZip.loadAsync(await source.xlsx.writeBuffer());
  const path='xl/worksheets/sheet1.xml',xml=await zip.file(path)!.async('string');
  const implicitFirst=xml.replace(/(<c\b[^>]*?)\s+r="A7"/,'$1');
  const implicitNext=implicitFirst.replace(/(<c\b[^>]*?)\s+r="D7"/,'$1');
  assert.notEqual(implicitNext,xml,'the first and later cell references must be omitted');
  zip.file(path,implicitNext);
  const input=await zip.generateAsync({type:'uint8array'}),original=input.slice();
  const imported=await importSpreadsheet(input.buffer as ArrayBuffer,'Implicit-A.xlsx');
  const sheet=imported.document.workbook.sheets![imported.document.activeSheetId!];
  assert.equal(sheet.cellData[6][0].v,'implicit first');
  assert.equal(sheet.cellData[6][2].v,'explicit C');
  assert.equal(sheet.cellData[6][3].v,'implicit next');
  assert.ok(parseWorkbookDocument(JSON.stringify(imported.document)));
  assert.deepEqual(input,original,'normalization for ExcelJS must not mutate the user-provided archive bytes');
});

test('XLSX normalizes a missing row r from an explicit first cell address',async()=>{
  const source=new ExcelJS.Workbook(),worksheet=source.addWorksheet('Implicit row');
  worksheet.getCell('C7').value='explicit C7';
  const zip=await JSZip.loadAsync(await source.xlsx.writeBuffer());
  const path='xl/worksheets/sheet1.xml',xml=await zip.file(path)!.async('string');
  const withoutRowRef=xml.replace(/(<row\b[^>]*?)\s+r="7"/,'$1');
  assert.notEqual(withoutRowRef,xml,'the row r attribute must be removed');
  zip.file(path,withoutRowRef);
  const imported=await importSpreadsheet(await zip.generateAsync({type:'arraybuffer'}),'Implicit-row.xlsx');
  const sheet=imported.document.workbook.sheets![imported.document.activeSheetId!];
  assert.equal(sheet.cellData[6][2].v,'explicit C7');
  assert.ok(parseWorkbookDocument(JSON.stringify(imported.document)));
});

test('XLSX rejects more than 200,000 worksheet row records across sheets before ExcelJS loads',async()=>{
  const source=new ExcelJS.Workbook();
  source.addWorksheet('First').getCell('A1').value='fixture';
  source.addWorksheet('Second').getCell('A1').value='fixture';
  const zip=await JSZip.loadAsync(await source.xlsx.writeBuffer());
  const rowXml=Array.from({length:100_001},(_,index)=>`<row r="${index+1}"/>`).join('');
  for(const path of ['xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml']){
    const xml=await zip.file(path)!.async('string');
    const overBudgetXml=xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/,`<sheetData>${rowXml}</sheetData>`);
    assert.notEqual(overBudgetXml,xml,`${path} must contain the generated empty rows`);
    zip.file(path,overBudgetXml);
  }
  const bytes=await zip.generateAsync({type:'arraybuffer'});
  const xlsxPrototype=Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as any;
  const originalLoad=xlsxPrototype.load;
  let loadCalls=0;
  xlsxPrototype.load=function(){loadCalls+=1;throw Error('ExcelJS test load reached');};
  try{
    await assert.rejects(()=>importSpreadsheet(bytes,'Row budget.xlsx'),/more than 200,000 row records/);
    assert.equal(loadCalls,0,'the workbook-wide row budget must be checked before ExcelJS loads rows');
  }finally{
    xlsxPrototype.load=originalLoad;
  }
});

test('XLSX cell-record preflight allows exactly 200,000 but rejects a multi-sheet excess before ExcelJS loads',async()=>{
  const xlsxPrototype=Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as any;
  const originalLoad=xlsxPrototype.load;
  let loadCalls=0;
  xlsxPrototype.load=function(){loadCalls+=1;throw Error('ExcelJS test load reached');};
  try{
    const exact=await emptyCellRecordXlsx([200_000]);
    await assert.rejects(()=>importSpreadsheet(exact,'Exactly-200000.xlsx'),/ExcelJS test load reached/);
    assert.equal(loadCalls,1,'exactly 200,000 cells is within the preflight contract');
  }finally{
    xlsxPrototype.load=originalLoad;
  }

  const over=await emptyCellRecordXlsx([100_001,100_001]);
  const xlsxWithSpy=Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as any;
  const originalLoadForOver=xlsxWithSpy.load;
  let overLoadCalls=0;
  xlsxWithSpy.load=function(this:any,...args:any[]){overLoadCalls+=1;return originalLoadForOver.apply(this,args);};
  try{
    await assert.rejects(()=>importSpreadsheet(over,'Over-200000.xlsx'),/more than 200,000 cells/);
    assert.equal(overLoadCalls,0,'a workbook-wide cell excess must fail before ExcelJS materializes it');
  }finally{
    xlsxWithSpy.load=originalLoadForOver;
  }
});

test('XLSX import accepts one populated cell at the maximum supported row',async()=>{
  const source=new ExcelJS.Workbook(),worksheet=source.addWorksheet('Last row');
  worksheet.getCell('A1048576').value=42;
  const imported=await importSpreadsheet(await source.xlsx.writeBuffer() as ArrayBuffer,'Last-row.xlsx');
  const sheet=imported.document.workbook.sheets![imported.document.activeSheetId!];
  assert.equal(sheet.rowCount,1_048_576);
  assert.equal(sheet.cellData[1_048_575][0].v,42);
  assert.ok(parseWorkbookDocument(JSON.stringify(imported.document)));
});

test('XLSX export retains the width of a defined column with no cells',async()=>{
  const document=createWorkbookDocument('Defined width');
  const sheet=document.workbook.sheets!['sheet-1'];
  sheet.columnCount=40;sheet.columnData={39:{w:180}};
  const bytes=await exportSpreadsheet(document,'xlsx');
  const excel=new ExcelJS.Workbook();await excel.xlsx.load(bytes as any);
  assert.equal(excel.worksheets[0].getColumn(40).width,25);
  const imported=await importSpreadsheet(bytes.buffer as ArrayBuffer,'Defined.xlsx');
  const importedSheet=imported.document.workbook.sheets![imported.document.activeSheetId!];
  assert.equal(importedSheet.columnCount,40);
  assert.equal(importedSheet.columnData![39].w,180);
  assert.ok(parseWorkbookDocument(JSON.stringify(imported.document)));
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
