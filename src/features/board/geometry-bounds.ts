import type { Position } from '../../types';

/** Bounds must not depend on the JavaScript engine's function-argument limit. */
export function pointExtrema(points: readonly Position[]) {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const point of points) {
    minX=Math.min(minX,point.x); minY=Math.min(minY,point.y);
    maxX=Math.max(maxX,point.x); maxY=Math.max(maxY,point.y);
  }
  return {minX,minY,maxX,maxY};
}

export function minimumBy<T>(values: readonly T[], select: (value:T)=>number) {
  let result=Infinity;
  for(const value of values)result=Math.min(result,select(value));
  return result;
}

export function maximumBy<T>(values: readonly T[], select: (value:T)=>number) {
  let result=-Infinity;
  for(const value of values)result=Math.max(result,select(value));
  return result;
}
