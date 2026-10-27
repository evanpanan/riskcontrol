'use client';
import { useEffect,useState } from 'react';
export function useBdManagers() {
  const [names,setNames]=useState<string[]>([]);
  useEffect(()=>{let active=true;void fetch('/api/ledger/managers',{cache:'no-store'}).then(r=>r.ok?r.json():{managers:[]}).then(d=>{if(active)setNames(d.managers.map((x:any)=>x.bdManagerFullName).filter(Boolean));}).catch(()=>{if(active)setNames([]);});return()=>{active=false;};},[]);
  return names;
}
