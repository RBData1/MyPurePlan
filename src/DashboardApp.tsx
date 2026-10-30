import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import CustomerServiceEditor, { normalizeServiceLine, serviceCycleLabel, type CustomerServiceLine } from './CustomerServiceEditor';
import { SERVICE_COLOR_PALETTE, nextServiceColor, resolveServiceColor, withServiceColors } from './serviceColors';
import UkDateInput from './UkDateInput';
import { applySetmoreFileImport, buildSetmoreLastImport, formatSetmoreImportSummary, type SetmoreLastImport } from './setmoreImport';
import InvoiceLedger from './InvoiceLedger';
import { combineInvoiceSources, invoiceDueAt, loadInvoices, loadQuickFileIntegration, readInvoiceCache, saveInvoices, saveQuickFileIntegration, settleInvoicedVisits, writeInvoiceCache, type InvoiceRecord } from './invoices';
import {
  createQuickFileInvoiceRequest,
  isQuickFileConnected,
  readQuickFileConnection,
  checkQuickFileInvoices,
  testQuickFileConnection,
  vatModeLabel,
  writeQuickFileConnection,
  type QuickFileConnection,
  type QuickFileVatMode,
} from './quickfile';
import { Activity, Archive, ArchiveRestore, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Download, FileText, Filter, ListChecks, MapPin, Menu, MoreHorizontal, Pencil, Pin, Plus, Search, Settings, Sparkles, Upload, Users, Wallet, Wrench, X, ArrowUpRight, CheckCircle2, AlertCircle, CalendarCheck, Trash2 } from 'lucide-react';
import ScheduleBoard from './ScheduleBoard';
import SetmorePlan, { type PlanCycle, type SetmorePlanCustomer } from './SetmorePlan';

type Customer = { id: string; name: string; email: string; phone: string; phone2: string; address: string; town: string; postcode: string; price: number; duration: number; frequency: number; notes: string; service: string; serviceLines: CustomerServiceLine[]; archived: boolean; quickfileClientId?: number | null };
type Appointment = { id: string; customerId: string; date: string; time: string; duration: number; service: string; price: number; status: 'Confirmed'|'Pending'|'Completed'|'Cancelled'; address: string; notes?: string; oneOff?: boolean; frequency?: number; setmoreBookingId?: string; quickfileInvoiceId?: number | null; quickfileInvoiceNumber?: string | null; quickfileInvoicedAt?: string | null; missingFromSetmore?: boolean };
const CYCLE_WEEKS = [4,6,8,10,12] as const;
function packApptNotes(
  notes:string|undefined,
  oneOff:boolean,
  frequency:number,
  qf?:{quickfileInvoiceId?:number|null;quickfileInvoiceNumber?:string|null;quickfileInvoicedAt?:string|null},
  setmoreBookingId?:string,
  missingFromSetmore?:boolean,
){
  let body=String(notes||'').replace(/^\[cycle:[^\]]+\]\s*/,'').replace(/\[qf:[^\]]+\]\s*/g,'').replace(/\[sm:[^\]]+\]\s*/g,'').replace(/\[gone\]\s*/g,'').trim();
  const tag=oneOff?'oneoff':String(CYCLE_WEEKS.includes(frequency as typeof CYCLE_WEEKS[number])?frequency:6);
  const parts=[`[cycle:${tag}]`];
  if(qf?.quickfileInvoiceId){
    parts.push(`[qf:${qf.quickfileInvoiceId}:${qf.quickfileInvoiceNumber||''}:${qf.quickfileInvoicedAt||''}]`);
  }
  const booking=String(setmoreBookingId||'').replace(/[\]\s]/g,'');
  if(booking) parts.push(`[sm:${booking}]`);
  if(missingFromSetmore) parts.push('[gone]');
  if(body) parts.push(body);
  return parts.join(' ');
}
function unpackApptNotes(raw:string|null|undefined){
  let text=String(raw||'');
  let oneOff=false;
  let frequency=6;
  let quickfileInvoiceId:number|null=null;
  let quickfileInvoiceNumber:string|null=null;
  let quickfileInvoicedAt:string|null=null;
  let setmoreBookingId='';
  let missingFromSetmore=false;
  const cycleM=text.match(/^\[cycle:(oneoff|\d+)\]\s*/);
  if(cycleM){
    oneOff=cycleM[1]==='oneoff';
    frequency=oneOff?6:Number(cycleM[1])||6;
    text=text.slice(cycleM[0].length);
  }
  const qfM=text.match(/^\[qf:(\d+):([^:]*):([^\]]*)\]\s*/);
  if(qfM){
    quickfileInvoiceId=Number(qfM[1])||null;
    quickfileInvoiceNumber=qfM[2]||null;
    quickfileInvoicedAt=qfM[3]||null;
    text=text.slice(qfM[0].length);
  }
  const smM=text.match(/^\[sm:([^\]]+)\]\s*/);
  if(smM){
    setmoreBookingId=smM[1];
    text=text.slice(smM[0].length);
  }
  if(text.startsWith('[gone]')){
    missingFromSetmore=true;
    text=text.slice('[gone]'.length).trim();
  }
  return {oneOff,frequency,notes:text,quickfileInvoiceId,quickfileInvoiceNumber,quickfileInvoicedAt,setmoreBookingId,missingFromSetmore};
}
function cycleLabel(a:Pick<Appointment,'oneOff'|'frequency'>){return a.oneOff?'One-off':`Every ${a.frequency||6} weeks`}
function cycleShort(a:Pick<Appointment,'oneOff'|'frequency'>){return a.oneOff?'1×':`${a.frequency||6}w`}
type Service = { name: string; duration: number; price: number; color: string };
type Payment = { id: string; appointmentId: string; amount: number; paidAt: string | null; method: string };
type FinancePeriod = 'week' | 'month' | 'year';
type BusinessSettings = { name: string; email: string; phone: string; postcode: string; workingDays: string; timezone: string; requireConfirmation: boolean; preventOverlap: boolean; useRecurring: boolean; mainService: string };
const defaultSettings: BusinessSettings = { name: 'ClearView Windows', email: 'hello@clearviewwindows.co.uk', phone: '020 8123 4567', postcode: 'DA15', workingDays: 'Monday to Saturday', timezone: 'Europe/London', requireConfirmation: true, preventOverlap: true, useRecurring: true, mainService: 'Window cleaning' };
const starterCustomers: Customer[] = [
 {id:'c1',name:'Oliver Bennett',email:'oliver.bennett@example.com',phone:'07700 900123',phone2:'',address:'18 Cedar Avenue',town:'Sidcup',postcode:'DA15 8AB',price:24,duration:30,frequency:6,notes:'Side gate is unlocked. Please close it afterwards.',service:'Window cleaning',serviceLines:[{service:'Window cleaning',price:24,duration:30,frequency:6}],archived:false},
 {id:'c2',name:'Amelia Clarke',email:'amelia.clarke@example.com',phone:'07700 900124',phone2:'',address:'42 The Drive',town:'Sidcup',postcode:'DA14 6NX',price:32,duration:45,frequency:8,notes:'Please text when you are on the way.',service:'Windows + conservatory',serviceLines:[{service:'Windows + conservatory',price:32,duration:45,frequency:8}],archived:false},
 {id:'c3',name:'George Wilson',email:'george.wilson@example.com',phone:'07700 900125',phone2:'',address:'7 Station Road',town:'Orpington',postcode:'BR5 3QW',price:18,duration:25,frequency:4,notes:'',service:'Window cleaning',serviceLines:[{service:'Window cleaning',price:18,duration:25,frequency:4}],archived:false},
 {id:'c4',name:'Isla Thompson',email:'isla.thompson@example.com',phone:'07700 900126',phone2:'',address:'91 Park Lane',town:'Bexley',postcode:'DA5 1AA',price:28,duration:35,frequency:6,notes:'Rear conservatory included.',service:'Window cleaning',serviceLines:[{service:'Window cleaning',price:28,duration:35,frequency:6}],archived:false},
 {id:'c5',name:'Noah Williams',email:'noah.williams@example.com',phone:'07700 900127',phone2:'',address:'5 Orchard Close',town:'Welling',postcode:'DA16 2RL',price:22,duration:30,frequency:8,notes:'',service:'Window cleaning',serviceLines:[{service:'Window cleaning',price:22,duration:30,frequency:8}],archived:false},
 {id:'c6',name:'Ava Davies',email:'ava.davies@example.com',phone:'07700 900128',phone2:'',address:'23 High Street',town:'Eltham',postcode:'SE9 1AA',price:35,duration:60,frequency:12,notes:'Large property; allow extra time.',service:'Windows + conservatory',serviceLines:[{service:'Windows + conservatory',price:35,duration:60,frequency:12}],archived:false},
];
function customerProperty(c: Pick<Customer,'address'|'town'|'postcode'>){return [c.address,c.town,c.postcode].filter(Boolean).join(', ')}
const today = new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const addDays = (n:number) => { const d = new Date(); d.setDate(d.getDate()+n); return iso(d); };
const shiftIsoDate = (date:string, n:number) => { const d = new Date(date+'T12:00:00'); d.setDate(d.getDate()+n); return iso(d); };
const DAY_START_TIME = '08:00';
function timeToMinutes(time:string){const [h,m]=time.split(':').map(Number);return (h||0)*60+(m||0)}
function minutesToTime(total:number){const mins=Math.max(0,Math.min(23*60+55,total));const h=Math.floor(mins/60);const m=mins%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`}
function endTimeOf(a:Pick<Appointment,'time'|'duration'>){return minutesToTime(timeToMinutes(a.time)+Math.max(5,Number(a.duration)||30))}
function timeRange(a:Pick<Appointment,'time'|'duration'>){return `${a.time} - ${endTimeOf(a)}`}
function serviceShort(name:string){
  const n=name.trim();
  if(/^window cleaning$/i.test(n)) return 'Windows';
  if(/conservatory/i.test(n)) return 'Windows+';
  if(/gutter/i.test(n)) return 'Gutters';
  if(/solar/i.test(n)) return 'Solar';
  return n.split(/\s+/)[0]||n;
}
function nextAvailableTime(list:Appointment[], date:string, dayStart=DAY_START_TIME){
  const ends=list.filter(a=>a.date===date&&a.status!=='Cancelled').map(a=>timeToMinutes(a.time)+Math.max(5,Number(a.duration)||30));
  if(!ends.length) return dayStart;
  return minutesToTime(Math.max(...ends));
}
const appointmentDuration=(a:Pick<Appointment,'duration'>)=>Math.max(5,Number(a.duration)||30);
/** After an appointment's time/duration changes, re-pack every later same-day job to follow the previous end. */
function cascadeFollowingAppointments(list:Appointment[], changed:Appointment):Appointment[]{
  const withChanged=list.map(a=>a.id===changed.id?changed:a);
  const day=withChanged
    .filter(a=>a.date===changed.date&&a.status!=='Cancelled')
    .sort((a,b)=>timeToMinutes(a.time)-timeToMinutes(b.time)||a.id.localeCompare(b.id));
  const startIdx=day.findIndex(a=>a.id===changed.id);
  if(startIdx<0) return withChanged;
  const shiftedTimes=new Map<string,string>();
  let cursorEnd=timeToMinutes(day[startIdx].time)+appointmentDuration(day[startIdx]);
  for(let i=startIdx+1;i<day.length;i++){
    const job=day[i];
    const nextStart=cursorEnd;
    if(timeToMinutes(job.time)!==nextStart) shiftedTimes.set(job.id, minutesToTime(nextStart));
    cursorEnd=nextStart+appointmentDuration(job);
  }
  return withChanged.map(a=>{
    const time=shiftedTimes.get(a.id);
    return time?{...a,time}:a;
  });
}
/** Push later jobs forward wherever same-day times overlap. */
function resolveOverlappingAppointments(list:Appointment[]):Appointment[]{
  let result=list;
  for(let guard=0;guard<30;guard++){
    let fixed=false;
    const dates=[...new Set(result.filter(a=>a.status!=='Cancelled').map(a=>a.date))];
    for(const date of dates){
      const day=result.filter(a=>a.date===date&&a.status!=='Cancelled').sort((a,b)=>timeToMinutes(a.time)-timeToMinutes(b.time)||a.id.localeCompare(b.id));
      for(let i=0;i<day.length-1;i++){
        const end=timeToMinutes(day[i].time)+appointmentDuration(day[i]);
        if(timeToMinutes(day[i+1].time)<end){
          result=cascadeFollowingAppointments(result, day[i]);
          fixed=true;
          break;
        }
      }
      if(fixed) break;
    }
    if(!fixed) break;
  }
  return result;
}
const starterAppointments: Appointment[] = [
 {id:'a0',customerId:'c3',date:addDays(-4),time:'10:00',duration:25,service:'Window cleaning',price:18,status:'Confirmed',address:'7 Station Road, BR5 3QW',notes:'Missed — rain day',oneOff:false,frequency:4},
 {id:'a0b',customerId:'c1',date:addDays(-2),time:'09:00',duration:30,service:'Window cleaning',price:24,status:'Completed',address:'18 Cedar Avenue, DA15 8AB',oneOff:false,frequency:6},
 {id:'a1',customerId:'c1',date:addDays(0),time:'08:30',duration:30,service:'Window cleaning',price:24,status:'Confirmed',address:'18 Cedar Avenue, DA15 8AB',oneOff:false,frequency:6},
 {id:'a2',customerId:'c2',date:addDays(0),time:'09:30',duration:45,service:'Windows + conservatory',price:32,status:'Confirmed',address:'42 The Drive, DA14 6NX',oneOff:false,frequency:8},
 {id:'a3',customerId:'c3',date:addDays(0),time:'11:00',duration:25,service:'Window cleaning',price:18,status:'Pending',address:'7 Station Road, BR5 3QW',oneOff:false,frequency:4},
 {id:'a4',customerId:'c4',date:addDays(1),time:'08:30',duration:35,service:'Window cleaning',price:28,status:'Confirmed',address:'91 Park Lane, DA5 1AA',oneOff:false,frequency:6},
 {id:'a5',customerId:'c5',date:addDays(1),time:'10:00',duration:30,service:'Window cleaning',price:22,status:'Confirmed',address:'5 Orchard Close, DA16 2RL',oneOff:false,frequency:8},
 {id:'a6',customerId:'c6',date:addDays(2),time:'09:00',duration:60,service:'Windows + conservatory',price:35,status:'Completed',address:'23 High Street, SE9 1AA',oneOff:false,frequency:12},
];
const defaultServices: Service[] = withServiceColors([{name:'Window cleaning',duration:30,price:24},{name:'Windows + conservatory',duration:45,price:38},{name:'Gutter clearing',duration:60,price:65},{name:'Solar panel cleaning',duration:45,price:50}]);
function parseServiceLines(raw: unknown, fallbackService = '', fallbackPrice = 0, fallbackDuration = 30, fallbackFrequency = 6): CustomerServiceLine[] {
  if (Array.isArray(raw)) {
    return raw.map((row: any) => normalizeServiceLine({
      service: String(row?.service || '').trim(),
      price: row?.price,
      duration: row?.duration,
      frequency: row?.frequency,
      oneOff: row?.oneOff,
    }, { price: fallbackPrice, duration: fallbackDuration, frequency: fallbackFrequency })).filter(line => line.service);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try { return parseServiceLines(JSON.parse(raw), fallbackService, fallbackPrice, fallbackDuration, fallbackFrequency); } catch { /* ignore */ }
  }
  if (fallbackService) return [normalizeServiceLine({ service: fallbackService, price: fallbackPrice, duration: fallbackDuration, frequency: fallbackFrequency })];
  return [];
}
function withServiceLines(customer: Customer, lines: CustomerServiceLine[]): Customer {
  const seen = new Set<string>();
  const serviceLines = lines
    .filter(line => line.service)
    .map(line => normalizeServiceLine(line, { frequency: customer.frequency || 6 }))
    .filter(line => {
      const key = line.service.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const primary = serviceLines[0];
  return {
    ...customer,
    serviceLines,
    service: primary?.service ?? '',
    price: primary?.price ?? 0,
    duration: primary?.duration ?? 30,
    frequency: primary && !primary.oneOff ? (primary.frequency || 6) : (customer.frequency || 6),
  };
}
function customerServiceNames(c: Pick<Customer,'service'|'serviceLines'>) {
  // Prefer serviceLines even when empty — [] means Unassigned (history kept).
  const names = (Array.isArray(c.serviceLines)
    ? c.serviceLines.map(l => l.service)
    : [c.service]).map(n => n.trim()).filter(Boolean);
  return [...new Set(names)];
}
function customerHasService(c: Pick<Customer,'service'|'serviceLines'>, serviceName: string) {
  return customerServiceNames(c).includes(serviceName);
}
function customerLineFor(c: Customer, serviceName: string) {
  return c.serviceLines?.find(l => l.service === serviceName)
    ?? (c.service === serviceName ? normalizeServiceLine({ service: c.service, price: c.price, duration: c.duration, frequency: c.frequency || 6 }) : null);
}
const PAST_CUSTOMER_MARKER = '[mpp:past]';
const PHONE2_MARKER_RE = /\[mpp:phone2:([^\]]*)\]/i;
function stripMetaMarkers(notes: string) {
  return String(notes || '')
    .replace(/^\s*\[mpp:past\]\s*/i, '')
    .replace(PHONE2_MARKER_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function extractPhone2FromNotes(notes: string) {
  const m = String(notes || '').match(PHONE2_MARKER_RE);
  return m ? String(m[1] || '').trim() : '';
}
function packCustomerNotes(notes: string, archived: boolean, phone2: string) {
  const body = stripMetaMarkers(notes);
  const parts: string[] = [];
  if (archived) parts.push(PAST_CUSTOMER_MARKER);
  const secondary = String(phone2 || '').trim();
  if (secondary) parts.push(`[mpp:phone2:${secondary}]`);
  if (body) parts.push(body);
  return parts.join(' ') || null;
}
function notesMarkPastCustomer(notes: string) {
  return /^\s*\[mpp:past\]/i.test(String(notes || '')) || /\[mpp:past\]/i.test(String(notes || ''));
}
function normalizeCustomer(c: Partial<Customer> & Pick<Customer,'id'|'name'>, serviceList: Service[] = defaultServices): Customer {
  const legacyService = c.service ?? '';
  const legacyPrice = Number.isFinite(Number(c.price)) ? Number(c.price) : 0;
  const legacyFrequency = Number(c.frequency) || 6;
  const legacyDuration = Number.isFinite(Number(c.duration)) && Number(c.duration) > 0
    ? Number(c.duration)
    : (serviceList.find(s => s.name === legacyService)?.duration ?? 30);
  const serviceLines = parseServiceLines((c as any).serviceLines ?? (c as any).assigned_services, legacyService, legacyPrice, legacyDuration, legacyFrequency);
  const primary = serviceLines[0];
  const rawNotes = c.notes ?? '';
  const archived = Boolean(c.archived) || notesMarkPastCustomer(rawNotes);
  const phone2 = String((c as Customer).phone2 ?? '').trim() || extractPhone2FromNotes(rawNotes);
  return {
    id: c.id,
    name: c.name,
    email: c.email ?? '',
    phone: c.phone ?? '',
    phone2,
    address: c.address ?? '',
    town: c.town ?? '',
    postcode: c.postcode ?? '',
    price: primary?.price ?? legacyPrice,
    duration: primary?.duration ?? legacyDuration,
    frequency: primary && !primary.oneOff ? (primary.frequency || legacyFrequency) : legacyFrequency,
    notes: stripMetaMarkers(rawNotes),
    service: primary?.service ?? legacyService,
    serviceLines,
    archived,
    quickfileClientId: c.quickfileClientId==null?null:Number(c.quickfileClientId)||null,
  };
}
/** Cloud is the shared copy. A customer who exists only on this device is kept while that save is still pending. */
function mergeCustomerLists(cloud: Customer[], local: Customer[], keepLocalIds: Set<string>): Customer[] {
  const localById = new Map(local.map(c => [c.id, c]));
  const merged = cloud.map(c => {
    const extra = localById.get(c.id);
    if (!extra || !keepLocalIds.has(c.id)) return c;
    return {
      ...c,
      archived: Boolean(extra.archived) || Boolean(c.archived),
      phone2: extra.phone2 || c.phone2 || '',
      notes: c.notes || extra.notes || '',
      quickfileClientId: extra.quickfileClientId ?? c.quickfileClientId,
    };
  });
  const cloudIds = new Set(cloud.map(c => c.id));
  for (const customer of local) {
    if (!cloudIds.has(customer.id) && keepLocalIds.has(customer.id)) merged.push(customer);
  }
  return merged;
}
const starterPayments: Payment[] = [
 {id:'p1',appointmentId:'a6',amount:35,paidAt:addDays(-1),method:'cash'},
];
function readStore<T>(key:string, fallback:T):T { try { const value=localStorage.getItem(key); return value?JSON.parse(value) as T:fallback; } catch { return fallback; } }
function workspaceKey(base:string, businessId:string|null){return businessId?`${base}_${businessId}`:base;}
function writeWorkspaceStore<T>(base:string, businessId:string|null, value:T){
  const key=workspaceKey(base,businessId);
  const save=(payload:T)=>localStorage.setItem(key, JSON.stringify(payload));
  try { save(value); }
  catch {
    // A full Setmore history can exceed the browser storage quota. Keep the working schedule.
    if(base==='cs_appointments' && Array.isArray(value)){
      const cutoff=shiftIsoDate(addDays(0), -420);
      try { save((value as Appointment[]).filter(a=>a.date>=cutoff) as T); } catch { /* keep the previous cache */ }
    }
  }
}
const SYNC_CHUNK=80;
const PAGE_SIZE=1000;
/** PostgREST returns at most 1000 rows per request. Page until the full table is loaded. */
async function fetchAllRows(
  client: NonNullable<typeof supabase>,
  table: string,
  businessId: string,
  orderBy: string[],
  onPage?: (loaded: number, total: number | null) => void,
): Promise<{data: any[] | null; error: {message: string} | null}> {
  const query=(from: number, to: number, withCount: boolean)=>{
    let request: any=client.from(table).select('*', withCount?{count:'exact'}:undefined).eq('business_id', businessId);
    for(const column of orderBy) request=request.order(column,{ascending:true});
    return request.range(from, to);
  };
  const first=await query(0, PAGE_SIZE-1, true);
  if(first.error) return {data:null, error:first.error};
  const rows: any[]=[...(first.data??[])];
  const total=typeof first.count==='number'?first.count:null;
  onPage?.(rows.length, total);
  if(rows.length<PAGE_SIZE) return {data:rows, error:null};
  const last=total??PAGE_SIZE*80;
  const starts: number[]=[];
  for(let from=PAGE_SIZE; from<last; from+=PAGE_SIZE) starts.push(from);
  const pages: any[][]=new Array(starts.length);
  let cursor=0;
  let loaded=rows.length;
  const worker=async()=>{
    while(cursor<starts.length){
      const index=cursor++;
      const from=starts[index];
      const to=Math.min(from+PAGE_SIZE-1, (total??from+PAGE_SIZE)-1);
      const page=await query(from, to, false);
      if(page.error) throw page.error;
      pages[index]=page.data??[];
      loaded+=pages[index].length;
      onPage?.(total!=null?Math.min(loaded, total):loaded, total);
    }
  };
  try {
    await Promise.all(Array.from({length:Math.min(4, starts.length)}, ()=>worker()));
  } catch(error) {
    const message=error && typeof error==='object' && 'message' in error ? String((error as {message:unknown}).message) : 'Could not load every row';
    return {data:null, error:{message}};
  }
  const seen=new Set(rows.map(row=>row.id).filter(Boolean));
  for(const batch of pages){
    if(!batch?.length) break;
    let added=0;
    for(const row of batch){
      if(row?.id && seen.has(row.id)) continue;
      if(row?.id) seen.add(row.id);
      rows.push(row);
      added+=1;
    }
    onPage?.(rows.length, total);
    if(added===0 || batch.length<PAGE_SIZE) break;
  }
  return {data:rows, error:null};
}
function appointmentSig(a:Pick<Appointment,'customerId'|'date'|'time'|'duration'|'service'|'price'|'status'|'address'|'notes'|'oneOff'|'frequency'|'setmoreBookingId'|'quickfileInvoiceId'|'quickfileInvoiceNumber'|'quickfileInvoicedAt'|'missingFromSetmore'>){
  return JSON.stringify([a.customerId,a.date,a.time,a.duration,a.service,a.price,a.status,a.address||'',a.notes||'',Boolean(a.oneOff),a.frequency??null,a.setmoreBookingId||'',a.quickfileInvoiceId??null,a.quickfileInvoiceNumber??null,a.quickfileInvoicedAt??null,Boolean(a.missingFromSetmore)]);
}
function paymentSig(p:Payment){return JSON.stringify([p.appointmentId,p.amount,p.paidAt,p.method]);}
function invoicesFromAppointments(list:Appointment[], people:Customer[], pays:Payment[]):InvoiceRecord[]{
  const names=new Map(people.map(c=>[c.id,c.name]));
  const paid=new Map(pays.filter(p=>p.paidAt).map(p=>[p.appointmentId,p]));
  const groups=new Map<number, Appointment[]>();
  for(const appointment of list){
    if(!appointment.quickfileInvoiceId) continue;
    const bucket=groups.get(appointment.quickfileInvoiceId)||[];
    bucket.push(appointment);
    groups.set(appointment.quickfileInvoiceId, bucket);
  }
  const rows:InvoiceRecord[]=[];
  for(const [invoiceId, jobs] of groups){
    jobs.sort((a,b)=>a.time.localeCompare(b.time)||a.id.localeCompare(b.id));
    const first=jobs[0];
    const payment=jobs.map(job=>paid.get(job.id)).find(Boolean);
    const issued=first.quickfileInvoicedAt||`${first.date}T12:00:00.000Z`;
    const amount=jobs.reduce((sum,job)=>sum+(Number(job.price)||0),0);
    rows.push({
      id:crypto.randomUUID(),
      appointmentId:first.id,
      customerName:names.get(first.customerId)||'Customer',
      service:jobs.map(job=>job.service).filter(Boolean).join(', '),
      address:first.address||'',
      jobDate:first.date,
      amount,
      quickfileInvoiceId:invoiceId,
      quickfileInvoiceNumber:first.quickfileInvoiceNumber||null,
      source:invoiceId<0?'local':'quickfile',
      issuedAt:issued,
      dueAt:invoiceDueAt(issued),
      status:payment?'paid':'unpaid',
      paidAt:payment?.paidAt||null,
      paidAmount:payment?amount:null,
      paymentMethod:payment?.method||null,
    });
  }
  return rows;
}
function customerSyncSig(c:Customer){return JSON.stringify([c.name,c.email,c.phone,c.phone2,c.address,c.town,c.postcode,c.price,c.duration,c.frequency,c.notes,c.service,Boolean(c.archived),c.quickfileClientId??null,c.serviceLines]);}
function serviceSyncSig(s:Service){return JSON.stringify([s.name,s.duration,s.price,s.color||'']);}
function sameById<T extends {id:string}>(current:T[], next:T[], sig:(item:T)=>string){
  if(current.length!==next.length) return false;
  const map=new Map(current.map(item=>[item.id, sig(item)]));
  return next.every(item=>map.get(item.id)===sig(item));
}
/** Columns PostgREST rejected (missing migrations) — omitted for the rest of the session. */
const omittedUpsertColumns = new Map<string, Set<string>>();
function stripKnownMissingColumns(table: string, rows: Record<string, unknown>[]) {
  const omit = omittedUpsertColumns.get(table);
  if (!omit?.size) return rows;
  return rows.map(row => {
    const next = { ...row };
    omit.forEach(col => { delete next[col]; });
    return next;
  });
}
function dedupeById(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = String(row.id ?? '');
    if (!id) continue;
    byId.set(id, row);
  }
  return [...byId.values()];
}
async function upsertInChunks(
  client: NonNullable<typeof supabase>,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  chunkSize = SYNC_CHUNK,
): Promise<string | null> {
  if (!rows.length) return null;
  const uniqueRows = rows[0] && 'id' in rows[0] ? dedupeById(rows) : rows;
  for (let offset = 0; offset < uniqueRows.length; offset += chunkSize) {
    let attempt = stripKnownMissingColumns(table, uniqueRows.slice(offset, offset + chunkSize));
    let lastError: string | null = null;
    for (let peel = 0; peel < 8; peel++) {
      const { error } = await client.from(table).upsert(attempt, { onConflict });
      if (!error) { lastError = null; break; }
      const code = String(error.code || '');
      lastError = error.message || code || `${table} upsert failed`;
      // 409 = FK / unique conflict. Drop optional address_id, then bisect, then skip bad row.
      if (code === '23503' || code === '23505' || /conflict|foreign key|duplicate key|409/i.test(lastError)) {
        if (attempt.some(row => row.address_id != null)) {
          attempt = attempt.map(row => ({ ...row, address_id: null }));
          continue;
        }
        if (attempt.length > 1) {
          const half = Math.max(1, Math.floor(attempt.length / 2));
          const left = await upsertInChunks(client, table, attempt.slice(0, half), onConflict, half);
          const right = await upsertInChunks(client, table, attempt.slice(half), onConflict, half);
          if (left && right) return `${left} · ${right}`;
          if (left || right) return left || right;
          lastError = null;
          break;
        }
        // Single conflicting row — skip so the rest of the sync can finish.
        lastError = null;
        break;
      }
      if (/timeout|57014/i.test(lastError) && attempt.length > 10) {
        const half = Math.max(10, Math.floor(attempt.length / 2));
        const left = await upsertInChunks(client, table, attempt.slice(0, half), onConflict, half);
        if (left) return left;
        const right = await upsertInChunks(client, table, attempt.slice(half), onConflict, half);
        if (right) return right;
        lastError = null;
        break;
      }
      const col = String(lastError).match(/'([^']+)' column/i)?.[1];
      if (!col || attempt.every(row => !(col in row))) break;
      if (!omittedUpsertColumns.has(table)) omittedUpsertColumns.set(table, new Set());
      omittedUpsertColumns.get(table)!.add(col);
      attempt = attempt.map(row => {
        const next = { ...row };
        delete next[col];
        return next;
      });
    }
    if (lastError) return lastError;
  }
  return null;
}
function readWorkspaceStore<T>(base:string, businessId:string|null, fallback:T):T {
  const scoped=readStore(workspaceKey(base,businessId), null as T|null);
  if(scoped!=null) return scoped;
  // Migrate older unscoped keys into the business-scoped cache once.
  if(businessId){
    const legacy=readStore(base, null as T|null);
    if(legacy!=null){
      writeWorkspaceStore(base, businessId, legacy);
      return legacy;
    }
  }
  return fallback;
}
function mergeById<T extends {id:string}>(primary:T[], secondary:T[]):T[]{
  const map=new Map<string,T>();
  secondary.forEach(item=>map.set(item.id,item));
  primary.forEach(item=>map.set(item.id,item));
  return Array.from(map.values());
}
/** After a successful cloud read, another device's delete stays deleted. This device keeps only visits still waiting to upload. */
function resolveAppointmentsLoad(cloud:Appointment[], local:Appointment[], keepLocalIds:Set<string>):Appointment[]{
  const localById=new Map(local.map(a=>[a.id, a]));
  const kept=cloud.map(a=>keepLocalIds.has(a.id)&&localById.has(a.id)?localById.get(a.id)!:a);
  const cloudIds=new Set(cloud.map(a=>a.id));
  for(const appointment of local){
    if(!cloudIds.has(appointment.id)&&keepLocalIds.has(appointment.id)) kept.push(appointment);
  }
  return kept;
}
function appointmentIdentity(a:Pick<Appointment,'customerId'|'date'|'time'|'service'>){
  return `${a.customerId}|${a.date}|${a.time}|${a.service.trim().toLowerCase()}`;
}
/** Repeated Setmore imports inserted the same job under new ids. Keep one copy. */
function dedupeAppointments(list:Appointment[], payments:Payment[], preferredIds:Set<string>){
  const paidIds=new Set(payments.filter(p=>p.paidAt).map(p=>p.appointmentId));
  const score=(a:Appointment)=>(paidIds.has(a.id)?16:0)+(preferredIds.has(a.id)?8:0)+(a.quickfileInvoiceId?4:0)+(a.status!=='Cancelled'?2:0);
  const byKey=new Map<string, Appointment>();
  const replaced=new Map<string, string>();
  for(const appointment of list){
    const key=appointmentIdentity(appointment);
    const prev=byKey.get(key);
    if(!prev){ byKey.set(key, appointment); continue; }
    const winner=score(appointment)>score(prev)?appointment:prev;
    const loser=winner===appointment?prev:appointment;
    byKey.set(key, {
      ...winner,
      setmoreBookingId:winner.setmoreBookingId||loser.setmoreBookingId,
      quickfileInvoiceId:winner.quickfileInvoiceId||loser.quickfileInvoiceId,
      quickfileInvoiceNumber:winner.quickfileInvoiceNumber||loser.quickfileInvoiceNumber,
      quickfileInvoicedAt:winner.quickfileInvoicedAt||loser.quickfileInvoicedAt,
      missingFromSetmore:Boolean(winner.missingFromSetmore||loser.missingFromSetmore),
      status:(winner.quickfileInvoiceId||loser.quickfileInvoiceId)?'Completed':winner.status,
    });
    replaced.set(loser.id, winner.id);
  }
  const kept=new Set([...byKey.values()].map(a=>a.id));
  const resolveId=(id:string)=>{
    const seen=new Set<string>();
    let current=id;
    while(replaced.has(current)&&!seen.has(current)){ seen.add(current); current=replaced.get(current)!; }
    return kept.has(current)?current:id;
  };
  const paymentByAppointment=new Map<string, Payment>();
  for(const payment of payments){
    const appointmentId=resolveId(payment.appointmentId);
    const next=appointmentId===payment.appointmentId?payment:{...payment,appointmentId};
    const prev=paymentByAppointment.get(appointmentId);
    if(!prev||(!prev.paidAt&&next.paidAt)||next.amount>prev.amount) paymentByAppointment.set(appointmentId, next);
  }
  return {appointments:[...byKey.values()], payments:[...paymentByAppointment.values()], removedIds:[...replaced.keys()]};
}
function periodRange(period: FinancePeriod, anchor = new Date()){
  const end = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const start = new Date(end);
  if(period==='week'){ start.setDate(end.getDate()-((end.getDay()+6)%7)); }
  else if(period==='month'){ start.setDate(1); }
  else { start.setMonth(0,1); }
  return { start: iso(start), end: iso(end) };
}
function serviceMapKey(businessId: string | null){return businessId?`cs_customer_services_${businessId}`:'cs_customer_services';}
function readServiceMap(businessId: string | null): Record<string, CustomerServiceLine[] | string> { return readStore(serviceMapKey(businessId), {} as Record<string, CustomerServiceLine[] | string>); }
function writeServiceMap(businessId: string | null, map: Record<string, CustomerServiceLine[] | string>){ localStorage.setItem(serviceMapKey(businessId), JSON.stringify(map)); }
function applyServiceMap(list: Customer[], businessId: string | null): Customer[] {
  const map = readServiceMap(businessId);
  return list.map(c => {
    const stored = map[c.id];
    if (!stored) return c;
    if (typeof stored === 'string') {
      return withServiceLines(c, stored ? [normalizeServiceLine({ service: stored, price: c.price || 0, duration: c.duration || 30, frequency: c.frequency || 6 })] : c.serviceLines);
    }
    return withServiceLines(c, stored);
  });
}
function persistCustomerServices(list: Customer[], businessId: string | null){
  const map: Record<string, CustomerServiceLine[]> = {};
  list.forEach(c => { if (c.serviceLines?.length) map[c.id] = c.serviceLines; else if (c.service) map[c.id] = [normalizeServiceLine({ service: c.service, price: c.price, duration: c.duration, frequency: c.frequency || 6 })]; });
  writeServiceMap(businessId, map);
}
function money(n:number){return new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:2}).format(n)}
function dateLabel(date:string){const d=new Date(date+'T12:00:00');if(Number.isNaN(d.getTime()))return date;return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;}
function formatDateTime(value:string){
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return value;
  const date=`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  const time=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  return `${date} ${time}`;
}
const SETMORE_IMPORT_HISTORY_LIMIT=30;
function setmoreImportKey(businessId:string|null){return businessId?`cs_setmore_last_import_${businessId}`:'cs_setmore_last_import';}
function setmoreImportHistoryKey(businessId:string|null){return businessId?`cs_setmore_import_history_${businessId}`:'cs_setmore_import_history';}
function normalizeSetmoreImportEntry(value:Partial<SetmoreLastImport>|null|undefined):SetmoreLastImport|null{
  if(!value?.importedAt) return null;
  return {
    id:value.id||`legacy-${value.importedAt}`,
    importedAt:value.importedAt,
    fileName:value.fileName||'Setmore file',
    fileModifiedAt:value.fileModifiedAt??null,
    coverageFrom:value.coverageFrom??null,
    coverageTo:value.coverageTo??null,
    summaryLine:value.summaryLine||'',
    detectedHeaders:Array.isArray(value.detectedHeaders)?value.detectedHeaders:undefined,
    rowsWithSchedule:typeof value.rowsWithSchedule==='number'?value.rowsWithSchedule:undefined,
    rowsCustomerOnly:typeof value.rowsCustomerOnly==='number'?value.rowsCustomerOnly:undefined,
    fileKind:value.fileKind||undefined,
    sheetName:value.sheetName??undefined,
    sample:Array.isArray(value.sample)?value.sample:undefined,
  };
}
function readSetmoreImportHistory(businessId:string|null):SetmoreLastImport[]{
  try{
    const historyRaw=localStorage.getItem(setmoreImportHistoryKey(businessId));
    if(historyRaw){
      const parsed=JSON.parse(historyRaw) as SetmoreLastImport[];
      if(Array.isArray(parsed)){
        return parsed.map(normalizeSetmoreImportEntry).filter((entry):entry is SetmoreLastImport=>Boolean(entry));
      }
    }
    // Migrate older single "last import" records into history.
    const legacyRaw=localStorage.getItem(setmoreImportKey(businessId));
    if(!legacyRaw) return [];
    const legacy=normalizeSetmoreImportEntry(JSON.parse(legacyRaw) as SetmoreLastImport);
    return legacy?[legacy]:[];
  }catch{ return []; }
}
function writeSetmoreImportHistory(businessId:string|null, history:SetmoreLastImport[]){
  const trimmed=history.slice(0,SETMORE_IMPORT_HISTORY_LIMIT);
  localStorage.setItem(setmoreImportHistoryKey(businessId), JSON.stringify(trimmed));
  if(trimmed[0]) localStorage.setItem(setmoreImportKey(businessId), JSON.stringify(trimmed[0]));
  else localStorage.removeItem(setmoreImportKey(businessId));
}
function plannedSetmoreKey(businessId:string|null){return businessId?`cs_setmore_planned_${businessId}`:'cs_setmore_planned';}
function readPlannedSetmore(businessId:string|null):string[]{
  try{
    const raw=localStorage.getItem(plannedSetmoreKey(businessId));
    const parsed=raw?JSON.parse(raw):[];
    return Array.isArray(parsed)?parsed.filter((id):id is string=>typeof id==='string'):[];
  }catch{return [];}
}
function writePlannedSetmore(businessId:string|null, ids:string[]){localStorage.setItem(plannedSetmoreKey(businessId), JSON.stringify(ids));}
function customerPlanCycles(customer:Pick<Customer,'frequency'|'serviceLines'>):number[]{
  const lines=(customer.serviceLines||[]).filter(line=>line.service&&!line.oneOff);
  const weeks=(lines.length?lines:[{frequency:customer.frequency||6}]).map(line=>Number(line.frequency)||customer.frequency||6);
  return [...new Set(weeks.filter(week=>(CYCLE_WEEKS as readonly number[]).includes(week)))];
}
function planCycleLabel(weeks:number[]){
  if(!weeks.length) return 'One-off';
  if(weeks.length===1) return `Every ${weeks[0]} weeks`;
  return weeks.map(week=>`${week}w`).join(' · ');
}
function prependSetmoreImportHistory(businessId:string|null, entry:SetmoreLastImport):SetmoreLastImport[]{
  const next=[entry,...readSetmoreImportHistory(businessId).filter(item=>item.id!==entry.id)].slice(0,SETMORE_IMPORT_HISTORY_LIMIT);
  writeSetmoreImportHistory(businessId, next);
  return next;
}
function initials(name:string){return name.split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase()}
const nav = [{id:'Schedule',icon:CalendarDays},{id:'Setmore',icon:ListChecks},{id:'Customers',icon:Users},{id:'Services & pricing',icon:Wrench}];
type DashboardProps = { businessId: string | null; businessName?: string; userEmail?: string; onSignOut?: () => void };

export default function DashboardApp({ businessId, businessName, userEmail, onSignOut }: DashboardProps){
 const [customers,setCustomers]=useState<Customer[]>(()=>{
  const fallback=businessId?[] as Customer[]:starterCustomers;
  const raw=readWorkspaceStore('cs_customers', businessId, fallback) as Customer[];
  return applyServiceMap(raw.map(c=>normalizeCustomer({...c,service:c.service??''})), businessId);
 });
 const [appointments,setAppointments]=useState<Appointment[]>(()=>resolveOverlappingAppointments(readWorkspaceStore('cs_appointments', businessId, businessId?[]:starterAppointments)));
 const [payments,setPayments]=useState<Payment[]>(()=>readWorkspaceStore('cs_payments', businessId, businessId?[]:starterPayments));
 const [services,setServices]=useState<Service[]>(()=>withServiceColors(readWorkspaceStore('cs_services', businessId, defaultServices)));
 const [settings,setSettings]=useState<BusinessSettings>(()=>{const saved=readStore('cs_settings',defaultSettings);return {...defaultSettings,...saved,name:businessName||saved.name||defaultSettings.name,mainService:saved.mainService||defaultSettings.mainService};});
 const [remoteReady,setRemoteReady]=useState(!businessId); const [remoteError,setRemoteError]=useState(''); const [loadProgress,setLoadProgress]=useState(''); const [cloudStatus,setCloudStatus]=useState(businessId?'Connecting to Supabase…':'Demo mode'); const syncQueue=useRef<Promise<void>>(Promise.resolve()); const appointmentsRef=useRef(appointments); appointmentsRef.current=appointments; const customersRef=useRef(customers); customersRef.current=customers; const paymentsRef=useRef(payments); paymentsRef.current=payments; const servicesRef=useRef(services); servicesRef.current=services; const remoteReadyRef=useRef(remoteReady); remoteReadyRef.current=remoteReady; const syncedAppointmentSig=useRef(new Map<string,string>()); const syncedPaymentSig=useRef(new Map<string,string>()); const syncedCustomerIds=useRef(new Set<string>());
 const setmoreFileRef=useRef<HTMLInputElement>(null);
 const quickFileReady=useRef(false);
 const [page,setPage]=useState('Schedule'); const [search,setSearch]=useState(''); const [showAdd,setShowAdd]=useState(false); const [editingAppointment,setEditingAppointment]=useState<Appointment|null>(null); const [scheduleCustomerId,setScheduleCustomerId]=useState<string|null>(null); const [scheduleDate,setScheduleDate]=useState(addDays(0)); const [scheduleFormKey,setScheduleFormKey]=useState(0); const [showCustomer,setShowCustomer]=useState(false); const [editingCustomer,setEditingCustomer]=useState<Customer|null>(null); const [customerHistoryPeriod,setCustomerHistoryPeriod]=useState<'week'|'month'|'year'|'all'>('year'); const [showServiceForm,setShowServiceForm]=useState(false); const [editingService,setEditingService]=useState<Service|null>(null); const [selectedService,setSelectedService]=useState<string|null>(null); const [menuOpen,setMenuOpen]=useState(false); const [navExpanded,setNavExpanded]=useState(false); const [scheduleSearch,setScheduleSearch]=useState(''); const [notice,setNotice]=useState(''); const [importingSetmore,setImportingSetmore]=useState(false); const [setmoreImportHistory,setSetmoreImportHistory]=useState<SetmoreLastImport[]>(()=>readSetmoreImportHistory(businessId)); const [selectedSetmoreImportId,setSelectedSetmoreImportId]=useState<string|null>(()=>readSetmoreImportHistory(businessId)[0]?.id??null); const selectedSetmoreImport=setmoreImportHistory.find(entry=>entry.id===selectedSetmoreImportId)??setmoreImportHistory[0]??null; const lastSetmoreImport=setmoreImportHistory[0]??null; const [scheduleView,setScheduleView]=useState<'list'|'calendar'>('calendar'); const [planOpen,setPlanOpen]=useState(false); const [calendarMode,setCalendarMode]=useState<'Day'|'Week'|'Month'>(()=>typeof window!=='undefined'&&window.matchMedia('(max-width:720px)').matches?'Day':'Week'); const [selectedDate,setSelectedDate]=useState(addDays(0)); const [dayPanelOpen,setDayPanelOpen]=useState(false); const [customerFilter,setCustomerFilter]=useState('All customers'); const [customerListMode,setCustomerListMode]=useState<'Active'|'Past'>('Active'); const [selectedCustomerIds,setSelectedCustomerIds]=useState<string[]>([]); const [deletingCustomers,setDeletingCustomers]=useState(false); const [serviceFilter,setServiceFilter]=useState('All services'); const [financePeriod,setFinancePeriod]=useState<FinancePeriod>('week');
 const [quickFile,setQuickFile]=useState<QuickFileConnection>(()=>readQuickFileConnection(businessId));
 const [quickFileBusy,setQuickFileBusy]=useState(false); const [checkingQuickFile,setCheckingQuickFile]=useState(false);
 const [invoicingAppointmentId,setInvoicingAppointmentId]=useState<string|null>(null);
 const [invoiceChoiceId,setInvoiceChoiceId]=useState<string|null>(null);
 const [invoiceChoiceKeys,setInvoiceChoiceKeys]=useState<string[]>([]);
 const [plannedSetmoreIds,setPlannedSetmoreIds]=useState<string[]>(()=>readPlannedSetmore(businessId));
 const [planCycle,setPlanCycle]=useState<PlanCycle>('all');
 const [planSearch,setPlanSearch]=useState('');
 const [showPlannedSetmore,setShowPlannedSetmore]=useState(false);
 const [invoices,setInvoices]=useState<InvoiceRecord[]>(()=>readInvoiceCache(businessId));
 const [invoiceNotice,setInvoiceNotice]=useState('');
 const pendingCloudDeletes=useRef<string[]>([]);
 // When signed in, wait until Supabase hydration finishes before writing cache —
 // otherwise an empty first paint can wipe a good local backup.
 useEffect(()=>{
  if(businessId&&!remoteReady) return;
  writeWorkspaceStore('cs_customers',businessId,customers);
  persistCustomerServices(customers,businessId);
 },[customers,businessId,remoteReady]);
 useEffect(()=>{
  if(businessId&&!remoteReady) return;
  // Never persist an empty appointment list over a non-empty backup.
  if(appointments.length===0){
    const existing=readWorkspaceStore('cs_appointments', businessId, [] as Appointment[]);
    if(existing.length>0) return;
  }
  writeWorkspaceStore('cs_appointments',businessId,appointments);
 },[appointments,businessId,remoteReady]);
 useEffect(()=>{
  if(businessId&&!remoteReady) return;
  writeWorkspaceStore('cs_payments',businessId,payments);
 },[payments,businessId,remoteReady]);
 useEffect(()=>{
  if(businessId&&!remoteReady) return;
  writeWorkspaceStore('cs_services',businessId,services);
 },[services,businessId,remoteReady]);
 useEffect(()=>{localStorage.setItem('cs_settings',JSON.stringify(settings));},[settings]);
 useEffect(()=>{ if(businessName) setSettings(s=>({...s,name:businessName})); },[businessName]);
 useEffect(()=>{ const history=readSetmoreImportHistory(businessId); setSetmoreImportHistory(history); setSelectedSetmoreImportId(history[0]?.id??null); setQuickFile(readQuickFileConnection(businessId)); },[businessId]);
 useEffect(()=>{ writeQuickFileConnection(businessId, quickFile); },[quickFile,businessId]);
 useEffect(()=>{
  if(!businessId||!supabase){ quickFileReady.current=true; return; }
  const client=supabase;
  let cancelled=false;
  quickFileReady.current=false;
  void (async()=>{
    const loaded=await loadQuickFileIntegration(client, businessId);
    if(cancelled) return;
    const local=readQuickFileConnection(businessId);
    if(loaded.error){ quickFileReady.current=true; return; }
    if(loaded.status==='connected'&&loaded.connection){
      const cloudAt=Date.parse(loaded.connection.connectedAt||'')||0;
      const localAt=Date.parse(local.connectedAt||'')||0;
      if(!isQuickFileConnected(local)||cloudAt>=localAt) setQuickFile(loaded.connection);
      else void saveQuickFileIntegration(client, businessId, local);
    }else if(loaded.status==='disconnected'){
      const localAt=Date.parse(local.connectedAt||'')||0;
      const clearedAt=Date.parse(loaded.updatedAt||'')||0;
      if(isQuickFileConnected(local)&&localAt>clearedAt) void saveQuickFileIntegration(client, businessId, local);
      else if(isQuickFileConnected(local)) setQuickFile(current=>({...current,apiKey:'',connectedAt:null}));
    }else if(isQuickFileConnected(local)){
      void saveQuickFileIntegration(client, businessId, local);
    }
    quickFileReady.current=true;
  })();
  return ()=>{ cancelled=true; };
 },[businessId]);
 useEffect(()=>{
  if(!businessId||!supabase||!quickFileReady.current||!isQuickFileConnected(quickFile)) return;
  const client=supabase;
  const handle=window.setTimeout(()=>{ void saveQuickFileIntegration(client, businessId, quickFile); },500);
  return ()=>{ window.clearTimeout(handle); };
 },[quickFile,businessId]);
 useEffect(()=>{ if(businessId&&!remoteReady) return; writeInvoiceCache(businessId, invoices); },[invoices,businessId,remoteReady]);
 useEffect(()=>{
  if(!remoteReady||!invoices.length||!appointments.length) return;
  const settled=settleInvoicedVisits(appointments, invoices, id=>customers.find(customer=>customer.id===id)?.name||'');
  if(settled.removedIds.length) pendingCloudDeletes.current.push(...settled.removedIds.filter(id=>!pendingCloudDeletes.current.includes(id)));
  if(settled.appointments!==appointments) setAppointments(settled.appointments);
  if(settled.invoices!==invoices){
    setInvoices(settled.invoices);
    if(businessId&&supabase) void saveInvoices(supabase, businessId, settled.invoices.filter(row=>{
      const previous=invoices.find(invoice=>invoice.quickfileInvoiceId===row.quickfileInvoiceId);
      return !previous||previous.appointmentId!==row.appointmentId;
    }));
  }
 },[appointments,invoices,customers,remoteReady,businessId]);
 useEffect(()=>{document.body.style.overflow=menuOpen?'hidden':'';return()=>{document.body.style.overflow='';};},[menuOpen]);
 useEffect(()=>{
  if(!businessId || !supabase){setRemoteReady(true);return;}
  const client=supabase;
  let cancelled=false;
  let ticket=0;
  const load=async(background:boolean)=>{
   const mine=++ticket;
   if(!background){setRemoteReady(false); setRemoteError(''); setLoadProgress(''); setCloudStatus('Loading your workspace…');}
   else setCloudStatus('Checking for updates…');
   try {
    const [customerResult,addressResult,appointmentResult,serviceResult,paymentResult]=await Promise.all([
     fetchAllRows(client,'customers',businessId,['full_name','id']),
     fetchAllRows(client,'customer_addresses',businessId,['id']),
     fetchAllRows(client,'appointments',businessId,['starts_at','id'],(loaded,total)=>{
      if(cancelled||mine!==ticket) return;
      setLoadProgress(total!=null?`Loading appointments ${loaded.toLocaleString('en-GB')} / ${total.toLocaleString('en-GB')}`:`Loading appointments ${loaded.toLocaleString('en-GB')}`);
     }),
     fetchAllRows(client,'services',businessId,['name','id']),
     fetchAllRows(client,'payments',businessId,['id'])
    ]);
    const failure=customerResult.error||addressResult.error||appointmentResult.error||serviceResult.error||paymentResult.error;
    if(failure) throw new Error(failure.message);
    if(cancelled||mine!==ticket)return;
    const addresses=(addressResult.data??[]) as Array<{id:string;customer_id:string;address_line_1:string;town:string|null;postcode:string;access_notes:string|null}>;
    const loadedCustomers:Customer[]=applyServiceMap((customerResult.data??[]).map((r:any)=>{const a=addresses.find(x=>x.customer_id===r.id);return normalizeCustomer({id:r.id,name:r.full_name,email:r.email??'',phone:r.phone??'',phone2:r.phone_secondary??'',address:a?.address_line_1??'',town:a?.town??'',postcode:a?.postcode??'',price:Number(r.standard_price??0),duration:Number(r.service_duration_minutes||0),frequency:Number(r.frequency_weeks??6),notes:r.notes??a?.access_notes??'',service:r.preferred_service??'',serviceLines:r.assigned_services,archived:Boolean(r.archived),quickfileClientId:r.quickfile_client_id==null?null:Number(r.quickfile_client_id)||null});}), businessId);
    const loadedAppointments:Appointment[]=(appointmentResult.data??[]).map((r:any)=>{const start=new Date(r.starts_at);const meta=unpackApptNotes(r.internal_notes??'');return {id:r.id,customerId:r.customer_id,date:iso(start),time:`${String(start.getHours()).padStart(2,'0')}:${String(start.getMinutes()).padStart(2,'0')}`,duration:Math.max(5,Math.round((new Date(r.ends_at).getTime()-start.getTime())/60000)),service:r.service_name_snapshot,price:Number(r.price_snapshot),status:(String(r.status).charAt(0).toUpperCase()+String(r.status).slice(1)) as Appointment['status'],address:r.address_snapshot,notes:meta.notes,oneOff:meta.oneOff,frequency:meta.frequency,setmoreBookingId:meta.setmoreBookingId||undefined,quickfileInvoiceId:r.quickfile_invoice_id!=null?Number(r.quickfile_invoice_id):(meta.quickfileInvoiceId??null),quickfileInvoiceNumber:r.quickfile_invoice_number??meta.quickfileInvoiceNumber??null,quickfileInvoicedAt:r.quickfile_invoiced_at?String(r.quickfile_invoiced_at):meta.quickfileInvoicedAt??null,missingFromSetmore:meta.missingFromSetmore||undefined};});
    const loadedServices:Service[]=withServiceColors((serviceResult.data??[]).map((r:any)=>({name:r.name,duration:Number(r.default_duration_minutes),price:Number(r.default_price),color:r.color||undefined})));
    const loadedPayments:Payment[]=(paymentResult.data??[]).map((r:any)=>({id:r.id,appointmentId:r.appointment_id,amount:Number(r.amount),paidAt:r.paid_at?String(r.paid_at).slice(0,10):null,method:r.method??'cash'}));
    const cachedCustomers=readWorkspaceStore('cs_customers', businessId, [] as Customer[]);
    const cachedAppointments=readWorkspaceStore('cs_appointments', businessId, [] as Appointment[]);
    const cachedPayments=readWorkspaceStore('cs_payments', businessId, [] as Payment[]);
    const cachedServices=readWorkspaceStore('cs_services', businessId, [] as Service[]);
    const pendingAppointmentIds=new Set(readWorkspaceStore('cs_pending_appointments', businessId, [] as string[]));
    const pendingCustomerIds=new Set(readWorkspaceStore('cs_pending_customers', businessId, [] as string[]));
    if(background){
      for(const appointment of appointmentsRef.current){
        if(syncedAppointmentSig.current.get(appointment.id)!==appointmentSig(appointment)) pendingAppointmentIds.add(appointment.id);
      }
      for(const customer of customersRef.current){
        if(!syncedCustomerIds.current.has(customer.id)) pendingCustomerIds.add(customer.id);
        else {
          const cloud=loadedCustomers.find(row=>row.id===customer.id);
          if(cloud&&customerSyncSig(customer)!==customerSyncSig(cloud)) pendingCustomerIds.add(customer.id);
        }
      }
    }
    const localAppointments=background?appointmentsRef.current:cachedAppointments;
    const mergedAppointments=resolveAppointmentsLoad(loadedAppointments, localAppointments, pendingAppointmentIds);
    const mergedPayments=mergeById(loadedPayments, cachedPayments.filter(payment=>pendingAppointmentIds.has(payment.appointmentId)||loadedPayments.some(row=>row.id===payment.id)));
    const deduped=dedupeAppointments(mergedAppointments, mergedPayments, new Set(appointmentsRef.current.map(a=>a.id)));
    const cloudAppointmentIds=new Set(loadedAppointments.map(a=>a.id));
    for(const id of deduped.removedIds){
      if(cloudAppointmentIds.has(id)&&!pendingCloudDeletes.current.includes(id)) pendingCloudDeletes.current.push(id);
    }
    const finalAppointments=resolveOverlappingAppointments(deduped.appointments);
    const cachedNormalized=cachedCustomers.map(c=>normalizeCustomer(c));
    const finalCustomers=mergeCustomerLists(loadedCustomers, background?customersRef.current:cachedNormalized, pendingCustomerIds);
    const ownedCustomerIds=new Set(finalCustomers.map(c=>c.id));
    const ownedAppointments=finalAppointments.filter(a=>ownedCustomerIds.has(a.customerId));
    const ownedAppointmentIds=new Set(ownedAppointments.map(a=>a.id));
    const finalPayments=deduped.payments.filter(p=>ownedAppointmentIds.has(p.appointmentId));
    const finalServices=loadedServices.length?loadedServices:withServiceColors(cachedServices.length?cachedServices:defaultServices);
    const restoredFromCache=ownedAppointments.some(a=>!cloudAppointmentIds.has(a.id))||finalCustomers.some(c=>!loadedCustomers.some(row=>row.id===c.id));
    const withInferred=finalCustomers.map(c=>{ if(customerServiceNames(c).length) return c; const last=ownedAppointments.filter(a=>a.customerId===c.id&&a.status!=='Cancelled').sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time))[0]; return last?withServiceLines(c,[{service:last.service,price:last.price,duration:last.duration,frequency:last.frequency||c.frequency||6,oneOff:last.oneOff}]):c; });
    const cloudAppointmentSig=new Map(loadedAppointments.map(a=>[a.id, appointmentSig(a)]));
    for(const customer of withInferred){ if(loadedCustomers.some(row=>row.id===customer.id)) syncedCustomerIds.current.add(customer.id); }
    for(const appointment of ownedAppointments){
      const original=cloudAppointmentSig.get(appointment.id);
      if(original&&original===appointmentSig(appointment)) syncedAppointmentSig.current.set(appointment.id, original);
    }
    const cloudPaymentIds=new Set(loadedPayments.map(p=>p.id));
    for(const payment of finalPayments){ if(cloudPaymentIds.has(payment.id)) syncedPaymentSig.current.set(payment.id, paymentSig(payment)); }
    const unchanged=background
      && sameById(appointmentsRef.current, ownedAppointments, appointmentSig)
      && sameById(paymentsRef.current, finalPayments, paymentSig)
      && sameById(customersRef.current, withInferred, customerSyncSig)
      && sameById(servicesRef.current.map(service=>({...service,id:service.name})), finalServices.map(service=>({...service,id:service.name})), serviceSyncSig);
    if(unchanged&&pendingCloudDeletes.current.length===0){ setLoadProgress(''); setCloudStatus('Connected to Supabase'); return; }
    setCustomers(withInferred); setAppointments(ownedAppointments); setPayments(finalPayments); setServices(finalServices); persistCustomerServices(withInferred,businessId);
    writeWorkspaceStore('cs_customers',businessId,withInferred);
    writeWorkspaceStore('cs_appointments',businessId,ownedAppointments);
    writeWorkspaceStore('cs_payments',businessId,finalPayments);
    writeWorkspaceStore('cs_services',businessId,finalServices);
    const derivedInvoices=invoicesFromAppointments(ownedAppointments, withInferred, finalPayments);
    const invoiceLoad=await loadInvoices(client, businessId);
    if(invoiceLoad.error){
      const localInvoices=combineInvoiceSources([], readInvoiceCache(businessId), derivedInvoices);
      setInvoices(localInvoices);
      writeInvoiceCache(businessId, localInvoices);
      if(/invoices|schema cache|relation/i.test(invoiceLoad.error)) setInvoiceNotice('Invoices already created are listed here. Run supabase/migrations/010_invoices_and_webhook.sql in the Supabase SQL editor so other devices and QuickFile payment updates can use the same register.');
    }else{
      const combined=combineInvoiceSources(invoiceLoad.rows, readInvoiceCache(businessId), derivedInvoices);
      setInvoices(combined);
      writeInvoiceCache(businessId, combined);
      setInvoiceNotice('');
      const known=new Set(invoiceLoad.rows.map(row=>row.quickfileInvoiceId));
      const missing=combined.filter(row=>!known.has(row.quickfileInvoiceId));
      if(missing.length) void saveInvoices(client, businessId, missing);
    }
    setLoadProgress('');
    setCloudStatus(restoredFromCache&&!background?'Restored local schedule · syncing to Supabase…':'Connected to Supabase');
    if(!background) setRemoteReady(true);
   } catch(error) {
    if(cancelled||mine!==ticket)return;
    const message=error instanceof Error?error.message:'Could not load the Supabase workspace.';
    if(!background){ setRemoteError(message); setCloudStatus('Connection error'); }
    else { setCloudStatus('Could not refresh'); setNotice('Could not refresh appointments from Supabase: '+message); setTimeout(()=>setNotice(''),7000); }
   }
  };
  void load(false);
  const onVisible=()=>{ if(document.visibilityState==='visible' && remoteReadyRef.current) void load(true); };
  document.addEventListener('visibilitychange', onVisible);
  return ()=>{cancelled=true; document.removeEventListener('visibilitychange', onVisible);};
 },[businessId]);
 useEffect(()=>{
  if(!businessId||!supabase||!remoteReady)return;
  const client=supabase;
  const timer=window.setTimeout(()=>{
   const save=async()=>{
    setCloudStatus('Saving changes…');
    // Always keep a local backup first so HMR / reload cannot wipe the workspace.
    const ownedCustomerIds=new Set(customers.map(c=>c.id));
    const ownedAppointments=appointments.filter(a=>ownedCustomerIds.has(a.customerId));
    const ownedAppointmentIds=new Set(ownedAppointments.map(a=>a.id));
    const pendingCustomers=customers.filter(c=>!syncedCustomerIds.current.has(c.id)).map(c=>c.id);
    const pendingAppointments=ownedAppointments.filter(a=>syncedAppointmentSig.current.get(a.id)!==appointmentSig(a)).map(a=>a.id);
    writeWorkspaceStore('cs_pending_customers',businessId,pendingCustomers);
    writeWorkspaceStore('cs_pending_appointments',businessId,pendingAppointments);
    writeWorkspaceStore('cs_customers',businessId,customers);
    writeWorkspaceStore('cs_appointments',businessId,ownedAppointments);
    writeWorkspaceStore('cs_payments',businessId,payments.filter(p=>ownedAppointmentIds.has(p.appointmentId)));
    writeWorkspaceStore('cs_services',businessId,services);
    const errors:string[]=[];
    const allowedFrequency=[4,6,8,10,12] as const;
    // Persist past-customer status in notes too, so it survives even if the `archived` column is missing.
    // Do not send phone_secondary — many projects lack migration 008; phone2 is packed into notes instead.
    const customerRows=customers.map(c=>({id:c.id,business_id:businessId,full_name:c.name,email:c.email||null,phone:c.phone||null,notes:packCustomerNotes(c.notes,Boolean(c.archived),c.phone2),standard_price:Number.isFinite(c.price)?c.price:0,frequency_weeks:(allowedFrequency as readonly number[]).includes(Number(c.frequency))?Number(c.frequency):6,preferred_service:c.service||null,service_duration_minutes:c.duration||null,assigned_services:c.serviceLines?.length?c.serviceLines:null,archived:Boolean(c.archived),quickfile_client_id:c.quickfileClientId??null}));
    const customerErr=await upsertInChunks(client,'customers',customerRows,'id');
    if(customerErr) errors.push('customers: '+customerErr);
    else { customers.forEach(c=>syncedCustomerIds.current.add(c.id)); writeWorkspaceStore('cs_pending_customers',businessId,[]); }
    const addressRows=customers.map(c=>({id:c.id,business_id:businessId,customer_id:c.id,label:'Home',address_line_1:c.address||'Address not provided',town:c.town||null,postcode:c.postcode||'UNKNOWN',access_notes:stripMetaMarkers(c.notes)||null}));
    const addressErr=await upsertInChunks(client,'customer_addresses',addressRows,'id');
    if(addressErr) errors.push('addresses: '+addressErr);
    const serviceRows=services.map(s=>({business_id:businessId,name:s.name,default_duration_minutes:s.duration,default_price:s.price,color:s.color||null,is_bookable_online:true,is_active:true}));
    const serviceErr=await upsertInChunks(client,'services',serviceRows,'business_id,name');
    if(serviceErr) errors.push('services: '+serviceErr);
    // Only sync appointments for customers we just upserted — avoids FK 409 on customer_id.
    // Leave address_id null; address_snapshot carries the property text (avoids address FK 409).
    const customerIds=new Set(customers.map(c=>c.id));
    const dirtyAppointments=appointments.filter(a=>syncedAppointmentSig.current.get(a.id)!==appointmentSig(a));
    const appointmentRows=dirtyAppointments.filter(a=>customerIds.has(a.customerId)).map(a=>{
      const durationMins=Math.max(5, Number(a.duration)||30);
      const start=new Date(`${a.date}T${a.time}:00`);
      if(Number.isNaN(start.getTime())) return null;
      const end=new Date(start.getTime()+durationMins*60000);
      if(!(end.getTime()>start.getTime())) return null;
      const statusRaw=String(a.status||'confirmed').toLowerCase();
      const status=['pending','confirmed','completed','cancelled'].includes(statusRaw)?statusRaw:'confirmed';
      return {id:a.id,business_id:businessId,customer_id:a.customerId,address_id:null,starts_at:start.toISOString(),ends_at:end.toISOString(),status,service_name_snapshot:a.service||'Service',price_snapshot:Number.isFinite(a.price)?Math.max(0,a.price):0,address_snapshot:a.address||'Address not provided',customer_notes:null,internal_notes:packApptNotes(a.notes,Boolean(a.oneOff),Number(a.frequency)||6,{quickfileInvoiceId:a.quickfileInvoiceId,quickfileInvoiceNumber:a.quickfileInvoiceNumber,quickfileInvoicedAt:a.quickfileInvoicedAt},a.setmoreBookingId,a.missingFromSetmore),quickfile_invoice_id:a.quickfileInvoiceId??null,quickfile_invoice_number:a.quickfileInvoiceNumber??null,quickfile_invoiced_at:a.quickfileInvoicedAt??null,booking_source:'import'};
    }).filter((row):row is NonNullable<typeof row>=>Boolean(row?.customer_id&&row.starts_at&&row.ends_at));
    const appointmentErr=await upsertInChunks(client,'appointments',appointmentRows,'id');
    if(appointmentErr) errors.push('appointments: '+appointmentErr);
    else {
      const savedAppointmentIds=new Set(appointmentRows.map(r=>String(r.id)));
      for(const appointment of dirtyAppointments){ if(savedAppointmentIds.has(appointment.id)) syncedAppointmentSig.current.set(appointment.id, appointmentSig(appointment)); }
      writeWorkspaceStore('cs_pending_appointments',businessId,ownedAppointments.filter(a=>syncedAppointmentSig.current.get(a.id)!==appointmentSig(a)).map(a=>a.id));
    }
    const paymentParentIds=new Set(syncedAppointmentSig.current.keys());
    const dirtyPayments=payments.filter(p=>paymentParentIds.has(p.appointmentId)&&syncedPaymentSig.current.get(p.id)!==paymentSig(p));
    const paymentRows=dirtyPayments.map(p=>({id:p.id,business_id:businessId,appointment_id:p.appointmentId,amount:p.amount,paid_at:p.paidAt?`${p.paidAt}T12:00:00.000Z`:null,method:p.method||'cash'}));
    const deleteIds=[...pendingCloudDeletes.current];
    if(!appointmentErr && deleteIds.length){
      const deleted=new Set<string>();
      for(let i=0;i<deleteIds.length;i+=80){
        const chunk=deleteIds.slice(i,i+80);
        const {error:deleteErr}=await client.from('appointments').delete().eq('business_id',businessId).in('id',chunk);
        if(deleteErr) errors.push('appointments delete: '+deleteErr.message);
        else chunk.forEach(id=>{deleted.add(id); syncedAppointmentSig.current.delete(id);});
      }
      pendingCloudDeletes.current=pendingCloudDeletes.current.filter(id=>!deleted.has(id));
    }
    const paymentErr=await upsertInChunks(client,'payments',paymentRows,'id');
    if(paymentErr) errors.push('payments: '+paymentErr);
    else { for(const payment of dirtyPayments) syncedPaymentSig.current.set(payment.id, paymentSig(payment)); }
    if(errors.length){
      const message=errors.join(' · ');
      setCloudStatus('Save partially failed');
      setRemoteError(message);
      setNotice('Supabase save issue (data kept locally): '+message);
      setTimeout(()=>setNotice(''),9000);
    } else {
      setRemoteError('');
      setCloudStatus('All changes saved');
    }
   };
   syncQueue.current=syncQueue.current.then(save).catch(error=>{const message=error instanceof Error?error.message:'Could not save changes to Supabase.';setCloudStatus('Save failed');setRemoteError(message);setNotice('Supabase save failed (data kept locally): '+message);setTimeout(()=>setNotice(''),7000);});
  },450);
  return ()=>window.clearTimeout(timer);
 },[customers,appointments,payments,services,businessId,remoteReady]);
 useEffect(()=>{
  const ids=new Set(customers.map(customer=>customer.id));
  if(!appointments.some(appointment=>!ids.has(appointment.customerId))) return;
  const keptIds=new Set(appointments.filter(appointment=>ids.has(appointment.customerId)).map(appointment=>appointment.id));
  setAppointments(prev=>prev.filter(appointment=>ids.has(appointment.customerId)));
  setPayments(prev=>prev.filter(payment=>keptIds.has(payment.appointmentId)));
 },[customers,appointments]);
 const todayAppointments=useMemo(()=>appointments.filter(a=>a.date===selectedDate&&a.status!=='Cancelled').sort((a,b)=>a.time.localeCompare(b.time)),[appointments,selectedDate]);
 const todaysTotal=todayAppointments.reduce((s,a)=>s+a.price,0);
 const activeCustomers=customers.filter(c=>!c.archived);
 const plannedSetmoreSet=useMemo(()=>new Set(plannedSetmoreIds),[plannedSetmoreIds]);
 const unplannedCustomers=useMemo(()=>{
  const today=addDays(0);
  const booked=new Set<string>();
  const lastVisit=new Map<string,string>();
  for(const appointment of appointments){
    if(appointment.status==='Cancelled') continue;
    if(appointment.date>=today) booked.add(appointment.customerId);
    else{
      const prev=lastVisit.get(appointment.customerId);
      if(!prev||appointment.date>prev) lastVisit.set(appointment.customerId, appointment.date);
    }
  }
  return {booked,lastVisit,customers:customers.filter(c=>!c.archived&&!booked.has(c.id))};
 },[customers,appointments]);
 const overdue=unplannedCustomers.customers.filter(c=>!plannedSetmoreSet.has(c.id));
 const setmorePlanRows=useMemo<SetmorePlanCustomer[]>(()=>unplannedCustomers.customers.map(customer=>{
  const cycles=customerPlanCycles(customer);
  return {id:customer.id,name:customer.name,place:[customer.town,customer.postcode].filter(Boolean).join(' · '),cycles,cycleLabel:planCycleLabel(cycles),lastVisit:unplannedCustomers.lastVisit.get(customer.id)||null,planned:plannedSetmoreSet.has(customer.id)};
 }).sort((a,b)=>a.name.localeCompare(b.name,'en')),[unplannedCustomers,plannedSetmoreSet]);
 const overdueFiltered=useMemo(()=>{
  const q=scheduleSearch.trim().toLowerCase();
  if(!q) return overdue;
  return overdue.filter(c=>(c.name+' '+c.address+' '+c.town+' '+c.postcode+' '+c.email+' '+c.phone+' '+c.phone2+' '+c.notes).toLowerCase().includes(q));
 },[overdue,scheduleSearch]);
 const mainServiceName=services.some(s=>s.name===settings.mainService)?settings.mainService:(services[0]?.name||'');
 const customerMatchesSearchAndCycle=(c:Customer)=>{
  const serviceNames=customerServiceNames(c);
  const hay=(c.name+' '+c.address+' '+c.town+' '+c.postcode+' '+c.email+' '+c.phone+' '+c.phone2+' '+c.notes+' '+serviceNames.join(' ')).toLowerCase();
  const matchSearch=!search.trim()||hay.includes(search.toLowerCase());
  const matchCycle=customerFilter==='All customers'||(c.serviceLines?.length
    ? c.serviceLines.some(line=>!line.oneOff&&`${line.frequency||c.frequency||6} weeks`===customerFilter)
    : `${c.frequency} weeks`===customerFilter);
  return matchSearch&&matchCycle;
 };
 const filteredCustomers=customers.filter(c=>{
  if(Boolean(c.archived)!==(customerListMode==='Past')) return false;
  if(!customerMatchesSearchAndCycle(c)) return false;
  const serviceNames=customerServiceNames(c);
  if(serviceFilter==='All services') return true;
  if(serviceFilter==='Unassigned') return serviceNames.length===0;
  return serviceNames.includes(serviceFilter);
 });
 const listedCustomers=useMemo(()=>[...filteredCustomers].sort((a,b)=>a.name.localeCompare(b.name)),[filteredCustomers]);
 const selectedListedIds=listedCustomers.map(c=>c.id).filter(id=>selectedCustomerIds.includes(id));
 const customerServicesLabel=(c:Customer)=>{
  const names=customerServiceNames(c);
  if(!names.length) return 'Unassigned';
  if(names.length===1){
   const line=customerLineFor(c,names[0]);
   return line?`${names[0]} · ${serviceCycleLabel(line)}`:names[0];
  }
  return `${names.length} services`;
 };
 const customerName=(id:string)=>customers.find(c=>c.id===id)?.name??'Unknown customer';
 const customersForService=(serviceName:string)=>{
  const assigned=customers.filter(c=>!c.archived&&customerHasService(c,serviceName)).map(c=>{const line=customerLineFor(c,serviceName)!;return {...c,service:serviceName,price:line.price,duration:line.duration,frequency:line.frequency||6};});
  const fromJobs=new Set(appointments.filter(a=>a.service===serviceName&&a.status!=='Cancelled').map(a=>a.customerId));
  const merged=new Map(assigned.map(c=>[c.id,c]));
  customers.forEach(c=>{ if(fromJobs.has(c.id)&&!merged.has(c.id)){const line=customerLineFor(c,serviceName);merged.set(c.id,{...c,service:serviceName,price:line?.price??c.price,duration:line?.duration??c.duration,frequency:line?.frequency??c.frequency});} });
  return Array.from(merged.values()).sort((a,b)=>a.name.localeCompare(b.name));
 };
 const unassignedForService=(serviceName:string)=>{
  const list=customers.filter(c=>!c.archived&&!customerHasService(c,serviceName)&&!appointments.some(a=>a.customerId===c.id&&a.service===serviceName&&a.status!=='Cancelled'));
  // Prefer customers already on the main service so they are easy to add elsewhere
  return list.sort((a,b)=>{
   const aMain=mainServiceName&&customerHasService(a,mainServiceName)?0:1;
   const bMain=mainServiceName&&customerHasService(b,mainServiceName)?0:1;
   return aMain-bMain||a.name.localeCompare(b.name);
  });
 };
 const serviceJobValue=(serviceName:string)=>appointments.filter(a=>a.service===serviceName&&a.status!=='Cancelled').reduce((sum,a)=>sum+a.price,0);
 const defaultServiceName=mainServiceName||selectedService||services[0]?.name||'';
 const defaultService=services.find(s=>s.name===defaultServiceName)||services[0];
 const scheduleCustomer=scheduleCustomerId?customers.find(c=>c.id===scheduleCustomerId)??null:null;
 const lastVisitFor=(customerId:string)=>appointments.filter(a=>a.customerId===customerId&&a.status!=='Cancelled'&&a.date<=addDays(0)).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time))[0]??null;
 const lastVisit=scheduleCustomerId?lastVisitFor(scheduleCustomerId):null;
 const paymentFor=(appointmentId:string)=>payments.find(p=>p.appointmentId===appointmentId&&p.paidAt);
 const isPaid=(appointmentId:string)=>Boolean(paymentFor(appointmentId));
 const financeRange=useMemo(()=>periodRange(financePeriod),[financePeriod]);
 const financeJobs=useMemo(()=>appointments.filter(a=>a.status!=='Cancelled'&&a.status!=='Pending'&&a.date>=financeRange.start&&a.date<=financeRange.end).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)),[appointments,financeRange]);
 const financePaid=financeJobs.filter(a=>isPaid(a.id));
 const financeUnpaid=financeJobs.filter(a=>!isPaid(a.id));
 const financeBilled=financeJobs.reduce((s,a)=>s+a.price,0);
 const financeCollected=financePaid.reduce((s,a)=>s+a.price,0);
 const financeOutstanding=financeUnpaid.reduce((s,a)=>s+a.price,0);
 function openSchedule(customerId?:string){
  const date=selectedDate||addDays(0);
  setEditingAppointment(null);
  setScheduleCustomerId(customerId??null);
  setScheduleDate(date);
  setScheduleFormKey(k=>k+1);
  setShowAdd(true);
 }
function openEditAppointment(appointment:Appointment){
  setEditingAppointment(appointment);
  setScheduleCustomerId(appointment.customerId);
  setSelectedDate(appointment.date);
  setScheduleDate(appointment.date);
  setDayPanelOpen(true);
  setScheduleFormKey(k=>k+1);
  setShowAdd(true);
 }
 function openDay(date:string){setSelectedDate(date);setScheduleView('calendar');setCalendarMode('Day');setDayPanelOpen(false);}
 function moveAppointmentToDate(id:string, date:string){
  setAppointments(p=>{
   const current=p.find(a=>a.id===id); if(!current||current.date===date) return p;
   const others=p.filter(a=>a.id!==id);
   const updated={...current,date,time:nextAvailableTime(others,date)};
   return resolveOverlappingAppointments(cascadeFollowingAppointments([...others,updated],updated));
  });
  setSelectedDate(date); setDayPanelOpen(true); flash('Appointment moved.');
 }
 function swapAppointments(dragId:string, targetId:string){
  if(!dragId||!targetId||dragId===targetId) return;
  setAppointments(p=>{
   const a=p.find(x=>x.id===dragId); const b=p.find(x=>x.id===targetId);
   if(!a||!b) return p;
   return p.map(x=>{
    if(x.id===a.id) return {...x,date:b.date,time:b.time};
    if(x.id===b.id) return {...x,date:a.date,time:a.time};
    return x;
   });
  });
  flash('Appointments swapped.');
 }
 function quickBookOnDate(customerId:string, date:string){
  const customer=customers.find(c=>c.id===customerId); if(!customer) return;
  const service=customer.service||defaultServiceName;
  const line=customerLineFor(customer,service);
  const duration=line?.duration||customer.duration||defaultService?.duration||30;
  const price=line&&line.price>0?line.price:(customer.price>0?customer.price:(defaultService?.price??0));
  const time=nextAvailableTime(appointments,date);
  const oneOff=Boolean(line?.oneOff);
  const frequency=oneOff?6:(CYCLE_WEEKS.includes(Number(line?.frequency) as typeof CYCLE_WEEKS[number])?Number(line?.frequency):(customer.frequency||6));
  const created:Appointment={id:crypto.randomUUID(),customerId,date,time,duration,service,price,status:'Confirmed',address:customerProperty(customer),oneOff,frequency};
  setAppointments(p=>resolveOverlappingAppointments(cascadeFollowingAppointments([...p,created],created)));
  setSelectedDate(date); setDayPanelOpen(true); flash(`${customer.name} booked on ${dateLabel(date)}.`);
 }
 function onCalDragStart(e:{dataTransfer:DataTransfer}, payload:string){e.dataTransfer.setData('text/plain',payload);e.dataTransfer.effectAllowed='move';}
 function onDayDragOver(e:{preventDefault:()=>void;stopPropagation?:()=>void;dataTransfer:DataTransfer}){e.preventDefault();e.stopPropagation?.();e.dataTransfer.dropEffect='move';}
 function onDayDrop(e:{preventDefault:()=>void;stopPropagation:()=>void;dataTransfer:DataTransfer}, date:string){
  e.preventDefault(); e.stopPropagation();
  const raw=e.dataTransfer.getData('text/plain');
  if(raw.startsWith('appt:')) moveAppointmentToDate(raw.slice(5),date);
  else if(raw.startsWith('cust:')) quickBookOnDate(raw.slice(5),date);
 }
 function onApptDrop(e:{preventDefault:()=>void;stopPropagation:()=>void;dataTransfer:DataTransfer}, targetId:string){
  e.preventDefault(); e.stopPropagation();
  const raw=e.dataTransfer.getData('text/plain');
  if(raw.startsWith('appt:')){ swapAppointments(raw.slice(5),targetId); return; }
  if(raw.startsWith('cust:')){
   const target=appointments.find(a=>a.id===targetId);
   if(target) quickBookOnDate(raw.slice(5), target.date);
  }
 }
 function closeSchedule(){setShowAdd(false);setScheduleCustomerId(null);setEditingAppointment(null);}
 /** Prefill duration, price and cleaning cycle from the customer's saved service settings. */
 function applyAppointmentCustomerDefaults(customerId:string, opts?:{serviceName?:string; syncServiceSelect?:boolean}){
  const cust=customers.find(x=>x.id===customerId); if(!cust) return;
  const serviceSelect=document.querySelector('select[name=service]') as HTMLSelectElement|null;
  const priceInput=document.getElementById('appointment-price') as HTMLInputElement|null;
  const durationInput=document.getElementById('appointment-duration') as HTMLInputElement|null;
  const cycleInput=document.getElementById('appointment-cycle') as HTMLSelectElement|null;
  let service=opts?.serviceName||serviceSelect?.value||'';
  const syncService=opts?.syncServiceSelect!==false;
  if(syncService){
   if(!service||!customerHasService(cust,service)){
    service=cust.service||customerServiceNames(cust)[0]||service||defaultServiceName;
   }
   if(serviceSelect&&service) serviceSelect.value=service;
  }
  const line=customerLineFor(cust,service);
  const catalogItem=services.find(x=>x.name===service);
  if(durationInput) durationInput.value=String(line?.duration??catalogItem?.duration??(cust.duration||30));
  if(priceInput){
   const price=line&&line.price>0?line.price:(customerHasService(cust,service)&&cust.price>0?cust.price:(catalogItem?.price??0));
   priceInput.value=price>0?String(price):'';
  }
  if(cycleInput){
   if(line||customerHasService(cust,service)){
    if(line?.oneOff) cycleInput.value='oneoff';
    else{
     const freq=CYCLE_WEEKS.includes(Number(line?.frequency) as typeof CYCLE_WEEKS[number])?Number(line?.frequency):(CYCLE_WEEKS.includes(cust.frequency as typeof CYCLE_WEEKS[number])?cust.frequency:6);
     cycleInput.value=String(freq);
    }
   }else{
    cycleInput.value='oneoff';
   }
  }
 }
 const suggestedStartTime=editingAppointment?.time||nextAvailableTime(appointments,scheduleDate||selectedDate||addDays(0));
 function flash(s:string, ms=4500){setNotice(s);window.setTimeout(()=>setNotice(''),ms)}
 function jobOutcome(appointment:Appointment):'todo'|'done'|'paid'{
  if(isPaid(appointment.id)) return 'paid';
  if(appointment.status==='Completed'||appointment.quickfileInvoiceId) return 'done';
  return 'todo';
 }
 function sameDayOpenJobs(appointment:Appointment){
  return appointments
    .filter(job=>job.customerId===appointment.customerId&&job.date===appointment.date&&job.status!=='Cancelled'&&!job.quickfileInvoiceId)
    .sort((a,b)=>a.time.localeCompare(b.time)||a.id.localeCompare(b.id));
 }
 function serviceChoiceKey(name:string){return name.trim().toLowerCase();}
 function invoiceChoiceItems(appointment:Appointment){
  const customer=customers.find(c=>c.id===appointment.customerId);
  const jobs=sameDayOpenJobs(appointment);
  const items=jobs.map(job=>({
    key:`job:${job.id}`,
    appointmentId:job.id as string|null,
    service:job.service,
    detail:job.time,
    price:Number(job.price)||0,
    description:job.address||'',
    date:job.date,
  }));
  const taken=new Set(items.map(item=>serviceChoiceKey(item.service)));
  for(const job of appointments){
    if(job.customerId!==appointment.customerId||job.date!==appointment.date||!job.quickfileInvoiceId) continue;
    taken.add(serviceChoiceKey(job.service));
  }
  const address=customer?customerProperty(customer):(appointment.address||'');
  for(const line of customer?.serviceLines||[]){
    const name=line.service.trim();
    if(!name||taken.has(serviceChoiceKey(name))) continue;
    taken.add(serviceChoiceKey(name));
    items.push({
      key:`line:${name}`,
      appointmentId:null,
      service:name,
      detail:'On the customer',
      price:Number(line.price)||0,
      description:address,
      date:appointment.date,
    });
  }
  return items;
 }
 function openInvoiceChoice(appointment:Appointment){
  const items=invoiceChoiceItems(appointment);
  if(!items.length) return false;
  setInvoiceChoiceKeys(items.filter(item=>item.appointmentId).map(item=>item.key));
  setInvoiceChoiceId(appointment.id);
  closeSchedule();
  return true;
 }
 function closeInvoiceChoice(){
  if(invoicingAppointmentId) return;
  setInvoiceChoiceId(null);
  setInvoiceChoiceKeys([]);
 }
 function beginInvoice(appointment:Appointment){
  if(invoicingAppointmentId) return;
  if(appointment.quickfileInvoiceId){
    flash(appointment.quickfileInvoiceId<0?'Already invoiced locally.':`Already invoiced as ${appointment.quickfileInvoiceNumber||appointment.quickfileInvoiceId}.`);
    return;
  }
  if(openInvoiceChoice(appointment)) return;
  flash('Could not prepare an invoice for this visit.');
 }
 async function createInvoiceForAppointments(jobs:Appointment[], extraLines:{service:string;description:string;price:number;date:string}[]=[], where:'quickfile'|'local'='quickfile'){
  const pending=jobs.filter(job=>!job.quickfileInvoiceId);
  const extras=extraLines.filter(line=>line.service.trim());
  if(!pending.length) return false;
  if(where==='quickfile'&&!isQuickFileConnected(quickFile)){
    flash('Connect QuickFile in Settings, or keep this invoice local.');
    return false;
  }
  const customer=customers.find(c=>c.id===pending[0].customerId);
  if(!customer){
    flash('Customer not found for this appointment.');
    return false;
  }
  setInvoicingAppointmentId(pending[0].id);
  try{
    const lines=[
      ...pending.map(job=>({
        service:job.service,
        description:job.address||'',
        price:job.price,
        date:job.date,
      })),
      ...extras.map(line=>({
        service:line.service,
        description:line.description,
        price:line.price,
        date:line.date,
      })),
    ];
    let invoiceId:number;
    let invoiceNumber:string;
    if(where==='local'){
      invoiceId=-((Date.now()%1_000_000_000)*1000+Math.floor(Math.random()*1000)+1);
      invoiceNumber='Local';
    }else{
      const result=await createQuickFileInvoiceRequest(quickFile,{
        client:{
          name:customer.name,
          email:customer.email,
          phone:customer.phone,
          phone2:customer.phone2,
          address:customer.address,
          town:customer.town,
          postcode:customer.postcode,
          quickfileClientId:customer.quickfileClientId,
        },
        lines,
      });
      invoiceId=result.invoiceId;
      invoiceNumber=result.invoiceNumber;
      setCustomers(p=>p.map(c=>c.id===customer.id?{...c,quickfileClientId:result.clientId}:c));
    }
    const invoicedAt=new Date().toISOString();
    const ids=new Set(pending.map(job=>job.id));
    const stamped=(job:Appointment):Appointment=>({
      ...job,
      status:'Completed',
      quickfileInvoiceId:invoiceId,
      quickfileInvoiceNumber:invoiceNumber,
      quickfileInvoicedAt:invoicedAt,
    });
    setAppointments(p=>p.map(a=>ids.has(a.id)?stamped(a):a));
    setEditingAppointment(a=>a&&ids.has(a.id)?stamped(a):a);
    const lineCount=pending.length+extras.length;
    const amount=pending.reduce((sum,job)=>sum+(Number(job.price)||0),0)+extras.reduce((sum,line)=>sum+(Number(line.price)||0),0);
    const record:InvoiceRecord={
      id:crypto.randomUUID(),
      appointmentId:pending[0].id,
      customerName:customer.name,
      service:[...pending.map(job=>job.service),...extras.map(line=>line.service)].filter(Boolean).join(', '),
      address:pending[0].address||'',
      jobDate:pending[0].date,
      amount,
      quickfileInvoiceId:invoiceId,
      quickfileInvoiceNumber:invoiceNumber,
      source:where,
      issuedAt:invoicedAt,
      dueAt:invoiceDueAt(invoicedAt),
      status:'unpaid',
      paidAt:null,
      paidAmount:null,
      paymentMethod:null,
    };
    setInvoices(prev=>combineInvoiceSources([record], prev, []));
    if(businessId&&supabase){
      const saveError=await saveInvoices(supabase, businessId, [record]);
      if(saveError) setInvoiceNotice(where==='local'?'The local invoice could not be saved: '+saveError:'Invoice was created in QuickFile. The register could not be saved: '+saveError);
    }
    flash(where==='local'
      ?(lineCount>1?`Local invoice kept for ${lineCount} services.`:'Local invoice kept in MyPurePlan.')
      :(lineCount>1?`Invoice ${invoiceNumber} created for ${lineCount} services.`:`Invoice ${invoiceNumber} created in QuickFile.`));
    return true;
  }catch(error){
    flash(error instanceof Error?error.message:'Could not create the invoice.', 10000);
    return false;
  }finally{
    setInvoicingAppointmentId(null);
  }
 }
 async function confirmInvoiceChoice(where:'quickfile'|'local'){
  const anchor=appointments.find(job=>job.id===invoiceChoiceId);
  if(!anchor){closeInvoiceChoice();return;}
  const items=invoiceChoiceItems(anchor);
  const anchorKey=`job:${anchor.id}`;
  const selected=items.filter(item=>item.key===anchorKey||invoiceChoiceKeys.includes(item.key));
  const jobs=selected.flatMap(item=>{
    if(!item.appointmentId) return [];
    const job=appointments.find(row=>row.id===item.appointmentId);
    return job?[job]:[];
  });
  const extras=selected.filter(item=>!item.appointmentId).map(item=>({
    service:item.service,
    description:item.description,
    price:item.price,
    date:item.date,
  }));
  const created=await createInvoiceForAppointments(jobs.length?jobs:[anchor], extras, where);
  if(created){
    setInvoiceChoiceId(null);
    setInvoiceChoiceKeys([]);
  }
 }
 async function markJobCompleted(id:string){
  const appointment=appointments.find(a=>a.id===id);
  if(!appointment) return;
  if(!appointment.quickfileInvoiceId&&openInvoiceChoice(appointment)) return;
  setAppointments(p=>p.map(a=>a.id===id?{...a,status:'Completed'}:a));
  setEditingAppointment(a=>a&&a.id===id?{...a,status:'Completed'}:a);
  flash('Marked as done.');
 }
 async function testAndSaveQuickFile(next:QuickFileConnection){
  setQuickFileBusy(true);
  try{
    await testQuickFileConnection(next);
    const saved={...next,accNumber:next.accNumber.trim(),apiKey:next.apiKey.trim(),applicationId:next.applicationId.trim(),webhookSecret:next.webhookSecret.trim(),connectedAt:new Date().toISOString()};
    setQuickFile(saved);
    if(businessId&&supabase){
      const saveError=await saveQuickFileIntegration(supabase, businessId, saved);
      if(saveError) flash('QuickFile connected on this device, but it was not saved to your account: '+saveError, 10000);
      else flash(saved.webhookSecret?'QuickFile connected and saved to your account. Payment notifications are ready.':'QuickFile connected and saved to your account.');
    }else flash('QuickFile connected on this device.');
  }catch(error){
    setQuickFile(s=>({...s,...next,connectedAt:null}));
    flash(error instanceof Error?error.message:'Could not connect to QuickFile.');
  }finally{
    setQuickFileBusy(false);
  }
 }
 async function saveWebhookSecret(){
  const secret=quickFile.webhookSecret.trim();
  const accNumber=quickFile.accNumber.trim();
  const next={...quickFile,accNumber,webhookSecret:secret};
  setQuickFile(next);
  if(!businessId||!supabase){flash('Sign in so MyPurePlan can match QuickFile payments to this business.');return;}
  if(!accNumber||!secret){flash('Enter the QuickFile account number and webhook secret first.');return;}
  const saveError=await saveQuickFileIntegration(supabase, businessId, next);
  flash(saveError?saveError:'Webhook secret saved. QuickFile can now mark invoices paid.', 7000);
 }
 async function disconnectQuickFile(){
  const next={...quickFile,apiKey:'',connectedAt:null};
  setQuickFile(next);
  if(businessId&&supabase){
    const saveError=await saveQuickFileIntegration(supabase, businessId, next);
    flash(saveError?'Disconnected on this device, but the saved connection could not be cleared: '+saveError:'QuickFile disconnected.');
    return;
  }
  flash('QuickFile disconnected on this device.');
 }
 async function markJobNotDone(id:string){
  const existing=payments.find(p=>p.appointmentId===id);
  if(existing){
    if(businessId&&supabase){const {error}=await supabase.from('payments').delete().eq('business_id',businessId).eq('id',existing.id);if(error){flash('Could not remove payment from the database.');return;}}
    setPayments(p=>p.filter(x=>x.id!==existing.id));
  }
  setAppointments(p=>p.map(a=>a.id===id?{...a,status:a.status==='Pending'?'Pending':'Confirmed'}:a));
  setEditingAppointment(a=>a&&a.id===id?{...a,status:a.status==='Pending'?'Pending':'Confirmed'}:a);
  flash('Marked as not done.');
 }
 function jobsSharingInvoice(appointment:Appointment){
  if(!appointment.quickfileInvoiceId) return [appointment];
  const group=appointments.filter(job=>job.quickfileInvoiceId===appointment.quickfileInvoiceId&&job.status!=='Cancelled');
  return group.length?group.sort((a,b)=>a.time.localeCompare(b.time)||a.id.localeCompare(b.id)):[appointment];
 }
 async function checkQuickFilePayments(){
  if(!isQuickFileConnected(quickFile)){flash('Connect QuickFile in Settings before checking payments.');return;}
  const open=invoices.filter(row=>row.status==='unpaid'&&row.quickfileInvoiceId>0&&row.source!=='local');
  if(!open.length){flash('No open QuickFile invoices to check.');return;}
  setCheckingQuickFile(true);
  try{
    const found=await checkQuickFileInvoices(quickFile, open.map(row=>row.quickfileInvoiceId));
    const byId=new Map(found.invoices.map(item=>[item.invoiceId, item]));
    const paidAtFallback=addDays(0);
    const changed:InvoiceRecord[]=[];
    const nextInvoices=invoices.map(row=>{
      const item=byId.get(row.quickfileInvoiceId);
      if(!item||row.status!=='unpaid') return row;
      if(item.state==='paid'){
        const next:InvoiceRecord={...row,status:'paid',paidAt:item.paidAt||paidAtFallback,paidAmount:item.paidAmount??row.amount,paymentMethod:'quickfile'};
        changed.push(next);
        return next;
      }
      if(item.state==='void'){
        const next:InvoiceRecord={...row,status:'void',paidAt:null,paidAmount:null,paymentMethod:null};
        changed.push(next);
        return next;
      }
      return row;
    });
    const paidIds=new Set(changed.filter(row=>row.status==='paid').map(row=>row.quickfileInvoiceId));
    if(paidIds.size){
      setPayments(prev=>{
        const next=prev.map(payment=>({...payment}));
        for(const job of appointments){
          if(!job.quickfileInvoiceId||!paidIds.has(job.quickfileInvoiceId)||job.status==='Cancelled') continue;
          const paidAt=changed.find(row=>row.quickfileInvoiceId===job.quickfileInvoiceId)?.paidAt||paidAtFallback;
          const existing=next.find(payment=>payment.appointmentId===job.id);
          if(existing){existing.paidAt=paidAt;existing.method='quickfile';existing.amount=job.price;}
          else next.push({id:crypto.randomUUID(),appointmentId:job.id,amount:job.price,paidAt,method:'quickfile'});
        }
        return next;
      });
      setAppointments(prev=>prev.map(job=>job.quickfileInvoiceId&&paidIds.has(job.quickfileInvoiceId)&&job.status!=='Cancelled'&&job.status!=='Completed'?{...job,status:'Completed'}:job));
    }
    if(changed.length){
      setInvoices(nextInvoices);
      if(businessId&&supabase){
        const saveError=await saveInvoices(supabase, businessId, changed);
        if(saveError){flash('QuickFile was checked, but the register was not saved: '+saveError);return;}
      }
    }
    const paidCount=changed.filter(row=>row.status==='paid').length;
    const voidCount=changed.filter(row=>row.status==='void').length;
    const partCount=found.invoices.filter(item=>item.state==='part').length;
    if(!paidCount&&!voidCount&&!partCount) flash('QuickFile still shows these invoices as unpaid.');
    else flash(['Checked QuickFile.', paidCount?`${paidCount} marked paid`:'', partCount?`${partCount} part-paid`:'', voidCount?`${voidCount} void in QuickFile`:''].filter(Boolean).join(' '));
  }catch(error){
    flash(error instanceof Error?error.message:'Could not check QuickFile.');
  }finally{
    setCheckingQuickFile(false);
  }
 }
 async function markJobPaid(appointment:Appointment, method='cash'){
  if(jobOutcome(appointment)==='todo'){flash('Mark the job as done before taking payment.');return;}
  const targets=jobsSharingInvoice(appointment);
  const paidAt=addDays(0);
  const ids=new Set(targets.map(job=>job.id));
  setPayments(prev=>{
    const next=prev.map(payment=>ids.has(payment.appointmentId)?{...payment,amount:targets.find(job=>job.id===payment.appointmentId)?.price??payment.amount,paidAt,method}:payment);
    for(const job of targets){
      if(!next.some(payment=>payment.appointmentId===job.id)) next.push({id:crypto.randomUUID(),appointmentId:job.id,amount:job.price,paidAt,method});
    }
    return next;
  });
  if(appointment.quickfileInvoiceId){
    const customer=customers.find(c=>c.id===appointment.customerId);
    const issued=appointment.quickfileInvoicedAt||new Date().toISOString();
    const amount=targets.reduce((sum,job)=>sum+(Number(job.price)||0),0);
    const record:InvoiceRecord={id:crypto.randomUUID(),appointmentId:targets[0].id,customerName:customer?.name||'Customer',service:targets.map(job=>job.service).filter(Boolean).join(', '),address:targets[0].address||'',jobDate:targets[0].date,amount,quickfileInvoiceId:appointment.quickfileInvoiceId,quickfileInvoiceNumber:appointment.quickfileInvoiceNumber||null,source:appointment.quickfileInvoiceId<0?'local':'quickfile',issuedAt:issued,dueAt:invoiceDueAt(issued),status:'paid',paidAt,paidAmount:amount,paymentMethod:method};
    setInvoices(prev=>prev.some(row=>row.quickfileInvoiceId===record.quickfileInvoiceId)?prev.map(row=>row.quickfileInvoiceId===record.quickfileInvoiceId?{...row,...record,id:row.id}:row):[record,...prev]);
    if(businessId&&supabase) void saveInvoices(supabase, businessId, [record]);
  }
  setAppointments(p=>p.map(a=>ids.has(a.id)&&a.status!=='Completed'?{...a,status:'Completed'}:a));
  setEditingAppointment(a=>a&&ids.has(a.id)&&a.status!=='Completed'?{...a,status:'Completed'}:a);
  flash(targets.length>1?'Invoice marked as paid.':'Marked as paid.');
 }
 async function markJobUnpaid(appointmentId:string){
  const appointment=appointments.find(a=>a.id===appointmentId);
  const targets=appointment?jobsSharingInvoice(appointment):[];
  const ids=new Set((targets.length?targets:[{id:appointmentId}]).map(job=>job.id));
  const existing=payments.filter(payment=>ids.has(payment.appointmentId));
  if(!existing.length) return;
  if(businessId&&supabase){
    for(const payment of existing){
      const {error}=await supabase.from('payments').delete().eq('business_id',businessId).eq('id',payment.id);
      if(error){flash('Could not remove payment from the database.');return;}
    }
  }
  setPayments(p=>p.filter(x=>!ids.has(x.appointmentId)));
  if(appointment?.quickfileInvoiceId){
    const id=appointment.quickfileInvoiceId;
    setInvoices(prev=>prev.map(row=>row.quickfileInvoiceId===id?{...row,status:'unpaid',paidAt:null,paidAmount:null,paymentMethod:null}:row));
    const current=invoices.find(row=>row.quickfileInvoiceId===id);
    if(current&&businessId&&supabase) void saveInvoices(supabase, businessId, [{...current,status:'unpaid',paidAt:null,paidAmount:null,paymentMethod:null}]);
  }
  flash('Payment removed. Job is still done.');
 }
 function JobFlags({appointment}:{appointment:Appointment}){
  const outcome=jobOutcome(appointment);
  if(outcome==='todo'&&!appointment.quickfileInvoiceId&&!appointment.missingFromSetmore) return null;
  return <span className="job-flags">
    {appointment.quickfileInvoiceId&&<span className="job-flag flag-invoiced" title={appointment.quickfileInvoicedAt||''}>{appointment.quickfileInvoiceId<0?'Invoiced locally':`Invoiced${appointment.quickfileInvoiceNumber?` ${appointment.quickfileInvoiceNumber}`:''}`}</span>}
    {appointment.missingFromSetmore&&<span className="job-flag flag-missing">Not in Setmore</span>}
  </span>;
 }
 function JobQuickActions({appointment}:{appointment:Appointment}){
  const outcome=jobOutcome(appointment);
  const invoicing=invoicingAppointmentId===appointment.id;
  return <div className="job-quick-actions" onClick={e=>e.stopPropagation()}>
   {outcome==='todo'&&<button type="button" className="button tiny status-done" disabled={invoicing} onClick={()=>void markJobCompleted(appointment.id)}>{invoicing?'Invoicing…':'Done'}</button>}
   {outcome!=='todo'&&!appointment.quickfileInvoiceId&&isQuickFileConnected(quickFile)&&<button type="button" className="button tiny secondary" disabled={invoicing} onClick={()=>beginInvoice(appointment)}>{invoicing?'Invoicing…':'Invoice'}</button>}
   {outcome==='done'&&<button type="button" className="button tiny status-pay" onClick={()=>void markJobPaid(appointment)}>Pay</button>}
   {outcome==='paid'&&<span className="button tiny status-paid">Paid</span>}
  </div>;
 }
 function setMainService(name:string){setSettings(s=>({...s,mainService:name}));flash(`“${name}” is now your main service.`);}
 function openCustomersPage(){setServiceFilter('All services');setCustomerListMode('Active');setPage('Customers');setMenuOpen(false);}
 function assignCustomerToService(customerId:string, serviceName:string){setCustomers(p=>p.map(c=>{if(c.id!==customerId||customerHasService(c,serviceName))return c;const catalog=services.find(s=>s.name===serviceName);const isMain=serviceName===mainServiceName;return withServiceLines(c,[...customerServiceNames(c).map(name=>customerLineFor(c,name)!).filter(Boolean),normalizeServiceLine({service:serviceName,price:0,duration:catalog?.duration??30,frequency:6,oneOff:!isMain})]);}));flash('Customer assigned to service.');}
 function unassignCustomerFromService(customerId:string, serviceName?:string|null){const target=serviceName||selectedService;if(!target)return;setCustomers(p=>p.map(c=>{if(c.id!==customerId)return c;const remaining=(c.serviceLines||[]).filter(line=>line.service!==target);return withServiceLines(c,remaining);}));flash(target?`Removed from “${target}”. Visit history kept.`:'Customer removed from this service.');}
 function archiveCustomer(customerId:string){
  setCustomers(p=>p.map(c=>c.id===customerId?{...c,archived:true}:c));
  if(editingCustomer?.id===customerId) setEditingCustomer(c=>c?{...c,archived:true}:c);
  flash('Moved to past customers. History kept.');
 }
 function reactivateCustomer(customerId:string){
  setCustomers(p=>p.map(c=>c.id===customerId?{...c,archived:false}:c));
  if(editingCustomer?.id===customerId) setEditingCustomer(c=>c?{...c,archived:false}:c);
  setCustomerListMode('Active');
  flash('Customer reactivated.');
 }
 async function removeAppointment(id:string){const relatedPayments=payments.filter(p=>p.appointmentId===id);if(businessId&&supabase){for(const pay of relatedPayments){const {error}=await supabase.from('payments').delete().eq('business_id',businessId).eq('id',pay.id);if(error){flash('Could not delete related payments.');return;}}const {error}=await supabase.from('appointments').delete().eq('business_id',businessId).eq('id',id);if(error){flash('Could not delete the appointment from the database.');return;}}setPayments(p=>p.filter(x=>x.appointmentId!==id));setAppointments(p=>p.filter(x=>x.id!==id));flash('Appointment deleted.');}
 async function removeService(name:string){if(!window.confirm(`Remove “${name}”? Customers keep their history, but this service will no longer be offered.`))return;if(businessId&&supabase){const {error}=await supabase.from('services').delete().eq('business_id',businessId).eq('name',name);if(error){flash('Could not remove the service from the database.');return;}}setServices(p=>p.filter(x=>x.name!==name));setCustomers(p=>p.map(c=>withServiceLines(c,(c.serviceLines||[]).filter(line=>line.service!==name))));if(selectedService===name)setSelectedService(null);setSettings(s=>s.mainService===name?{...s,mainService:''}:s);flash('Service removed.');}
 function saveServiceForm(form:HTMLFormElement){const fd=new FormData(form);const name=String(fd.get('name')).trim();if(!name){flash('Please enter a service name.');return;}const duration=editingService?.duration??30;const price=editingService?.price??24;const color=resolveServiceColor(String(fd.get('color')||editingService?.color||''),services.length);if(editingService){const oldName=editingService.name;if(name!==oldName&&services.some(s=>s.name===name)){flash('A service with that name already exists.');return;}setServices(p=>p.map(s=>s.name===oldName?{name,duration,price,color}:s));if(name!==oldName){setCustomers(p=>p.map(c=>withServiceLines(c,(c.serviceLines||[]).map(line=>line.service===oldName?{...line,service:name}:line))));setAppointments(p=>p.map(a=>a.service===oldName?{...a,service:name}:a));if(selectedService===oldName)setSelectedService(name);setSettings(s=>s.mainService===oldName?{...s,mainService:name}:s);}flash('Service updated.');}else{if(services.some(s=>s.name===name)){flash('A service with that name already exists.');return;}setServices(p=>[...p,{name,duration,price,color:color||nextServiceColor(p)}]);if(!settings.mainService)setSettings(s=>({...s,mainService:name}));flash('Service added.');}setShowServiceForm(false);setEditingService(null);} function setServiceColor(serviceName:string,color:string){setServices(p=>p.map(s=>s.name===serviceName?{...s,color:resolveServiceColor(color)}:s));}
 function saveAppointment(form:HTMLFormElement){
  const fd=new FormData(form); const customerId=String(fd.get('customerId')); const customer=customers.find(c=>c.id===customerId); if(!customer)return;
  const date=String(fd.get('date')||editingAppointment?.date||'').trim(); const time=String(fd.get('time')||editingAppointment?.time||'').slice(0,5); const duration=Math.max(5,Number(fd.get('duration'))||editingAppointment?.duration||30);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){flash('Please enter the date as DD/MM/YYYY.');return;}
  if(!/^\d{2}:\d{2}$/.test(time)){flash('Please choose a start time.');return;}
  const service=String(fd.get('service')); const price=Number(fd.get('price')); const notes=String(fd.get('notes')||''); const address=customerProperty(customer);
  const cycleRaw=String(fd.get('cycle')||'');
  const oneOff=cycleRaw==='oneoff';
  const lineFreq=customerLineFor(customer,service);
  const frequency=oneOff?6:(CYCLE_WEEKS.includes(Number(cycleRaw) as typeof CYCLE_WEEKS[number])?Number(cycleRaw):(lineFreq?.frequency||customer.frequency||6));
  // Visit price/duration stay on the appointment only.
  // Never overwrite the customer's regular rate when one job is discounted (e.g. fewer windows).
  const applyCustomerCycle=()=>{
   setCustomers(p=>p.map(c=>{
    if(c.id!==customerId) return c;
    const catalog=services.find(x=>x.name===service);
    const lines=c.serviceLines?.length?c.serviceLines.map(line=>normalizeServiceLine(line,{frequency:c.frequency||6})):[];
    const idx=lines.findIndex(line=>line.service===service);
    if(idx>=0){
     const line=lines[idx];
     lines[idx]=normalizeServiceLine({
      ...line,
      frequency:oneOff?(line.frequency||6):frequency,
      oneOff,
      // keep line.price and line.duration — this visit's amount is appointment-only
     });
     return withServiceLines(c, lines);
    }
    // First time this service is booked for the customer — seed the regular rate from this visit
    return withServiceLines(c,[...lines,normalizeServiceLine({service,price:price||catalog?.price||0,duration,frequency:oneOff?6:frequency,oneOff})]);
   }));
  };
  if(editingAppointment){
    const updated:Appointment={...editingAppointment,customerId,date,time,duration,service,price,address,notes,oneOff,frequency};
    const before=appointments;
    const scheduleChanged=editingAppointment.date!==date||editingAppointment.time!==time||Number(editingAppointment.duration)!==duration;
    const next=resolveOverlappingAppointments(scheduleChanged?cascadeFollowingAppointments(appointments, updated):appointments.map(a=>a.id===updated.id?updated:a));
    const moved=next.filter(a=>a.id!==updated.id&&before.some(prev=>prev.id===a.id&&prev.time!==a.time)).length;
    setAppointments(next);
    applyCustomerCycle();
    setSelectedDate(date); closeSchedule(); flash(moved?`Appointment updated. ${moved} later job${moved===1?'':'s'} shifted.`:'Appointment updated.'); return;
  }
  const created:Appointment={id:crypto.randomUUID(),customerId,date,time,duration,service,price,status:'Confirmed',address,notes,oneOff,frequency};
  const conflict=settings.preventOverlap&&appointments.some(a=>a.date===date&&a.status!=='Cancelled'&&a.time===time);
  if(conflict){flash('That start time is already taken. Choose another time.');return;}
  setAppointments(p=>resolveOverlappingAppointments(cascadeFollowingAppointments([...p, created], created)));
  applyCustomerCycle();
  setSelectedDate(date); closeSchedule(); flash('Appointment added successfully.');
 }
 function openCustomerForm(customer?:Customer|null){const original=customer?customers.find(c=>c.id===customer.id)??customer:null;setEditingCustomer(original);setCustomerHistoryPeriod('year');setShowCustomer(true);}
 function closeCustomerForm(){setShowCustomer(false);setEditingCustomer(null);}
 const customerHistoryRange=useMemo(()=>customerHistoryPeriod==='all'?null:periodRange(customerHistoryPeriod),[customerHistoryPeriod]);
 const customerHistoryJobs=useMemo(()=>{
  if(!editingCustomer) return [] as Appointment[];
  return appointments
   .filter(a=>a.customerId===editingCustomer.id&&a.status!=='Cancelled')
   .filter(a=>!customerHistoryRange||(a.date>=customerHistoryRange.start&&a.date<=customerHistoryRange.end))
   .sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
 },[editingCustomer,appointments,customerHistoryRange]);
 const customerHistoryTotal=customerHistoryJobs.reduce((s,a)=>s+a.price,0);
 function saveCustomerForm(form:HTMLFormElement){const fd=new FormData(form); const name=String(fd.get('name')).trim(); if(!name)return; let serviceLines:CustomerServiceLine[]=[]; try{serviceLines=parseServiceLines(JSON.parse(String(fd.get('serviceLines')||'[]')));}catch{serviceLines=[];} if(!serviceLines.length&&!editingCustomer){flash('Please add at least one service.');return;} if(serviceLines.some(line=>!Number.isFinite(line.price)||line.price<0||String(line.price)==='')){flash('Please enter a job price for each service.');return;} if(serviceLines.some(line=>!Number.isFinite(line.duration)||line.duration<5)){flash('Please enter a valid duration for each service.');return;} const primary=serviceLines[0]; const base={name,email:String(fd.get('email')),phone:String(fd.get('phone')),phone2:String(fd.get('phone2')||''),address:String(fd.get('address')),town:String(fd.get('town')||'').trim(),postcode:String(fd.get('postcode')).toUpperCase(),frequency:primary&&!primary.oneOff?(primary.frequency||6):6,notes:String(fd.get('notes')||''),service:primary?.service||'',price:primary?.price||0,duration:primary?.duration||30,serviceLines}; if(editingCustomer){setCustomers(p=>p.map(c=>c.id===editingCustomer.id?normalizeCustomer({...c,...base}):c));closeCustomerForm();flash(serviceLines.length?'Customer updated.':'Customer moved to Unassigned. Visit history kept.');return;} const c=normalizeCustomer({id:crypto.randomUUID(),...base});setCustomers(p=>[c,...p]);closeCustomerForm();flash('Customer added successfully.');}
 async function deleteCustomerCloud(id:string){
  if(!businessId||!supabase) return;
  const client=supabase;
  const {error:rpcError}=await client.rpc('delete_customer_cascade',{p_business_id:businessId,p_customer_id:id});
  if(!rpcError) return;
  for(;;){
    const {data:batch,error:listErr}=await client.from('appointments').select('id').eq('business_id',businessId).eq('customer_id',id).limit(25);
    if(listErr) throw new Error(listErr.message);
    if(!batch?.length) break;
    const apptIds=batch.map((r:any)=>String(r.id));
    await client.from('payments').delete().eq('business_id',businessId).in('appointment_id',apptIds);
    await client.from('notifications').delete().eq('business_id',businessId).in('appointment_id',apptIds);
    const {error:apptErr}=await client.from('appointments').delete().eq('business_id',businessId).in('id',apptIds);
    if(apptErr) throw new Error(apptErr.message);
  }
  await client.from('recurrence_rules').delete().eq('business_id',businessId).eq('customer_id',id);
  await client.from('customer_addresses').delete().eq('business_id',businessId).eq('customer_id',id);
  const {error}=await client.from('customers').delete().eq('business_id',businessId).eq('id',id);
  if(error) throw new Error(error.message);
 }
 async function removeCustomers(ids:string[]){
  const chosen=customers.filter(c=>ids.includes(c.id));
  if(!chosen.length||deletingCustomers) return;
  const label=chosen.length===1?chosen[0].name:`${chosen.length} customers`;
  if(!window.confirm(`Permanently delete ${label}? This removes them and ALL their appointments. To keep history without scheduling them, move them to Past customers instead.`)) return;
  const idSet=new Set(chosen.map(c=>c.id));
  const relatedAppts=appointments.filter(a=>idSet.has(a.customerId));
  const relatedIds=new Set(relatedAppts.map(a=>a.id));
  setPayments(p=>p.filter(x=>!relatedIds.has(x.appointmentId)));
  setAppointments(p=>p.filter(a=>!idSet.has(a.customerId)));
  setCustomers(p=>p.filter(c=>!idSet.has(c.id)));
  setSelectedCustomerIds(prev=>prev.filter(id=>!idSet.has(id)));
  if(editingCustomer&&idSet.has(editingCustomer.id)) closeCustomerForm();
  setDeletingCustomers(true);
  let failed=0;
  try{
    for(const customer of chosen){
      try{await deleteCustomerCloud(customer.id);}catch{failed+=1;}
    }
  }finally{setDeletingCustomers(false);}
  if(failed) flash(`${chosen.length-failed} deleted. ${failed} could not be removed from the cloud.`,10000);
  else flash(chosen.length===1?'Customer deleted.':`${chosen.length} customers deleted.`);
 }
 function removeCustomer(id:string){return removeCustomers([id]);}
 function toggleCustomerSelected(id:string){setSelectedCustomerIds(prev=>prev.includes(id)?prev.filter(item=>item!==id):[...prev,id]);}
 function toggleListedCustomerSelection(){
  const ids=listedCustomers.map(c=>c.id);
  setSelectedCustomerIds(prev=>{
    const all=ids.length>0&&ids.every(id=>prev.includes(id));
    return all?prev.filter(id=>!ids.includes(id)):[...new Set([...prev,...ids])];
  });
 }
 async function saveSettings(form:HTMLFormElement){const fd=new FormData(form);const next:BusinessSettings={...settings,name:String(fd.get('name')).trim()||settings.name,email:String(fd.get('email')).trim(),phone:String(fd.get('phone')).trim(),postcode:String(fd.get('postcode')).trim().toUpperCase(),workingDays:String(fd.get('workingDays')),timezone:String(fd.get('timezone'))};setSettings(next);if(businessId&&supabase){const {error}=await supabase.from('businesses').update({name:next.name,email:next.email||null,phone:next.phone||null}).eq('id',businessId);if(error){flash('Could not save settings to Supabase: '+error.message);return;}}flash('Settings saved.');}
 function openSetmoreImport(){setmoreFileRef.current?.click();}
 function togglePlannedSetmore(id:string){
  setPlannedSetmoreIds(prev=>{
    const next=prev.includes(id)?prev.filter(item=>item!==id):[...prev,id];
    writePlannedSetmore(businessId,next);
    return next;
  });
 }
 async function handleSetmoreFile(file:File|null){
  if(!file)return;
  setImportingSetmore(true);
  try{
   const result=await applySetmoreFileImport(file,{customers,appointments,services,payments});
   const importedServices=withServiceColors(result.services);
   const nextCustomers=result.customers.map(c=>normalizeCustomer(c,importedServices));
   const settled=settleInvoicedVisits(resolveOverlappingAppointments(result.appointments as Appointment[]), invoices, id=>nextCustomers.find(customer=>customer.id===id)?.name||'');
   const nextAppointments=settled.appointments;
   if(settled.removedIds.length) pendingCloudDeletes.current.push(...settled.removedIds);
   if(settled.invoices!==invoices){
     setInvoices(settled.invoices);
     if(businessId&&supabase){
       const changed=settled.invoices.filter(row=>{
         const previous=invoices.find(invoice=>invoice.quickfileInvoiceId===row.quickfileInvoiceId);
         return !previous||previous.appointmentId!==row.appointmentId;
       });
       if(changed.length) void saveInvoices(supabase, businessId, changed);
     }
   }
   const removed=(result.removedAppointments||[]) as Appointment[];
   if(removed.length){
    const removedInvoices=invoicesFromAppointments(removed, nextCustomers, payments);
    if(removedInvoices.length){
      setInvoices(prev=>combineInvoiceSources(removedInvoices, prev, []));
      if(businessId&&supabase){
        const saveError=await saveInvoices(supabase, businessId, removedInvoices);
        if(saveError) setInvoiceNotice('Jobs were removed from the schedule. Their invoices stayed on this device: '+saveError);
      }
    }
    pendingCloudDeletes.current.push(...removed.map(item=>item.id));
   }
   setCustomers(nextCustomers);
   setAppointments(nextAppointments);
   setServices(importedServices);
   setPayments(result.payments);
   persistCustomerServices(nextCustomers,businessId);
   // Persist immediately so a refresh / HMR cannot lose the import before cloud sync finishes.
   writeWorkspaceStore('cs_customers',businessId,nextCustomers);
   writeWorkspaceStore('cs_appointments',businessId,nextAppointments);
   writeWorkspaceStore('cs_payments',businessId,result.payments);
   writeWorkspaceStore('cs_services',businessId,importedServices);
   const last=buildSetmoreLastImport(file,result.summary);
   setSetmoreImportHistory(prependSetmoreImportHistory(businessId,last));
   setSelectedSetmoreImportId(last.id);
   // Show everyone after import — new Setmore services often differ from the main-service filter.
   setServiceFilter('All services');
   setPlannedSetmoreIds([]);
   writePlannedSetmore(businessId,[]);
   setShowPlannedSetmore(false);
   // Stay on the current calendar day — jumping to the file's date range made the schedule look empty.
   const toast=[
    formatSetmoreImportSummary(result.summary),
    result.summary.fileKind?`file=${result.summary.fileKind}`:'',
    result.summary.detectedHeaders?.length?`columns=${result.summary.detectedHeaders.slice(0,8).join('/')}`:'',
   ].filter(Boolean).join(' · ');
   flash(toast);
  }catch(error){
   flash(error instanceof Error?error.message:'Could not import the Setmore file.');
  }finally{
   setImportingSetmore(false);
   if(setmoreFileRef.current)setmoreFileRef.current.value='';
  }
 }
 if(businessId&&!remoteReady){return <div className="auth-shell"><div className="auth-card"><div className="brand-mark auth-brand-mark"><Sparkles size={21}/></div><h1>{remoteError?'Could not load your workspace':'Connecting MyPurePlan'}</h1><p>{remoteError?'MyPurePlan could not read the database. Check that the SQL migration was run and the connection settings are correct.':(loadProgress||'Loading your customers, services and appointments from Supabase…')}</p>{remoteError&&<><pre className="auth-error-detail">{remoteError}</pre><button className="button primary auth-submit" onClick={()=>window.location.reload()}>Try again</button></>}<button className="auth-text-button" onClick={()=>onSignOut?.()}>Sign out</button></div></div>}
 return <div className={`app-shell ${navExpanded?'nav-expanded':'nav-collapsed'}`}>
  {menuOpen&&<button type="button" className="sidebar-scrim" aria-label="Close menu" onClick={()=>setMenuOpen(false)}/>}
  <aside className={`sidebar ${navExpanded?'':'sidebar-collapsed'} ${menuOpen?'sidebar-open':''}`}>
   <div className="sidebar-tools"><button type="button" className="icon-button nav-toggle" aria-label={navExpanded?'Collapse navigation':'Expand navigation'} title={navExpanded?'Collapse menu':'Expand menu'} onClick={()=>{if(typeof window!=='undefined'&&window.matchMedia('(max-width:960px)').matches){setMenuOpen(false);return;}setNavExpanded(v=>!v);}}><Menu size={20}/></button><button type="button" className="icon-button mobile-close" aria-label="Close menu" onClick={()=>setMenuOpen(false)}><X size={18}/></button></div>
   <div className="brand"><div className="brand-mark" title="MyPurePlan"><Sparkles size={20}/></div><div className="brand-copy"><strong>MyPurePlan</strong><span>WINDOW CARE PRO</span></div></div>
   <div className="workspace" title={settings.name||businessName||'Business'}><div className="workspace-avatar">{initials(settings.name||businessName||'Business')}</div><div className="workspace-copy"><strong>{settings.name||businessName||'Business workspace'}</strong><span>Business workspace</span></div><ChevronDown size={15}/></div>
   <div className="nav-label">WORKSPACE</div><nav>{nav.map(item=><button key={item.id} title={item.id} className={`nav-item ${page===item.id?'active':''}`} onClick={()=>{if(item.id==='Customers')openCustomersPage();else{setPage(item.id);setMenuOpen(false);}}}><item.icon size={18}/><span>{item.id}</span></button>)}</nav>
   <div className="nav-label tools-label">MANAGE</div><button title="Finance" className={`nav-item ${page==='Finance'?'active':''}`} onClick={()=>setPage('Finance')}><Wallet size={18}/><span>Finance</span></button><button title="Reports" className={`nav-item ${page==='Reports'?'active':''}`} onClick={()=>setPage('Reports')}><Activity size={18}/><span>Reports</span></button><button title="Settings" className={`nav-item ${page==='Settings'?'active':''}`} onClick={()=>setPage('Settings')}><Settings size={18}/><span>Settings</span></button>
   <div className="sidebar-bottom"><div className="upgrade-card"><div className="upgrade-icon"><Sparkles size={17}/></div><strong>Make every day count</strong><p>Keep your rounds organised and your customers happy.</p><button onClick={()=>setPage('Finance')}>View finance <ArrowUpRight size={14}/></button></div><div className="profile-row" title="Business owner"><div className="profile-avatar">RB</div><div className="profile-copy"><strong>Business owner</strong><span>Free workspace</span></div><MoreHorizontal size={18}/></div></div>
  </aside>
  <main className="main-area"><header className="topbar"><div className="topbar-left"><button type="button" className="icon-button nav-toggle mobile-menu" aria-label="Open navigation" title="Open menu" onClick={()=>setMenuOpen(true)}><Menu size={20}/></button><div className="breadcrumb">Workspace <ChevronRight size={14}/> <strong>{page}</strong></div></div><div className="topbar-actions"><button className="avatar-small" title="Sign out" onClick={()=>onSignOut?.()}>{(userEmail||'BO').slice(0,1).toUpperCase()}</button></div></header>
  <div className="content">
      {(page==='Schedule'||page==='Dashboard'||page==='Calendar')&&<ScheduleBoard
    view={scheduleView}
    setView={setScheduleView}
    mode={calendarMode}
    setMode={setCalendarMode}
    selectedDate={selectedDate}
    setSelectedDate={setSelectedDate}
    today={addDays(0)}
    planOpen={planOpen}
    setPlanOpen={setPlanOpen}
    jobs={appointments.filter(a=>a.status!=='Cancelled')}
    waiting={overdueFiltered.map(c=>{const prev=lastVisitFor(c.id);return {id:c.id,name:c.name,place:[c.town,c.postcode].filter(Boolean).join(' · '),lastVisit:prev?.date??null,price:c.price};})}
    waitingTotal={overdue.length}
    search={scheduleSearch}
    setSearch={setScheduleSearch}
    customerName={job=>customerName(appointments.find(a=>a.id===job.id)?.customerId||'')}
    outcome={job=>{const appointment=appointments.find(a=>a.id===job.id);return appointment?jobOutcome(appointment):'todo';}}
    timeRange={timeRange}
    money={money}
    dateLabel={dateLabel}
    onAdd={openSchedule}
    onImport={openSetmoreImport}
    importing={importingSetmore}
    onOpenDay={openDay}
    onOpenJob={job=>{const appointment=appointments.find(a=>a.id===job.id);if(appointment)openEditAppointment(appointment);}}
    onDragStart={onCalDragStart}
    onDragOver={onDayDragOver}
    onDropDay={onDayDrop}
    onDropJob={onApptDrop}
    renderTools={job=>{const appointment=appointments.find(a=>a.id===job.id);if(!appointment)return null;return <><JobFlags appointment={appointment}/><JobQuickActions appointment={appointment}/></>;}}
  />}
{page==='Setmore'&&<SetmorePlan customers={setmorePlanRows} cycle={planCycle} setCycle={setPlanCycle} search={planSearch} setSearch={setPlanSearch} showPlanned={showPlannedSetmore} setShowPlanned={setShowPlannedSetmore} onToggle={togglePlannedSetmore} onOpen={id=>{const customer=customers.find(c=>c.id===id);if(customer)openCustomerForm(customer);}} dateLabel={dateLabel}/>}
{page==='Customers'&&<div className="list-screen"><div className="page-heading"><div><div className="eyebrow"><Users size={14}/> CUSTOMER RELATIONSHIPS</div><h1>Customers</h1><p>Active customers are scheduled as usual. Move former clients to Past customers — they stay in your database with history.</p></div><div className="heading-actions"><button className="button secondary" onClick={openSetmoreImport} disabled={importingSetmore}><Upload size={16}/> {importingSetmore?'Importing…':'Import Setmore'}</button><button className="button secondary" onClick={()=>exportCSV(customers)}><Download size={16}/> Export CSV</button><button className="button primary" onClick={()=>openCustomerForm()}><Plus size={17}/> Add customer</button></div></div>
    <div className="panel table-panel"><div className="table-controls"><div className="search-field"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customers, postcodes..."/></div><div className="filter-control"><Wrench size={15}/><select value={serviceFilter} onChange={e=>setServiceFilter(e.target.value)}><option>All services</option>{services.map(s=><option key={s.name} value={s.name}>{s.name}</option>)}<option>Unassigned</option></select></div><div className="filter-control"><Filter size={15}/><select value={customerFilter} onChange={e=>setCustomerFilter(e.target.value)}><option>All customers</option><option>4 weeks</option><option>6 weeks</option><option>8 weeks</option><option>10 weeks</option><option>12 weeks</option></select></div><div className="filter-control customer-list-mode"><select value={customerListMode} onChange={e=>setCustomerListMode(e.target.value==='Past'?'Past':'Active')} aria-label="Customer list"><option value="Active">Active customers</option><option value="Past">Past customers</option></select></div>{selectedListedIds.length>0&&<button type="button" className="button tiny danger" disabled={deletingCustomers} onClick={()=>void removeCustomers(selectedListedIds)}>{deletingCustomers?'Deleting…':`Delete selected · ${selectedListedIds.length}`}</button>}<span className="result-count">{listedCustomers.length} {customerListMode==="Past"?"past":"active"}</span></div>
    {listedCustomers.length===0?<EmptyState title={customerListMode==='Past'?'No past customers':'No customers found'} text={customerListMode==='Past'?'Archived customers appear here. Reactivate them anytime.':'Try a different search or add a customer.'} action={customerListMode==='Past'?'Back to active':'Add customer'} onClick={()=>{if(customerListMode==='Past')setCustomerListMode('Active');else openCustomerForm();}}/>:<div className="table-wrap"><table><thead><tr><th className="select-cell"><input ref={input=>{if(input)input.indeterminate=selectedListedIds.length>0&&selectedListedIds.length<listedCustomers.length;}} type="checkbox" checked={listedCustomers.length>0&&selectedListedIds.length===listedCustomers.length} onChange={toggleListedCustomerSelection} aria-label="Select customers in this list"/></th><th>Customer</th><th>Property</th><th>Services</th><th>Contact</th><th></th></tr></thead><tbody>{listedCustomers.map(c=>{const names=customerServiceNames(c);const primary=names[0]?customerLineFor(c,names[0]):null;const selected=selectedCustomerIds.includes(c.id);return <tr key={c.id} className={`clickable-row${selected?' is-selected':''}`} role="button" tabIndex={0} onClick={()=>openCustomerForm(c)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCustomerForm(c);}}}><td className="select-cell" onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}><input type="checkbox" checked={selected} onChange={()=>toggleCustomerSelected(c.id)} aria-label={`Select ${c.name}`}/></td><td><div className="table-customer"><div className="customer-avatar">{initials(c.name)}</div><div><strong>{c.name}</strong><small>{c.email||'No email added'}</small></div></div></td><td><span>{c.address}</span><small className="table-sub">{[c.town,c.postcode].filter(Boolean).join(' · ')}</small></td><td><span className="cycle-pill" style={names[0]?{color:resolveServiceColor(services.find(s=>s.name===names[0])?.color,services.findIndex(s=>s.name===names[0]))}:undefined}>{customerServicesLabel(c)}</span>{primary&&names.length===1?<small className="table-sub">{money(primary.price)} · {primary.duration} min</small>:names.length>1?<small className="table-sub">{names.join(' · ')}</small>:null}</td><td><span>{c.phone||'—'}</span>{c.phone2?<small className="table-sub">{c.phone2}</small>:null}{c.notes?<small className="table-sub notes-preview">{c.notes.length>48?c.notes.slice(0,48)+'…':c.notes}</small>:null}</td><td><div className="row-actions" onClick={e=>e.stopPropagation()}><button className="icon-button" title="Schedule appointment" onClick={()=>openSchedule(c.id)}><Plus size={16}/></button><button className="icon-button" title="Edit customer" onClick={()=>openCustomerForm(c)}><Pencil size={15}/></button><button className="icon-button" title={c.archived?'Reactivate customer':'Move to past customers'} onClick={()=>c.archived?reactivateCustomer(c.id):archiveCustomer(c.id)}>{c.archived?<ArchiveRestore size={15}/>:<Archive size={15}/>}</button><button className="icon-button" title="Delete customer permanently" onClick={()=>void removeCustomer(c.id)}><Trash2 size={15}/></button></div></td></tr>;})}</tbody></table></div>}
    </div></div>}
    {page==='Services & pricing'&&<><div className="page-heading"><div><div className="eyebrow"><Wrench size={14}/> WHAT YOU OFFER</div><h1>Services</h1><p>{selectedService?'Customers assigned to this service.':mainServiceName?`Main service: ${mainServiceName}. Pin another service to change the default when booking.`:'Choose a service to see customers and job value. Pin one as your main service for new bookings.'}</p></div><div className="heading-actions">{selectedService&&<button className="button secondary" onClick={()=>setSelectedService(null)}><ChevronLeft size={16}/> All services</button>}<button className="button primary" onClick={()=>{setEditingService(null);setShowServiceForm(true);}}><Plus size={17}/> Add service</button></div></div>
    {!selectedService&&<div className="panel table-panel"><div className="panel-heading padded-heading"><div><h2>Your services</h2><p>{services.length} service{services.length===1?'':'s'} · customer count and total job value</p></div></div><div className="table-wrap"><table><thead><tr><th>Service</th><th>Customers</th><th>Total job value</th><th></th></tr></thead><tbody>{services.map((s,i)=>{const count=customersForService(s.name).length;const value=serviceJobValue(s.name);const isMain=s.name===mainServiceName;return <tr key={s.name} className={`service-row ${isMain?'service-row-main':''}`} onClick={()=>setSelectedService(s.name)}><td><div className="table-customer"><div className="customer-avatar service-avatar" style={{background:resolveServiceColor(s.color,i)}}><Wrench size={15}/></div><div><strong className="service-name-colored" style={{color:resolveServiceColor(s.color,i)}}>{s.name}</strong><small>{isMain?'Main service · used by default when adding jobs':'Tap to view assigned customers'}</small></div>{isMain&&<span className="main-badge"><Pin size={12}/> Main</span>}</div></td><td><span className="cycle-pill">{count} customer{count===1?'':'s'}</span></td><td><strong>{money(value)}</strong></td><td><div className="row-actions" onClick={e=>e.stopPropagation()}><button className={`button tiny ${isMain?'primary':'secondary'}`} title={isMain?'This is your main service':'Set as main service'} onClick={()=>setMainService(s.name)}><Pin size={14}/> {isMain?'Main':'Set main'}</button><button className="button tiny secondary" onClick={()=>{setEditingService(s);setShowServiceForm(true);}}>Rename</button><button className="icon-button" title="Remove service" onClick={()=>void removeService(s.name)}><Trash2 size={15}/></button></div></td></tr>})}</tbody></table>{services.length===0&&<EmptyState title="No services yet" text="Add your first service to start assigning customers." action="Add service" onClick={()=>{setEditingService(null);setShowServiceForm(true);}}/>}</div></div>}
    {selectedService&&(()=>{const service=services.find(s=>s.name===selectedService);const assigned=customersForService(selectedService);const available=unassignedForService(selectedService);const value=serviceJobValue(selectedService);const jobCount=appointments.filter(a=>a.service===selectedService&&a.status!=='Cancelled').length;const isMain=selectedService===mainServiceName;if(!service)return null;return <><div className="stats-grid compact-stats"><Stat icon={<Users size={19}/>} label="Assigned customers" value={String(assigned.length)} sub="On this service" tone="blue"/><Stat icon={<CircleDollarSign size={20}/>} label="Total job value" value={money(value)} sub={`${jobCount} active job${jobCount===1?'':'s'}`} tone="green"/><Stat icon={<CalendarCheck size={19}/>} label="Active jobs" value={String(jobCount)} sub="In calendar" tone="purple"/><Stat icon={<Pin size={19}/>} label="Main service" value={isMain?'Yes':'No'} sub={isMain?'Default when booking':'Pin to use by default'} tone="amber"/></div>
    <div className="panel table-panel"><div className="panel-heading padded-heading"><div><h2 className="service-name-colored" style={{color:resolveServiceColor(service.color)}}>{selectedService}{isMain?' · Main':''}</h2><p>Customers assigned to this service</p><div className="service-color-picker" style={{marginTop:10}}>{SERVICE_COLOR_PALETTE.map(hex=><button key={hex} type="button" className={`service-color-swatch${resolveServiceColor(service.color)===hex?' is-selected':''}`} style={{background:hex}} aria-label={`Set colour ${hex}`} onClick={()=>setServiceColor(selectedService,hex)}/>)}</div></div><div className="heading-actions"><button className={`button ${isMain?'primary':'secondary'}`} onClick={()=>setMainService(selectedService)}><Pin size={15}/> {isMain?'Main service':'Set as main'}</button><button className="button secondary" onClick={()=>{setEditingService(service);setShowServiceForm(true);}}>Edit</button></div></div><div className="table-wrap"><table><thead><tr><th>Customer</th><th>Property</th><th>Cycle</th><th>Price</th><th>Contact</th><th></th></tr></thead><tbody>{assigned.map(c=><tr key={c.id} className="clickable-row" role="button" tabIndex={0} onClick={()=>openCustomerForm(c)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCustomerForm(c);}}}><td><div className="table-customer"><div className="customer-avatar">{initials(c.name)}</div><div><strong>{c.name}</strong><small>{c.email||'No email'}</small></div></div></td><td><span>{c.address}</span><small className="table-sub">{[c.town,c.postcode].filter(Boolean).join(' · ')}</small></td><td><span className="cycle-pill">{serviceCycleLabel(customerLineFor(c,selectedService)||{frequency:c.frequency,oneOff:false})} · {c.duration} min</span></td><td><strong>{money(c.price)}</strong></td><td><span>{c.phone||'—'}</span></td><td><div className="row-actions" onClick={e=>e.stopPropagation()}><button className="button tiny secondary" onClick={()=>openSchedule(c.id)}>Book</button><button className="icon-button" title="Edit customer" onClick={()=>openCustomerForm(c)}><Pencil size={15}/></button><button className="icon-button" title="Remove from this service (keeps customer & history)" onClick={()=>unassignCustomerFromService(c.id,selectedService)}><X size={15}/></button></div></td></tr>)}</tbody></table>{assigned.length===0&&<EmptyState title="No customers on this service yet" text="Assign an existing customer below, or add a new customer with this service." action="Add customer" onClick={()=>openCustomerForm()}/>}</div></div>
    {!isMain&&<div className="panel table-panel" style={{marginTop:18}}><div className="panel-heading padded-heading"><div><h2>Assign a customer</h2><p>{mainServiceName?`Customers on ${mainServiceName} (main) appear here so you can add them to this service.`:'Customers not yet on this service'}</p></div></div>{available.length===0?<div className="success-empty"><CheckCircle2 size={20}/> Everyone available is already assigned.</div>:<div className="table-wrap"><table><thead><tr><th>Customer</th><th>Current service</th><th>Property</th><th></th></tr></thead><tbody>{available.map(c=><tr key={c.id} className="clickable-row" role="button" tabIndex={0} onClick={()=>openCustomerForm(c)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCustomerForm(c);}}}><td><strong>{c.name}</strong></td><td><span className="cycle-pill">{customerServiceNames(c).join(', ')||'Unassigned'}</span></td><td><span>{[c.town,c.postcode].filter(Boolean).join(' · ')||'—'}</span></td><td><div className="row-actions" onClick={e=>e.stopPropagation()}><button className="button tiny primary" onClick={()=>assignCustomerToService(c.id,selectedService)}>Assign</button></div></td></tr>)}</tbody></table></div>}</div>}</>;})()}
    <div className="info-note"><AlertCircle size={17}/><p><strong>Tip:</strong> Customers on your main service also show under other services as “not assigned”, so you can add them without re-entering their details. Pin a main service to control the default when booking.</p></div></>}
   {page==='Finance'&&<div className="page-scroll"><div className="page-heading"><div><div className="eyebrow"><Wallet size={14}/> MONEY IN & OUTSTANDING</div><h1>Finance</h1><p>QuickFile invoices stay here after they are created. Open ones turn overdue 14 days after the invoice date. Paid ones update when QuickFile sends a payment, or when you mark the job paid.</p></div><div className="heading-actions"><div className="segmented"><button className={financePeriod==='week'?'chosen':''} onClick={()=>setFinancePeriod('week')}>Week</button><button className={financePeriod==='month'?'chosen':''} onClick={()=>setFinancePeriod('month')}>Month</button><button className={financePeriod==='year'?'chosen':''} onClick={()=>setFinancePeriod('year')}>Year</button></div><button className="button secondary" onClick={()=>exportCSV(financeJobs.map(a=>({date:a.date,time:a.time,customer:customerName(a.customerId),service:a.service,status:a.status,amount:a.price,payment:isPaid(a.id)?'Paid':'Unpaid',paidAt:paymentFor(a.id)?.paidAt||''})))}><Download size={16}/> Export CSV</button></div></div>
    <p className="finance-period-label">{dateLabel(financeRange.start)} – {dateLabel(financeRange.end)}</p>
    <InvoiceLedger invoices={invoices} checking={checkingQuickFile} onCheck={()=>void checkQuickFilePayments()}/>
    {invoiceNotice&&<div className="info-note"><AlertCircle size={17}/><p>{invoiceNotice}</p></div>}
    <div className="stats-grid"><Stat icon={<CircleDollarSign size={20}/>} label="Billed in period" value={money(financeBilled)} sub={`${financeJobs.length} billable jobs`} tone="blue"/><Stat icon={<CheckCircle2 size={19}/>} label="Collected" value={money(financeCollected)} sub={`${financePaid.length} paid`} tone="green"/><Stat icon={<AlertCircle size={19}/>} label="Outstanding" value={money(financeOutstanding)} sub={`${financeUnpaid.length} unpaid`} tone="amber"/><Stat icon={<CalendarCheck size={19}/>} label="Completed jobs" value={String(financeJobs.filter(a=>a.status==='Completed').length)} sub="Marked complete" tone="purple"/></div>
    <div className="panel table-panel"><div className="panel-heading padded-heading"><div><h2>Unpaid</h2><p>Customers who still need to pay for work in this period</p></div></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Customer</th><th>Service</th><th>Status</th><th>Amount</th><th></th></tr></thead><tbody>{financeUnpaid.map(a=><tr key={a.id}><td><strong>{dateLabel(a.date)}</strong><small className="table-sub">{a.time}</small></td><td><strong>{customerName(a.customerId)}</strong></td><td><span>{a.service}</span></td><td><Status status={a.status}/></td><td><strong>{money(a.price)}</strong></td><td><div className="row-actions">{a.status!=='Completed'&&!isPaid(a.id)?<button className="button tiny primary" onClick={()=>markJobCompleted(a.id)}>Done</button>:<button className="button tiny primary" onClick={()=>void markJobPaid(a)}>Pay</button>}</div></td></tr>)}</tbody></table>{financeUnpaid.length===0&&<div className="success-empty"><CheckCircle2 size={20}/> No outstanding payments in this period.</div>}</div></div>
    <div className="panel table-panel" style={{marginTop:18}}><div className="panel-heading padded-heading"><div><h2>Paid</h2><p>Payments collected in this period</p></div></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Customer</th><th>Service</th><th>Paid on</th><th>Amount</th><th></th></tr></thead><tbody>{financePaid.map(a=>{const pay=paymentFor(a.id)!;return <tr key={a.id}><td><strong>{dateLabel(a.date)}</strong><small className="table-sub">{a.time}</small></td><td><strong>{customerName(a.customerId)}</strong></td><td><span>{a.service}</span></td><td><span className="cycle-pill paid-pill">{pay.paidAt?dateLabel(pay.paidAt):'—'} · {pay.method}</span></td><td><strong>{money(a.price)}</strong></td><td><button className="button tiny secondary" onClick={()=>void markJobUnpaid(a.id)}>Undo</button></td></tr>})}</tbody></table>{financePaid.length===0&&<div className="empty-state"><div className="empty-icon"><Wallet size={21}/></div><strong>No payments recorded yet</strong><p>Mark a job as paid above to build your collection history.</p></div>}</div></div>
    <div className="info-note"><AlertCircle size={17}/><p><strong>How it works:</strong> Confirmed and completed jobs in the selected period appear here. Mark paid to store a payment in Supabase (`payments`). Outstanding = billed minus collected.</p></div></div>}
   {page==='Reports'&&<><div className="page-heading"><div><div className="eyebrow"><Activity size={14}/> BUSINESS PERFORMANCE</div><h1>Reports</h1><p>A simple overview of your workload and scheduled revenue.</p></div><div className="heading-actions"><button className="button secondary" onClick={()=>setPage('Finance')}><Wallet size={16}/> Open Finance</button><button className="button secondary" onClick={()=>exportCSV(appointments.map(a=>({...a,customer:customerName(a.customerId)})) as unknown as Customer[])}><Download size={16}/> Export data</button></div></div><div className="stats-grid"><Stat icon={<CircleDollarSign size={20}/>} label="Scheduled revenue" value={money(appointments.filter(a=>a.status!=='Cancelled').reduce((s,a)=>s+a.price,0))} sub="All active appointments" tone="green"/><Stat icon={<Wallet size={19}/>} label="Collected (all time)" value={money(payments.filter(p=>p.paidAt).reduce((s,p)=>s+p.amount,0))} sub={`${payments.filter(p=>p.paidAt).length} payments`} tone="blue"/><Stat icon={<CheckCircle2 size={19}/>} label="Completed jobs" value={String(appointments.filter(a=>a.status==='Completed').length)} sub="Marked as completed" tone="purple"/><Stat icon={<Users size={19}/>} label="Customers" value={String(customers.length)} sub="In your workspace" tone="amber"/></div><div className="panel report-panel"><h2>Appointment status</h2><p>Distribution of active appointments in your workspace.</p>{(['Confirmed','Completed'] as const).map(s=>{const n=appointments.filter(a=>a.status===s).length;const total=Math.max(1,appointments.filter(a=>a.status!=='Cancelled').length);return <div className="report-bar-row" key={s}><div><span>{s}</span><strong>{n}</strong></div><div className="report-track"><div className={`report-fill fill-${s.toLowerCase()}`} style={{width:`${n/total*100}%`}}/></div></div>})}</div></>}
   {page==='Settings'&&<div className="page-scroll"><div className="page-heading"><div><div className="eyebrow"><Settings size={14}/> YOUR WORKSPACE</div><h1>Settings</h1><p>Configure your business details and booking preferences.</p></div></div><div className="settings-layout"><div className="panel settings-card"><h2>Business profile</h2><p>These details appear in your workspace.</p><form onSubmit={e=>{e.preventDefault();void saveSettings(e.currentTarget);}} className="form-grid"><label>Business name<input name="name" defaultValue={settings.name} key={`name-${settings.name}`}/></label><label>Contact email<input name="email" type="email" defaultValue={settings.email} key={`email-${settings.email}`}/></label><label>Phone number<input name="phone" defaultValue={settings.phone} key={`phone-${settings.phone}`}/></label><label>Business postcode<input name="postcode" defaultValue={settings.postcode} key={`postcode-${settings.postcode}`}/></label><label>Default working days<select name="workingDays" defaultValue={settings.workingDays} key={`days-${settings.workingDays}`}><option>Monday to Friday</option><option>Monday to Saturday</option><option>Every day</option></select></label><label>Time zone<select name="timezone" defaultValue={settings.timezone} key={`tz-${settings.timezone}`}><option value="Europe/London">United Kingdom (GMT/BST)</option></select></label><div className="form-actions"><button className="button primary" type="submit">Save changes</button></div></form></div><div className="panel settings-card"><h2>Import from Setmore</h2><p>Upload a Setmore Excel (.xls / .xlsx) or CSV report to refresh customers, services, appointments, calendar and dashboard — without retyping.</p><div className="setmore-import-box"><button type="button" className="button primary" onClick={openSetmoreImport} disabled={importingSetmore}><Upload size={16}/> {importingSetmore?'Importing…':'Upload Setmore report'}</button><p className="setmore-import-hint">In Setmore go to <strong>Settings → Reports</strong> (or Basic Reporting), pick your date range, then download the report as <strong>.xls / .xlsx</strong> (CSV also works). You can also import customer contacts from Customers → Export.</p><ul className="setmore-import-list"><li>New customers are added; existing ones match by email, phone or name</li><li>Services and prices are created or updated from the report</li><li>Inside the report dates, Setmore replaces the schedule: matching jobs update, moves follow the booking, jobs without an invoice are removed, and an invoiced job that Setmore no longer lists stays on the calendar as Not in Setmore</li></ul>{selectedSetmoreImport&&<div className="setmore-last-import"><strong>{selectedSetmoreImport.id===lastSetmoreImport?.id?'Last import':'Import details'}</strong><p>Loaded <b>{formatDateTime(selectedSetmoreImport.importedAt)}</b>{selectedSetmoreImport.fileName?<>{' · file '}<b>{selectedSetmoreImport.fileName}</b></>:null}{selectedSetmoreImport.fileKind?<>{' · type '}<b>{selectedSetmoreImport.fileKind}</b></>:null}{selectedSetmoreImport.fileModifiedAt?<>{' · file saved '}<b>{formatDateTime(selectedSetmoreImport.fileModifiedAt)}</b></>:null}</p>{selectedSetmoreImport.summaryLine?<p>{selectedSetmoreImport.summaryLine}</p>:null}{selectedSetmoreImport.coverageFrom&&selectedSetmoreImport.coverageTo?<p>Jobs in that file: <b>{dateLabel(selectedSetmoreImport.coverageFrom)}</b>{selectedSetmoreImport.coverageFrom!==selectedSetmoreImport.coverageTo?<>{' – '}<b>{dateLabel(selectedSetmoreImport.coverageTo)}</b></>:null}</p>:null}{typeof selectedSetmoreImport.rowsWithSchedule==='number'?<p>Schedule rows read: <b>{selectedSetmoreImport.rowsWithSchedule}</b>{typeof selectedSetmoreImport.rowsCustomerOnly==='number'?<>{' · customer-only '}<b>{selectedSetmoreImport.rowsCustomerOnly}</b></>:null}</p>:null}<p className="setmore-next-hint">Export every date you changed in Setmore. MyPurePlan replaces the schedule only between the first and last date in that file.</p></div>}{setmoreImportHistory.length>0&&<div className="setmore-import-history"><strong>Upload history</strong><p className="setmore-import-hint">Tap an upload to see the same details as above.</p><div className="setmore-import-history-list">{setmoreImportHistory.map(entry=>{const selected=entry.id===(selectedSetmoreImport?.id);return <button type="button" className={`setmore-import-history-row${selected?' is-selected':''}`} key={entry.id||entry.importedAt} onClick={()=>setSelectedSetmoreImportId(entry.id)} aria-pressed={selected}><div className="setmore-import-history-main"><b>{formatDateTime(entry.importedAt)}</b><span>{entry.fileName||'Setmore file'}</span></div><div className="setmore-import-history-meta">{entry.coverageFrom&&entry.coverageTo?<span>{dateLabel(entry.coverageFrom)}{entry.coverageFrom!==entry.coverageTo?<>{' – '}{dateLabel(entry.coverageTo)}</>:null}</span>:<span>No job dates</span>}{entry.fileModifiedAt?<span>File saved {formatDateTime(entry.fileModifiedAt)}</span>:null}</div></button>;})}</div></div>}</div><div className="info-note"><AlertCircle size={17}/><p>Inside the dates in the file, Setmore is the schedule{businessId?' and the change syncs to Supabase':''}. Jobs outside that range stay. A job with no invoice that only exists in MyPurePlan, and falls inside those dates, is removed. An invoiced job that Setmore no longer lists stays on the calendar, marked Not in Setmore, and stays done.</p></div></div><div className="panel settings-card"><h2>QuickFile</h2><p>Connect your QuickFile account to create invoices when you mark a job as Done.</p>
    <div className="form-grid">
      <label>Account number<input value={quickFile.accNumber} onChange={e=>setQuickFile(s=>({...s,accNumber:e.target.value,connectedAt:null}))} placeholder="Numeric account number, not your email" autoComplete="off"/></label>
      <label>API key<input value={quickFile.apiKey} onChange={e=>setQuickFile(s=>({...s,apiKey:e.target.value,connectedAt:null}))} placeholder="API key from Account Settings, not your password" autoComplete="off" type="password"/></label>
      <label>Application ID<input value={quickFile.applicationId} onChange={e=>setQuickFile(s=>({...s,applicationId:e.target.value,connectedAt:null}))} placeholder="From Create a QuickFile App" autoComplete="off"/></label>
      <label>VAT on invoices<select value={quickFile.vatMode} onChange={e=>setQuickFile(s=>({...s,vatMode:e.target.value as QuickFileVatMode}))}><option value="exempt">No VAT / exempt</option><option value="standard20_gross">VAT 20% (price is gross)</option><option value="standard20_net">VAT 20% (price is net)</option></select></label>
      <label>Webhook secret<input value={quickFile.webhookSecret} onChange={e=>setQuickFile(s=>({...s,webhookSecret:e.target.value}))} placeholder="Secret from QuickFile webhooks" autoComplete="off" type="password"/></label>
    </div>
    <div className="settings-inline-actions">
      <button type="button" className="button primary" disabled={quickFileBusy||!quickFile.accNumber.trim()||!quickFile.apiKey.trim()||!quickFile.applicationId.trim()} onClick={()=>void testAndSaveQuickFile(quickFile)}>{quickFileBusy?'Connecting…':(isQuickFileConnected(quickFile)?'Re-test connection':'Connect QuickFile')}</button>
      {isQuickFileConnected(quickFile)&&<button type="button" className="button secondary" onClick={disconnectQuickFile}>Disconnect</button>}
      <button type="button" className="button secondary" disabled={quickFileBusy||!quickFile.accNumber.trim()||!quickFile.webhookSecret.trim()} onClick={()=>void saveWebhookSecret()}>Save webhook secret</button>
    </div>
    <div className="info-note"><AlertCircle size={17}/><p>{isQuickFileConnected(quickFile)?<>Connected{quickFile.connectedAt?<> · {formatDateTime(quickFile.connectedAt)}</>:null}. VAT mode: <b>{vatModeLabel(quickFile.vatMode)}</b>. Saved to your account, so QuickFile stays connected the next time you open MyPurePlan. Done asks whether the invoice goes to QuickFile or stays in MyPurePlan. Finance keeps both.</>:<>Not connected. In QuickFile use the legacy Create a QuickFile App, enable Client_Search, Client_Create, Client_Update, Invoice_Create and Invoice_Send, then paste Account number, API key and Application ID here.</>}</p></div>
    <div className="info-note"><AlertCircle size={17}/><p>Payment updates need a QuickFile Power User plan. In QuickFile open Account settings → 3rd party integrations → Webhooks, paste <b>https://mypureplan.vercel.app/api/quickfile/webhook</b>, enable invoice paid and payment events, then paste QuickFile’s webhook secret here and save it. Paid invoices then show as paid in Finance. Overdue means unpaid and more than 14 days old.</p></div>
  </div>
  <div className="panel settings-card"><h2>Booking preferences</h2><p>Choose how appointments are handled.</p><button type="button" className="preference-row preference-toggle" onClick={()=>setSettings(s=>{const next={...s,preventOverlap:!s.preventOverlap};flash(next.preventOverlap?'Overlap protection enabled.':'Overlap protection disabled.');return next;})}><div><strong>Prevent overlapping appointments</strong><span>Do not allow two jobs to start at the same time.</span></div><span className={settings.preventOverlap?'toggle-on':'toggle-off'}><i/></span></button><button type="button" className="preference-row preference-toggle" onClick={()=>setSettings(s=>{const next={...s,useRecurring:!s.useRecurring};flash(next.useRecurring?'Recurring cycles enabled.':'Recurring cycles disabled.');return next;})}><div><strong>Use recurring customer cycles</strong><span>Track regular visits every 4, 6, 8, 10 or 12 weeks.</span></div><span className={settings.useRecurring?'toggle-on':'toggle-off'}><i/></span></button><div className="info-note"><AlertCircle size={17}/><p>Preferences save automatically. Business profile is stored locally{businessId?' and synced to Supabase':''}.</p></div></div></div></div>}
  </div><footer className="footer"><span>© 2026 MyPurePlan</span><span>Built for independent window cleaning businesses</span><span className="footer-status"><i/> {businessId?cloudStatus:'Demo workspace'}</span></footer></main>
  <input ref={setmoreFileRef} type="file" accept=".xls,.xlsx,.xlsm,.csv,text/csv,.txt,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={e=>void handleSetmoreFile(e.target.files?.[0]??null)}/>
  {notice&&<div className="toast"><CheckCircle2 size={17}/>{notice}<button onClick={()=>setNotice('')}><X size={15}/></button></div>}
  {showAdd&&<Modal title={editingAppointment?`Edit appointment · ${customerName(editingAppointment.customerId)}`:scheduleCustomer?`Schedule ${scheduleCustomer.name}`:'New appointment'} subtitle={editingAppointment?'Mark done or paid, or change the date and time below.':scheduleCustomer?'Review the last visit, then set date and service.':'Add a job to your working calendar.'} onClose={closeSchedule}><form className="modal-form" onSubmit={e=>{e.preventDefault();saveAppointment(e.currentTarget)}} key={`schedule-${scheduleFormKey}-${editingAppointment?.id||scheduleCustomerId||'new'}`}>
    {editingAppointment&&(()=>{const live=appointments.find(a=>a.id===editingAppointment.id)||editingAppointment;const outcome=jobOutcome(live);return <div className="job-outcome-card"><div className="last-visit-label">Status</div><p className="outcome-help">{outcome==='todo'?'Mark as done when finished. You choose whether the invoice goes to QuickFile or stays in MyPurePlan. If the customer has more than one service, you choose which ones to include.':outcome==='done'?(live.quickfileInvoiceId?(live.quickfileInvoiceId<0?'Done · local invoice.':`Done · QuickFile invoice ${live.quickfileInvoiceNumber||live.quickfileInvoiceId}.`):'Done — take payment when the customer pays.'):'Done and paid.'}</p>{live.quickfileInvoiceId&&<p className="outcome-help"><FileText size={14}/> {live.quickfileInvoiceId<0?'Invoiced locally':<>Invoiced in QuickFile{live.quickfileInvoiceNumber?` as ${live.quickfileInvoiceNumber}`:''}</>}{live.quickfileInvoicedAt?` · ${formatDateTime(live.quickfileInvoicedAt)}`:''}</p>}{live.missingFromSetmore&&<p className="outcome-help">This visit is no longer in the latest Setmore report. The invoice stays, and the job stays on the calendar.</p>}{outcome==='todo'&&<div className="outcome-actions"><div className="job-quick-actions"><button type="button" className="button tiny status-done" disabled={invoicingAppointmentId===live.id} onClick={()=>void markJobCompleted(live.id)}>{invoicingAppointmentId===live.id?'Invoicing…':'Done'}</button></div></div>}</div>;})()}
    {!editingAppointment&&scheduleCustomer&&lastVisit&&<div className="last-visit-card"><div className="last-visit-label">Last visit</div><div className="last-visit-grid"><span><strong>Date</strong>{dateLabel(lastVisit.date)}</span><span><strong>Time</strong>{lastVisit.time}</span><span><strong>Price</strong>{money(lastVisit.price)}</span><span><strong>Service</strong>{lastVisit.service}</span></div>{lastVisit.notes?<p className="last-visit-note"><AlertCircle size={14}/><span>{lastVisit.notes}</span></p>:<p className="last-visit-note muted-note">No job notes from the last visit.</p>}{scheduleCustomer.notes?<p className="last-visit-note customer-note-hint"><AlertCircle size={14}/><span><strong>Customer notes:</strong> {scheduleCustomer.notes}</span></p>:null}</div>}
    {!editingAppointment&&scheduleCustomer&&!lastVisit&&<div className="last-visit-card"><div className="last-visit-label">Last visit</div><p className="last-visit-note muted-note">No previous appointment found for this customer.</p>{scheduleCustomer.notes?<p className="last-visit-note customer-note-hint"><AlertCircle size={14}/><span><strong>Customer notes:</strong> {scheduleCustomer.notes}</span></p>:null}</div>}
    <label>Customer<select name="customerId" required defaultValue={editingAppointment?.customerId||scheduleCustomer?.id||''} onChange={e=>applyAppointmentCustomerDefaults(e.target.value)}><option value="" disabled>Select a customer</option>{(editingAppointment?customers.filter(c=>!c.archived||c.id===editingAppointment.customerId):activeCustomers).map(c=><option value={c.id} key={c.id}>{c.name} — {c.postcode}{c.archived?' (past)':''}</option>)}</select></label><div className="form-row"><label>Date<UkDateInput name="date" defaultValue={editingAppointment?.date||scheduleDate} onIsoChange={isoDate=>{setScheduleDate(isoDate);if(!editingAppointment)return;const updated={...editingAppointment,date:isoDate};setEditingAppointment(updated);setAppointments(p=>resolveOverlappingAppointments(cascadeFollowingAppointments(p, updated)));}} required/></label><label>Start time<input name="time" type="time" key={`time-${editingAppointment?.id||'new'}-${scheduleDate}-${suggestedStartTime}`} defaultValue={suggestedStartTime} required onChange={e=>{if(!editingAppointment)return;const nextTime=e.target.value.slice(0,5);if(!/^\d{2}:\d{2}$/.test(nextTime))return;const updated={...editingAppointment,time:nextTime,date:scheduleDate||editingAppointment.date};setEditingAppointment(updated);setAppointments(p=>resolveOverlappingAppointments(cascadeFollowingAppointments(p, updated)));}}/></label></div><div className="form-row"><label>Service<select name="service" defaultValue={editingAppointment?.service||scheduleCustomer?.service||defaultServiceName} onChange={e=>{const selectedName=e.target.value;const customerId=(document.querySelector('select[name=customerId]') as HTMLSelectElement|null)?.value;if(customerId){applyAppointmentCustomerDefaults(customerId,{serviceName:selectedName,syncServiceSelect:false});return;}const catalogItem=services.find(x=>x.name===selectedName);const priceInput=document.getElementById('appointment-price') as HTMLInputElement|null;const durationInput=document.getElementById('appointment-duration') as HTMLInputElement|null;const cycleInput=document.getElementById('appointment-cycle') as HTMLSelectElement|null;if(durationInput)durationInput.value=String(catalogItem?.duration??30);if(priceInput)priceInput.value=catalogItem&&catalogItem.price>0?String(catalogItem.price):'';if(cycleInput)cycleInput.value='oneoff';}}>{services.map(s=><option key={s.name} value={s.name}>{s.name}{s.name===mainServiceName?' (main)':''}</option>)}</select></label><label>Cycle<select id="appointment-cycle" name="cycle" defaultValue={editingAppointment?.oneOff?'oneoff':(()=>{const line=scheduleCustomer?customerLineFor(scheduleCustomer,editingAppointment?.service||scheduleCustomer.service||defaultServiceName):null;if(line?.oneOff)return 'oneoff';return String(editingAppointment?.frequency||line?.frequency||scheduleCustomer?.frequency||6);})()}><option value="oneoff">One-off</option>{CYCLE_WEEKS.map(w=><option key={w} value={w}>Every {w} weeks</option>)}</select></label></div><div className="form-row"><label>Duration (minutes)<input id="appointment-duration" name="duration" type="number" min="10" step="5" defaultValue={editingAppointment?.duration??scheduleCustomer?.duration??defaultService?.duration??30} required onChange={e=>{if(!editingAppointment)return;const nextDuration=Math.max(5,Number(e.target.value)||30);const updated={...editingAppointment,duration:nextDuration,date:scheduleDate||editingAppointment.date};setEditingAppointment(updated);setAppointments(p=>resolveOverlappingAppointments(cascadeFollowingAppointments(p, updated)));}}/></label><label className="visit-price">Price for this visit (£)<input id="appointment-price" className="price-input" name="price" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={editingAppointment?.price??(scheduleCustomer&&scheduleCustomer.price>0?scheduleCustomer.price:undefined)} placeholder="0.00" required/><small className="field-hint">This visit only — does not change the customer’s regular rate.</small></label></div><label>Job notes (this visit only)<textarea name="notes" rows={2} defaultValue={editingAppointment?.notes||''} placeholder="Notes for this appointment only — not the customer profile notes..."/></label><div className="modal-actions"><button type="button" className="button secondary" onClick={closeSchedule}>Cancel</button>{editingAppointment&&<button type="button" className="button secondary" onClick={()=>{const id=editingAppointment.id;closeSchedule();void removeAppointment(id);}}>Delete</button>}<button className="button primary" type="submit">{editingAppointment?<><Check size={16}/> Save changes</>:<><Plus size={16}/> Create appointment</>}</button></div></form></Modal>}
  {showCustomer&&<Modal wide={Boolean(editingCustomer)} title={editingCustomer?(editingCustomer.archived?'Past customer':'Customer'):'Add customer'} subtitle={editingCustomer?(editingCustomer.archived?'This customer is archived. Reactivate them to schedule again.':'Services, visit history, and contact details in one place.'):'Save a customer, property details, and one or more services.'} onClose={closeCustomerForm}><form className="modal-form" key={editingCustomer?.id||'new-customer'} onSubmit={e=>{e.preventDefault();saveCustomerForm(e.currentTarget)}}><label>Customer name<input name="name" defaultValue={editingCustomer?.name||''} placeholder="e.g. Jamie Smith" required/></label><div className="form-row"><label>Email address<input name="email" type="email" defaultValue={editingCustomer?.email||''} placeholder="jamie@example.com"/></label><label>Phone number<input name="phone" defaultValue={editingCustomer?.phone||''} placeholder="07..."/></label></div><label>Additional phone<input name="phone2" defaultValue={editingCustomer?.phone2||''} placeholder="Second number from Setmore"/></label><label>Property address<input name="address" defaultValue={editingCustomer?.address||''} placeholder="House number and street" required/></label><div className="form-row"><label>Town / locality<input name="town" defaultValue={editingCustomer?.town||''} placeholder="e.g. Sidcup" required/></label><label>Postcode<input name="postcode" defaultValue={editingCustomer?.postcode||''} placeholder="DA15 8AB" required/></label></div><CustomerServiceEditor catalog={services} initialLines={editingCustomer?.serviceLines||[]} defaultServiceName={editingCustomer?.service||selectedService||defaultServiceName} allowEmpty={Boolean(editingCustomer)}/><label>Customer notes<textarea name="notes" rows={3} defaultValue={editingCustomer?.notes||''} placeholder="Setmore customer notes — stay on the customer profile, separate from job notes..."/></label><p className="field-hint">Customer notes come from the Setmore customer profile. Job notes on each appointment are separate.</p>
    {editingCustomer&&<div className="customer-history">
      <div className="customer-history-head">
        <div>
          <strong>Visit history</strong>
          <p>{customerHistoryPeriod==='all'?'All recorded jobs for this customer.':`${dateLabel(customerHistoryRange!.start)} – ${dateLabel(customerHistoryRange!.end)}`}</p>
        </div>
        <div className="segmented" role="group" aria-label="History period">
          <button type="button" className={customerHistoryPeriod==='week'?'chosen':''} onClick={()=>setCustomerHistoryPeriod('week')}>Week</button>
          <button type="button" className={customerHistoryPeriod==='month'?'chosen':''} onClick={()=>setCustomerHistoryPeriod('month')}>Month</button>
          <button type="button" className={customerHistoryPeriod==='year'?'chosen':''} onClick={()=>setCustomerHistoryPeriod('year')}>Year</button>
          <button type="button" className={customerHistoryPeriod==='all'?'chosen':''} onClick={()=>setCustomerHistoryPeriod('all')}>All</button>
        </div>
      </div>
      <div className="customer-history-summary">
        <span><b>{customerHistoryJobs.length}</b> job{customerHistoryJobs.length===1?'':'s'}</span>
        <span><b>{money(customerHistoryTotal)}</b> total</span>
        <span><b>{new Set(customerHistoryJobs.map(a=>a.service)).size}</b> service{new Set(customerHistoryJobs.map(a=>a.service)).size===1?'':'s'}</span>
        <button type="button" className="button tiny secondary" onClick={()=>{closeCustomerForm();openSchedule(editingCustomer.id);}}>Book next visit</button>
      </div>
      {editingCustomer.serviceLines?.length>0&&<div className="customer-service-chips">{editingCustomer.serviceLines.map(line=>{const svc=services.find(s=>s.name===line.service);const accent=resolveServiceColor(svc?.color,services.findIndex(s=>s.name===line.service));return <span className="customer-service-chip" key={line.service} style={{borderColor:`${accent}66`}}><strong style={{color:accent}}>{line.service}</strong><em>{serviceCycleLabel(line)}</em><i>{money(line.price)} · {line.duration} min</i></span>;})}</div>}
      {customerHistoryJobs.length===0?<div className="customer-history-empty">No jobs in this period.</div>:<div className="customer-history-list">{customerHistoryJobs.map(a=><button type="button" className={`customer-history-row outcome-${jobOutcome(a)}`} key={a.id} onClick={()=>{closeCustomerForm();openEditAppointment(a);}}><div className="customer-history-main"><strong>{dateLabel(a.date)} · {a.time}</strong><span>{a.service} · {cycleLabel(a)}</span></div><div className="customer-history-meta"><Status status={a.status}/><strong>{money(a.price)}</strong></div></button>)}</div>}
    </div>}
    <div className="modal-actions"><button type="button" className="button secondary" onClick={closeCustomerForm}>Cancel</button>{editingCustomer&&!editingCustomer.archived&&<button type="button" className="button secondary" onClick={()=>archiveCustomer(editingCustomer.id)}><Archive size={15}/> Move to past</button>}{editingCustomer&&editingCustomer.archived&&<button type="button" className="button secondary" onClick={()=>reactivateCustomer(editingCustomer.id)}><ArchiveRestore size={15}/> Reactivate</button>}{editingCustomer&&<button type="button" className="button secondary" onClick={()=>{const id=editingCustomer.id;closeCustomerForm();void removeCustomer(id);}}>Delete permanently</button>}<button className="button primary" type="submit">{editingCustomer?'Save changes':'Save customer'}</button></div></form></Modal>}
  {showServiceForm&&<Modal title={editingService?'Edit service':'Add service'} subtitle={editingService?'Update the name and colour.':'Create a service customers can be assigned to.'} onClose={()=>{setShowServiceForm(false);setEditingService(null);}}><form className="modal-form" onSubmit={e=>{e.preventDefault();saveServiceForm(e.currentTarget);}}><label>Service name<input name="name" defaultValue={editingService?.name??''} placeholder="e.g. Window cleaning" required/></label><fieldset className="service-color-field"><legend>Colour</legend><input type="hidden" name="color" id="service-color-input" defaultValue={resolveServiceColor(editingService?.color,services.length)}/><div className="service-color-picker">{SERVICE_COLOR_PALETTE.map(hex=>{const selected=resolveServiceColor(editingService?.color,services.length)===hex;return <button key={hex} type="button" className={`service-color-swatch${selected?' is-selected':''}`} style={{background:hex}} aria-label={`Colour ${hex}`} onClick={e=>{const input=e.currentTarget.form?.elements.namedItem('color');if(input instanceof HTMLInputElement){input.value=hex;}e.currentTarget.parentElement?.querySelectorAll('.service-color-swatch').forEach(btn=>btn.classList.remove('is-selected'));e.currentTarget.classList.add('is-selected');}}/>;})}</div></fieldset><div className="modal-actions"><button type="button" className="button secondary" onClick={()=>{setShowServiceForm(false);setEditingService(null);}}>Cancel</button><button className="button primary" type="submit">{editingService?'Save changes':'Add service'}</button></div></form></Modal>}

  {invoiceChoiceId&&(()=>{const anchor=appointments.find(job=>job.id===invoiceChoiceId);if(!anchor)return null;const items=invoiceChoiceItems(anchor);if(!items.length)return null;const anchorKey=`job:${anchor.id}`;const selected=items.filter(item=>item.key===anchorKey||invoiceChoiceKeys.includes(item.key));const total=selected.reduce((sum,item)=>sum+(Number(item.price)||0),0);const busy=Boolean(invoicingAppointmentId);const several=items.length>1;return <div className="modal-backdrop invoice-prompt" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)closeInvoiceChoice();}}><div className="invoice-prompt-card" role="dialog" aria-modal="true" aria-labelledby="invoice-prompt-title"><h2 id="invoice-prompt-title">QuickFile or local?</h2><p>{customerName(anchor.customerId)} · {dateLabel(anchor.date)} · {money(total)}</p>{several&&<ul className="invoice-choice-lines">{items.map(item=>{const locked=item.key===anchorKey;const checked=locked||invoiceChoiceKeys.includes(item.key);return <li key={item.key} className={locked?'is-current':''}><label><input type="checkbox" checked={checked} disabled={busy||locked} onChange={()=>{if(locked)return;setInvoiceChoiceKeys(prev=>prev.includes(item.key)?prev.filter(key=>key!==item.key):[...prev,item.key]);}}/><span>{item.detail} · {item.service}</span></label><strong>{money(item.price)}</strong></li>;})}</ul>}<div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={closeInvoiceChoice}>Cancel</button><button type="button" className="button secondary" disabled={busy||!selected.length} onClick={()=>void confirmInvoiceChoice('local')}>{busy?'Saving…':'Local'}</button><button type="button" className="button primary" disabled={busy||!selected.length||!isQuickFileConnected(quickFile)} onClick={()=>void confirmInvoiceChoice('quickfile')}>{busy?'Invoicing…':'QuickFile'}</button></div></div></div>;})()}
 </div>;
}
function Stat({icon,label,value,sub,tone}:{icon:React.ReactNode;label:string;value:string;sub:string;tone:string}){return <div className="stat-card"><div className={`stat-icon tone-${tone}`}>{icon}</div><div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div><ArrowUpRight className="stat-arrow" size={15}/></div>}
function Status({status}:{status:Appointment['status']}){return <span className={`status status-${status.toLowerCase()}`}><i/>{status}</span>}
function EmptyState({title,text,action,onClick}:{title:string;text:string;action:string;onClick:()=>void}){return <div className="empty-state"><div className="empty-icon"><CalendarDays size={21}/></div><strong>{title}</strong><p>{text}</p><button className="button secondary tiny" onClick={onClick}>{action}</button></div>}
function Modal({title,subtitle,onClose,children,wide=false}:{title:string;subtitle:string;onClose:()=>void;children:React.ReactNode;wide?:boolean}){return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className={`modal ${wide?'modal-wide':''}`} role="dialog" aria-modal="true"><div className="modal-header"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={onClose}><X size={19}/></button></div>{children}</div></div>}
function exportCSV(rows:unknown[]){if(!rows.length)return;const keys=Object.keys(rows[0] as object);const csv=[keys.join(','),...rows.map(row=>keys.map(k=>{let value=String((row as Record<string,unknown>)[k]??'');if(/^\d{4}-\d{2}-\d{2}/.test(value))value=dateLabel(value.slice(0,10));return `"${value.replace(/"/g,'""')}"`;}).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='mypureplan-export.csv';a.click();URL.revokeObjectURL(url)}
