import type { BoardElement, Position, Size } from '../../types';
import {createElementHierarchy,type ElementHierarchy} from './element-hierarchy';
import {selectedBounds} from './selection';
import {getTextScale,isScalableText} from './text-scaling';
import {removeElementTreeAndReferences} from './element-removal';

export const isMergedGroupMember=(element:BoardElement,hierarchy:ElementHierarchy)=>hierarchy.ancestors(element.id).slice(1).some(parent=>parent.type==='group');

export function mergeAreaElements(elements:BoardElement[],ids:readonly string[],id:string) {
  const members=new Set(ids),hierarchy=createElementHierarchy(elements);
  if(!members.size)return null;
  // Empty source layers move into the group. A layer that still contains
  // objects outside the area stays in its original place.
  const childrenByParent=new Map<string,BoardElement[]>();
  for(const element of elements)if(element.parentId){const children=childrenByParent.get(element.parentId)??[];children.push(element);childrenByParent.set(element.parentId,children);}
  const remaining=new Map<string,number>(),pending:BoardElement[]=[];
  for(const layer of elements)if(layer.type==='layer'&&!members.has(layer.id)){
    const children=childrenByParent.get(layer.id)??[];
    const count=children.filter(child=>!members.has(child.id)).length;remaining.set(layer.id,count);
    if(children.length&&count===0)pending.push(layer);
  }
  while(pending.length){
    const layer=pending.pop()!;if(members.has(layer.id))continue;members.add(layer.id);
    if(layer.parentId&&remaining.has(layer.parentId)){
      const count=remaining.get(layer.parentId)!-1;remaining.set(layer.parentId,count);
      if(count===0)pending.push(hierarchy.byId.get(layer.parentId)!);
    }
  }
  const visual=elements.filter(element=>members.has(element.id)&&element.type!=='layer');
  const bounds=selectedBounds(visual,visual.map(element=>element.id));
  if(!bounds)return null;
  const common=hierarchy.ancestors(visual[0].id).slice(1).find(parent=>!members.has(parent.id)&&visual.every(element=>hierarchy.isDescendantOf(element.id,parent.id)));
  const group:BoardElement={id,type:'group',name:'Merged area',content:'',position:{x:bounds.x,y:bounds.y},size:{width:Math.max(1,bounds.width),height:Math.max(1,bounds.height)},zIndex:Math.max(...visual.map(element=>hierarchy.stackPath(element.id)[0]))+.5,parentId:common?.id,keepRatio:true};
  const next=elements.map(element=>members.has(element.id)&&(!element.parentId||!members.has(element.parentId))
    ? {...element,parentId:id,groupOriginalParentId:element.parentId} : element);
  return {elements:[...next,group],group};
}

const center=(element:BoardElement)=>({x:element.position.x+(element.size?.width??0)/2,y:element.position.y+(element.size?.height??0)/2});
const rotate=(point:Position,degrees:number)=>{
  const radians=degrees*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  return {x:point.x*c-point.y*s,y:point.x*s+point.y*c};
};

/** Inverse group transform, also used by the read-only group renderer. */
export function localGroupElement(element:BoardElement,group:BoardElement):BoardElement {
  const origin=center(group),child=center(element);
  const point=rotate({x:child.x-origin.x,y:child.y-origin.y},-(group.rotation??0));
  const local={x:point.x*(group.flipX?-1:1)+(group.size?.width??0)/2,y:point.y*(group.flipY?-1:1)+(group.size?.height??0)/2};
  return {...element,position:{x:local.x-(element.size?.width??0)/2,y:local.y-(element.size?.height??0)/2},
    rotation:((element.rotation??0)-(group.rotation??0))*(group.flipX!==group.flipY?-1:1),
    flipX:Boolean(element.flipX)!==Boolean(group.flipX),flipY:Boolean(element.flipY)!==Boolean(group.flipY)};
}

export function updateMergedGroup(elements:BoardElement[],id:string,updates:Partial<BoardElement>) {
  const previous=elements.find(element=>element.id===id);
  if(!previous||previous.type!=='group'||!previous.size)return elements.map(element=>element.id===id?{...element,...updates}:element);
  const next={...previous,...updates},hierarchy=createElementHierarchy(elements);
  if(!updates.position&&!updates.size&&updates.rotation===undefined&&updates.flipX===undefined&&updates.flipY===undefined)return elements.map(element=>element.id===id?next:element);
  const sx=(next.size?.width??previous.size.width)/previous.size.width,sy=(next.size?.height??previous.size.height)/previous.size.height;
  const origin=center(next);
  return elements.map(element=>{
    if(element.id===id)return next;
    if(!hierarchy.isDescendantOf(element.id,id))return element;
    const local=localGroupElement(element,previous),localCenter=center(local);
    const point=rotate({x:(localCenter.x-(previous.size!.width/2))*sx*(next.flipX?-1:1),y:(localCenter.y-(previous.size!.height/2))*sy*(next.flipY?-1:1)},next.rotation??0);
    const size:Size|undefined=element.size?{width:element.size.width*sx,height:element.size.height*sy}:undefined;
    return {...element,size,position:{x:origin.x+point.x-(size?.width??0)/2,y:origin.y+point.y-(size?.height??0)/2},
      rotation:(next.rotation??0)+(local.rotation??0)*(next.flipX!==next.flipY?-1:1),
      flipX:Boolean(local.flipX)!==Boolean(next.flipX),flipY:Boolean(local.flipY)!==Boolean(next.flipY),
      ...(sx!==1&&element.borderWidth!==undefined?{borderWidth:element.borderWidth*sx}:{}),
      ...(sx!==1&&element.points?{points:element.points.map(point=>({x:point.x*sx,y:point.y*sy}))}:{}),
      ...(sx!==1&&isScalableText(element.type)?{textScale:getTextScale(element)*sx}:{}),
    };
  });
}

export function ungroupAreaElements(elements:BoardElement[],id:string) {
  const group=elements.find(element=>element.id===id);
  if(group?.type!=='group')return {elements,selectedIds:[]};
  const available=new Set(elements.filter(element=>element.id!==id).map(element=>element.id));
  const hierarchy=createElementHierarchy(elements);
  const next=elements.filter(element=>element.id!==id).map(element=>{
    if(!hierarchy.isDescendantOf(element.id,id))return element;
    const ancestorGroups=hierarchy.ancestors(element.id).slice(1).filter(parent=>parent.type==='group');
    const applyOpacity=ancestorGroups[0]?.id===id;
    return {...element,
      ...(element.parentId===id?{parentId:element.groupOriginalParentId&&available.has(element.groupOriginalParentId)?element.groupOriginalParentId:group.parentId,groupOriginalParentId:undefined}:{}),
      ...(applyOpacity&&group.opacity!==undefined?{opacity:(element.opacity??100)*group.opacity/100}:{}),
    };
  });
  const elementsWithoutGroup = removeElementTreeAndReferences([...next, group], id).elements;
  return {elements:elementsWithoutGroup,selectedIds:elements.filter(element=>element.type!=='layer'&&hierarchy.isDescendantOf(element.id,id)&&hierarchy.ancestors(element.id).slice(1).find(parent=>parent.type==='group')?.id===id).map(element=>element.id)};
}
