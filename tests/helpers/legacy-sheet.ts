import type {BoardElement,SectionSheet} from '../../src/types';

/** Saved pre-workbook format, retained only to test the one-way importer. */
export function createLegacySheet({rows,columns,createId}:{rows:number;columns:number;createId:()=>string;[key:string]:unknown}){
  const id=createId(),rowOrder=Array.from({length:rows},createId),columnOrder=Array.from({length:columns},createId);
  const elements:BoardElement[]=[],cellIds=rowOrder.map((rowId,r)=>columnOrder.map((columnId,c)=>{
    const cellId=createId();elements.push({id:cellId,type:'section',position:{x:c*120,y:r*40},size:{width:120,height:40},content:'',zIndex:r*columns+c,sheetCell:{sheetId:id,rowId,columnId,address:`${String.fromCharCode(65+c)}${r+1}`}});return cellId;
  }));
  const sheet:SectionSheet={id,version:1,name:'Legacy sheet',rowOrder,columnOrder,rows:Object.fromEntries(rowOrder.map(id=>[id,{id,height:40}])),columns:Object.fromEntries(columnOrder.map(id=>[id,{id,width:120}])),cellIds,headerRows:1,headerColumns:0,showHeaders:true,shortcuts:{} as any,automations:[],createdAt:1,updatedAt:1};
  return {elements,sheet};
}
