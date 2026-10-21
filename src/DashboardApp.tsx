import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import CustomerServiceEditor, { type CustomerServiceLine } from './CustomerServiceEditor';
import UkDateInput from './UkDateInput';
import { Activity, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Clock3, CloudSun, Download, Filter, LayoutDashboard, MapPin, Menu, MoreHorizontal, Pencil, Pin, Plus, Search, Settings, Sparkles, Users, Wallet, Wrench, X, ArrowUpRight, CheckCircle2, AlertCircle, CalendarCheck, ExternalLink, Link2, Trash2 } from 'lucide-react';

type Customer = { id: string; name: string; email: string; phone: string; address: string; town: string; postcode: string; price: number; duration: number; frequency: number; notes: string; service: string; serviceLines: CustomerServiceLine[] };
type Appointment = { id: string; customerId: string; date: string; time: string; duration: number; service: string; price: number; status: 'Confirmed'|'Pending'|'Completed'|'Cancelled'; address: string; notes?: string; oneOff?: boolean; frequency?: number };
const CYCLE_WEEKS = [4,6,8,10,12] as const;
function packApptNotes(notes:string|undefined, oneOff:boolean, frequency:number){
  const body=String(notes||'').replace(/^\[cycle:[^\]]+\]\s*/,'').trim();
  const tag=oneOff?'oneoff':String(CYCLE_WEEKS.includes(frequency as typeof CYCLE_WEEKS[number])?frequency:6);
  return body?`[cycle:${tag}] ${body}`:`[cycle:${tag}]`;
}
function unpackApptNotes(raw:string|null|undefined){
  const text=String(raw||'');
  const m=text.match(/^\[cycle:(oneoff|\d+)\]\s*(.*)$/s);
  if(!m) return {oneOff:false,frequency:6,notes:text};
  return {oneOff:m[1]==='oneoff',frequency:m[1]==='oneoff'?6:Number(m[1])||6,notes:m[2]||''};
}
function cycleLabel(a:Pick<Appointment,'oneOff'|'frequency'>){return a.oneOff?'One-off':`Every ${a.frequency||6} weeks`}
function cycleShort(a:Pick<Appointment,'oneOff'|'frequency'>){return a.oneOff?'1×':`${a.frequency||6}w`}
type Service = { name: string; duration: number; price: number };
type Payment = { id: string; appointmentId: string; amount: number; paidAt: string | null; method: string };
type FinancePeriod = 'week' | 'month' | 'year';
type BusinessSettings = { name: string; email: string; phone: string; postcode: string; workingDays: string; timezone: string; requireConfirmation: boolean; preventOverlap: boolean; useRecurring: boolean; mainService: string };
const defaultSettings: BusinessSettings = { name: 'ClearView Windows', email: 'hello@clearviewwindows.co.uk', phone: '020 8123 4567', postcode: 'DA15', workingDays: 'Monday to Saturday', timezone: 'Europe/London', requireConfirmation: true, preventOverlap: true, useRecurring: true, mainService: 'Window cleaning' };
const starterCustomers: Customer[] = [
 {id:'c1',name:'Oliver Bennett',email:'oliver.bennett@example.com',phone:'07700 900123',address:'18 Cedar Avenue',town:'Sidcup',postcode:'DA15 8AB',price:24,duration:30,frequency:6,notes:'Side gate is unlocked. Please close it afterwards.',service:'Window cleaning',serviceLines:[{service:'Window cleaning',price:24,duration:30}]},
 {id:'c2',name:'Amelia Clarke',email:'amelia.clarke@example.com',phone:'07700 900124',address:'42 The Drive',town:'Sidcup',postcode:'DA14 6NX',price:32,duration:45,frequency:8,notes:'Please text when you are on the way.',service:'Windows + conservatory',serviceLines:[{service:'Windows + conservatory',price:32,duration:45}]},
 {id:'c3',name:'George Wilson',email:'george.wilson@example.com',phone:'07700 900125',address:'7 Station Road',town:'Orpington',postcode:'BR5 3QW',price:18,duration:25,frequency:4,notes:'',service:'Window cleaning',serviceLines:[{service:'Window cleaning',price:18,duration:25}]},
 {id:'c4',name:'Isla Thompson',email:'isla.thompson@example.com',phone:'07700 900126',address:'91 Park Lane',town:'Bexley',postcode:'DA5 1AA',price:28,duration:35,frequency:6,notes:'Rear conservatory included.',service:'Window cleaning',serviceLines:[{service:'Window cleaning',price:28,duration:35}]},
 {id:'c5',name:'Noah Williams',email:'noah.williams@example.com',phone:'07700 900127',address:'5 Orchard Close',town:'Welling',postcode:'DA16 2RL',price:22,duration:30,frequency:8,notes:'',service:'Window cleaning',serviceLines:[{service:'Window cleaning',price:22,duration:30}]},
 {id:'c6',name:'Ava Davies',email:'ava.davies@example.com',phone:'07700 900128',address:'23 High Street',town:'Eltham',postcode:'SE9 1AA',price:35,duration:60,frequency:12,notes:'Large property; allow extra time.',service:'Windows + conservatory',serviceLines:[{service:'Windows + conservatory',price:35,duration:60}]},
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
const defaultServices: Service[] = [{name:'Window cleaning',duration:30,price:24},{name:'Windows + conservatory',duration:45,price:38},{name:'Gutter clearing',duration:60,price:65},{name:'Solar panel cleaning',duration:45,price:50}];
function parseServiceLines(raw: unknown, fallbackService = '', fallbackPrice = 0, fallbackDuration = 30): CustomerServiceLine[] {
  if (Array.isArray(raw)) {
    return raw.map((row: any) => ({
      service: String(row?.service || '').trim(),
      price: Number.isFinite(Number(row?.price)) ? Number(row.price) : 0,
      duration: Number.isFinite(Number(row?.duration)) && Number(row.duration) > 0 ? Number(row.duration) : fallbackDuration,
    })).filter(line => line.service);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try { return parseServiceLines(JSON.parse(raw), fallbackService, fallbackPrice, fallbackDuration); } catch { /* ignore */ }
  }
  if (fallbackService) return [{ service: fallbackService, price: fallbackPrice, duration: fallbackDuration }];
  return [];
}
function withServiceLines(customer: Customer, lines: CustomerServiceLine[]): Customer {
  const serviceLines = lines.filter(line => line.service);
  const primary = serviceLines[0];
  return {
    ...customer,
    serviceLines,
    service: primary?.service ?? '',
    price: primary?.price ?? 0,
    duration: primary?.duration ?? 30,
  };
}
function customerServiceNames(c: Pick<Customer,'service'|'serviceLines'>) {
  const names = (c.serviceLines?.length ? c.serviceLines.map(l => l.service) : [c.service]).map(n => n.trim()).filter(Boolean);
  return [...new Set(names)];
}
function customerHasService(c: Pick<Customer,'service'|'serviceLines'>, serviceName: string) {
  return customerServiceNames(c).includes(serviceName);
}
function customerLineFor(c: Customer, serviceName: string) {
  return c.serviceLines?.find(l => l.service === serviceName) ?? (c.service === serviceName ? { service: c.service, price: c.price, duration: c.duration } : null);
}
function normalizeCustomer(c: Partial<Customer> & Pick<Customer,'id'|'name'>, serviceList: Service[] = defaultServices): Customer {
  const legacyService = c.service ?? '';
  const legacyPrice = Number.isFinite(Number(c.price)) ? Number(c.price) : 0;
  const legacyDuration = Number.isFinite(Number(c.duration)) && Number(c.duration) > 0
    ? Number(c.duration)
    : (serviceList.find(s => s.name === legacyService)?.duration ?? 30);
  const serviceLines = parseServiceLines((c as any).serviceLines ?? (c as any).assigned_services, legacyService, legacyPrice, legacyDuration);
  const primary = serviceLines[0];
  return {
    id: c.id,
    name: c.name,
    email: c.email ?? '',
    phone: c.phone ?? '',
    address: c.address ?? '',
    town: c.town ?? '',
    postcode: c.postcode ?? '',
    price: primary?.price ?? legacyPrice,
    duration: primary?.duration ?? legacyDuration,
    frequency: Number(c.frequency) || 6,
    notes: c.notes ?? '',
    service: primary?.service ?? legacyService,
    serviceLines,
  };
}
const starterPayments: Payment[] = [
 {id:'p1',appointmentId:'a6',amount:35,paidAt:addDays(-1),method:'cash'},
];
function readStore<T>(key:string, fallback:T):T { try { const value=localStorage.getItem(key); return value?JSON.parse(value) as T:fallback; } catch { return fallback; } }
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
      return withServiceLines(c, stored ? [{ service: stored, price: c.price || 0, duration: c.duration || 30 }] : c.serviceLines);
    }
    return withServiceLines(c, stored);
  });
}
function persistCustomerServices(list: Customer[], businessId: string | null){
  const map: Record<string, CustomerServiceLine[]> = {};
  list.forEach(c => { if (c.serviceLines?.length) map[c.id] = c.serviceLines; else if (c.service) map[c.id] = [{ service: c.service, price: c.price, duration: c.duration }]; });
  writeServiceMap(businessId, map);
}
function money(n:number){return new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:2}).format(n)}
function dateLabel(date:string){const d=new Date(date+'T12:00:00');if(Number.isNaN(d.getTime()))return date;return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;}
function initials(name:string){return name.split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase()}
const nav = [{id:'Dashboard',icon:LayoutDashboard},{id:'Calendar',icon:CalendarDays},{id:'Customers',icon:Users},{id:'Online bookings',icon:CalendarCheck},{id:'Services & pricing',icon:Wrench}];
type DashboardProps = { businessId: string | null; businessName?: string; userEmail?: string; onSignOut?: () => void };

export default function DashboardApp({ businessId, businessName, userEmail, onSignOut }: DashboardProps){
 const [customers,setCustomers]=useState<Customer[]>(()=>applyServiceMap((readStore('cs_customers',starterCustomers) as Customer[]).map(c=>normalizeCustomer({...c,service:c.service??''})), null));
 const [appointments,setAppointments]=useState<Appointment[]>(()=>resolveOverlappingAppointments(readStore('cs_appointments',starterAppointments)));
 const [payments,setPayments]=useState<Payment[]>(()=>readStore('cs_payments',starterPayments));
 const [services,setServices]=useState<Service[]>(()=>readStore('cs_services',defaultServices));
 const [settings,setSettings]=useState<BusinessSettings>(()=>{const saved=readStore('cs_settings',defaultSettings);return {...defaultSettings,...saved,name:businessName||saved.name||defaultSettings.name,mainService:saved.mainService||defaultSettings.mainService};});
 const [remoteReady,setRemoteReady]=useState(!businessId); const [remoteError,setRemoteError]=useState(''); const [cloudStatus,setCloudStatus]=useState(businessId?'Connecting to Supabase…':'Demo mode'); const syncQueue=useRef<Promise<void>>(Promise.resolve());
 const [page,setPage]=useState('Dashboard'); const [search,setSearch]=useState(''); const [showAdd,setShowAdd]=useState(false); const [editingAppointment,setEditingAppointment]=useState<Appointment|null>(null); const [scheduleCustomerId,setScheduleCustomerId]=useState<string|null>(null); const [scheduleDate,setScheduleDate]=useState(addDays(0)); const [scheduleFormKey,setScheduleFormKey]=useState(0); const [showCustomer,setShowCustomer]=useState(false); const [editingCustomer,setEditingCustomer]=useState<Customer|null>(null); const [showBooking,setShowBooking]=useState(false); const [showServiceForm,setShowServiceForm]=useState(false); const [editingService,setEditingService]=useState<Service|null>(null); const [selectedService,setSelectedService]=useState<string|null>(null); const [menuOpen,setMenuOpen]=useState(false); const [navExpanded,setNavExpanded]=useState(false); const [scheduleSearch,setScheduleSearch]=useState(''); const [notice,setNotice]=useState(''); const [calendarMode,setCalendarMode]=useState<'Day'|'Week'|'2weeks'|'Month'>('Week'); const [selectedDate,setSelectedDate]=useState(addDays(0)); const [dayPanelOpen,setDayPanelOpen]=useState(false); const [customerFilter,setCustomerFilter]=useState('All customers'); const [serviceFilter,setServiceFilter]=useState('All services'); const [financePeriod,setFinancePeriod]=useState<FinancePeriod>('week');
 useEffect(()=>{if(!businessId)localStorage.setItem('cs_customers',JSON.stringify(customers)); persistCustomerServices(customers,businessId);},[customers,businessId]); useEffect(()=>{if(!businessId)localStorage.setItem('cs_appointments',JSON.stringify(appointments))},[appointments,businessId]); useEffect(()=>{if(!businessId)localStorage.setItem('cs_payments',JSON.stringify(payments))},[payments,businessId]); useEffect(()=>{if(!businessId)localStorage.setItem('cs_services',JSON.stringify(services))},[services,businessId]); useEffect(()=>{localStorage.setItem('cs_settings',JSON.stringify(settings));},[settings]);
 useEffect(()=>{ if(businessName) setSettings(s=>({...s,name:businessName})); },[businessName]);
 useEffect(()=>{setAppointments(p=>resolveOverlappingAppointments(p));},[appointments]);
 useEffect(()=>{
  if(!businessId || !supabase){setRemoteReady(true);return;}
  let cancelled=false; setRemoteReady(false); setRemoteError(''); setCloudStatus('Loading your workspace…');
  (async()=>{
   try {
    const [customerResult,addressResult,appointmentResult,serviceResult,paymentResult]=await Promise.all([
     supabase.from('customers').select('*').eq('business_id',businessId).order('full_name'),
     supabase.from('customer_addresses').select('*').eq('business_id',businessId),
     supabase.from('appointments').select('*').eq('business_id',businessId).order('starts_at'),
     supabase.from('services').select('*').eq('business_id',businessId).order('name'),
     supabase.from('payments').select('*').eq('business_id',businessId)
    ]);
    const failure=customerResult.error||addressResult.error||appointmentResult.error||serviceResult.error||paymentResult.error;
    if(failure) throw failure;
    if(cancelled)return;
    const addresses=(addressResult.data??[]) as Array<{id:string;customer_id:string;address_line_1:string;town:string|null;postcode:string;access_notes:string|null}>;
    const loadedCustomers:Customer[]=applyServiceMap((customerResult.data??[]).map((r:any)=>{const a=addresses.find(x=>x.customer_id===r.id);return normalizeCustomer({id:r.id,name:r.full_name,email:r.email??'',phone:r.phone??'',address:a?.address_line_1??'',town:a?.town??'',postcode:a?.postcode??'',price:Number(r.standard_price??0),duration:Number(r.service_duration_minutes||0),frequency:Number(r.frequency_weeks??6),notes:r.notes??a?.access_notes??'',service:r.preferred_service??'',serviceLines:r.assigned_services});}), businessId);
    const loadedAppointments:Appointment[]=(appointmentResult.data??[]).map((r:any)=>{const start=new Date(r.starts_at);return {id:r.id,customerId:r.customer_id,date:iso(start),time:`${String(start.getHours()).padStart(2,'0')}:${String(start.getMinutes()).padStart(2,'0')}`,duration:Math.max(5,Math.round((new Date(r.ends_at).getTime()-start.getTime())/60000)),service:r.service_name_snapshot,price:Number(r.price_snapshot),status:(String(r.status).charAt(0).toUpperCase()+String(r.status).slice(1)) as Appointment['status'],address:r.address_snapshot,...(()=>{const meta=unpackApptNotes(r.internal_notes??'');return {notes:meta.notes,oneOff:meta.oneOff,frequency:meta.frequency};})()};});
    const loadedServices:Service[]=(serviceResult.data??[]).map((r:any)=>({name:r.name,duration:Number(r.default_duration_minutes),price:Number(r.default_price)}));
    const loadedPayments:Payment[]=(paymentResult.data??[]).map((r:any)=>({id:r.id,appointmentId:r.appointment_id,amount:Number(r.amount),paidAt:r.paid_at?String(r.paid_at).slice(0,10):null,method:r.method??'cash'}));
    const withInferred=loadedCustomers.map(c=>{ if(customerServiceNames(c).length) return c; const last=loadedAppointments.filter(a=>a.customerId===c.id&&a.status!=='Cancelled').sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time))[0]; return last?withServiceLines(c,[{service:last.service,price:last.price,duration:last.duration}]):c; });
    setCustomers(withInferred); setAppointments(resolveOverlappingAppointments(loadedAppointments)); setPayments(loadedPayments); setServices(loadedServices.length?loadedServices:defaultServices); persistCustomerServices(withInferred,businessId); setCloudStatus('Connected to Supabase'); setRemoteReady(true);
   } catch(error) { if(cancelled)return; setRemoteError(error instanceof Error?error.message:'Could not load the Supabase workspace.'); setCloudStatus('Connection error'); }
  })();
  return ()=>{cancelled=true};
 },[businessId]);
 useEffect(()=>{
  if(!businessId||!supabase||!remoteReady)return;
  const client=supabase;
  const timer=window.setTimeout(()=>{
   const save=async()=>{
    setCloudStatus('Saving changes…');
    const customerRows=customers.map(c=>({id:c.id,business_id:businessId,full_name:c.name,email:c.email||null,phone:c.phone||null,notes:c.notes||null,standard_price:c.price,frequency_weeks:c.frequency,preferred_service:c.service||null,service_duration_minutes:c.duration||null,assigned_services:c.serviceLines?.length?c.serviceLines:null}));
    if(customerRows.length){const {error}=await client.from('customers').upsert(customerRows,{onConflict:'id'});if(error){const msg=String(error.message||'').toLowerCase();if(msg.includes('preferred_service')||msg.includes('service_duration_minutes')||msg.includes('assigned_services')){const fallback=customerRows.map(row=>{const {preferred_service:_ps,service_duration_minutes:_sd,assigned_services:_as,...rest}=row;return rest;});const {error:fallbackError}=await client.from('customers').upsert(fallback,{onConflict:'id'});if(fallbackError)throw fallbackError;}else throw error;}}
    const addressRows=customers.map(c=>({id:c.id,business_id:businessId,customer_id:c.id,label:'Home',address_line_1:c.address||'Address not provided',town:c.town||null,postcode:c.postcode||'UNKNOWN',access_notes:c.notes||null}));
    if(addressRows.length){const {error}=await client.from('customer_addresses').upsert(addressRows,{onConflict:'id'});if(error)throw error;}
    const serviceRows=services.map(s=>({business_id:businessId,name:s.name,default_duration_minutes:s.duration,default_price:s.price,is_bookable_online:true,is_active:true}));
    if(serviceRows.length){const {error}=await client.from('services').upsert(serviceRows,{onConflict:'business_id,name'});if(error)throw error;}
    const appointmentRows=appointments.map(a=>{const start=new Date(`${a.date}T${a.time}:00`);const end=new Date(start.getTime()+a.duration*60000);return {id:a.id,business_id:businessId,customer_id:a.customerId,address_id:customers.some(c=>c.id===a.customerId)?a.customerId:null,starts_at:start.toISOString(),ends_at:end.toISOString(),status:a.status.toLowerCase(),service_name_snapshot:a.service,price_snapshot:a.price,address_snapshot:a.address||'',customer_notes:null,internal_notes:packApptNotes(a.notes,Boolean(a.oneOff),Number(a.frequency)||6),booking_source:a.status==='Pending'?'online':'manual'};});
    if(appointmentRows.length){const {error}=await client.from('appointments').upsert(appointmentRows,{onConflict:'id'});if(error)throw error;}
    const paymentRows=payments.map(p=>({id:p.id,business_id:businessId,appointment_id:p.appointmentId,amount:p.amount,paid_at:p.paidAt?`${p.paidAt}T12:00:00.000Z`:null,method:p.method||'cash'}));
    if(paymentRows.length){const {error}=await client.from('payments').upsert(paymentRows,{onConflict:'id'});if(error)throw error;}
    setCloudStatus('All changes saved');
   };
   syncQueue.current=syncQueue.current.then(save).catch(error=>{const message=error instanceof Error?error.message:'Could not save changes to Supabase.';setCloudStatus('Save failed');setRemoteError(message);setNotice('Supabase save failed: '+message);setTimeout(()=>setNotice(''),7000);});
  },450);
  return ()=>window.clearTimeout(timer);
 },[customers,appointments,payments,services,businessId,remoteReady]);
 const todayAppointments=useMemo(()=>appointments.filter(a=>a.date===selectedDate&&a.status!=='Cancelled').sort((a,b)=>a.time.localeCompare(b.time)),[appointments,selectedDate]);
 const todaysTotal=todayAppointments.reduce((s,a)=>s+a.price,0); const confirmed=appointments.filter(a=>a.status==='Confirmed').length; const pending=appointments.filter(a=>a.status==='Pending').length;
 const overdue=customers.filter(c=>!appointments.some(a=>a.customerId===c.id&&a.date>=addDays(0)&&a.status!=='Cancelled'));
 const overdueFiltered=useMemo(()=>{
  const q=scheduleSearch.trim().toLowerCase();
  if(!q) return overdue;
  return overdue.filter(c=>(c.name+' '+c.address+' '+c.town+' '+c.postcode+' '+c.email+' '+c.phone).toLowerCase().includes(q));
 },[overdue,scheduleSearch]);
 const filteredCustomers=customers.filter(c=>{
  const serviceNames=customerServiceNames(c);
  const hay=(c.name+' '+c.address+' '+c.town+' '+c.postcode+' '+c.email+' '+serviceNames.join(' ')).toLowerCase();
  const matchSearch=!search.trim()||hay.includes(search.toLowerCase());
  const matchCycle=customerFilter==='All customers'||`${c.frequency} weeks`===customerFilter;
  const matchService=serviceFilter==='All services'||(serviceFilter==='Unassigned'?serviceNames.length===0:serviceNames.includes(serviceFilter));
  return matchSearch&&matchCycle&&matchService;
 });
 const customersByService=useMemo(()=>{
  const order=[...services.map(s=>s.name),'Unassigned'];
  const groups=new Map<string,Customer[]>();
  order.forEach(name=>groups.set(name,[]));
  filteredCustomers.forEach(c=>{
   const names=customerServiceNames(c);
   if(!names.length){
    if(!groups.has('Unassigned')) groups.set('Unassigned',[]);
    groups.get('Unassigned')!.push(c);
    return;
   }
   names.forEach(name=>{
    const key=services.some(svc=>svc.name===name)?name:'Unassigned';
    if(!groups.has(key)) groups.set(key,[]);
    const line=customerLineFor(c,name);
    groups.get(key)!.push(line?{...c,service:name,price:line.price,duration:line.duration}:c);
   });
  });
  return order.filter(name=>(groups.get(name)?.length??0)>0).map(name=>({name,customers:groups.get(name)!}));
 },[filteredCustomers,services]);
 const customerName=(id:string)=>customers.find(c=>c.id===id)?.name??'Unknown customer';
 const customersForService=(serviceName:string)=>{
  const assigned=customers.filter(c=>customerHasService(c,serviceName)).map(c=>{const line=customerLineFor(c,serviceName)!;return {...c,service:serviceName,price:line.price,duration:line.duration};});
  const fromJobs=new Set(appointments.filter(a=>a.service===serviceName&&a.status!=='Cancelled').map(a=>a.customerId));
  const merged=new Map(assigned.map(c=>[c.id,c]));
  customers.forEach(c=>{ if(fromJobs.has(c.id)&&!merged.has(c.id)){const line=customerLineFor(c,serviceName);merged.set(c.id,{...c,service:serviceName,price:line?.price??c.price,duration:line?.duration??c.duration});} });
  return Array.from(merged.values()).sort((a,b)=>a.name.localeCompare(b.name));
 };
 const unassignedForService=(serviceName:string)=>customers.filter(c=>!customerHasService(c,serviceName)&&!appointments.some(a=>a.customerId===c.id&&a.service===serviceName&&a.status!=='Cancelled'));
 const serviceJobValue=(serviceName:string)=>appointments.filter(a=>a.service===serviceName&&a.status!=='Cancelled').reduce((sum,a)=>sum+a.price,0);
 const mainServiceName=services.some(s=>s.name===settings.mainService)?settings.mainService:(services[0]?.name||'');
 const defaultServiceName=mainServiceName||selectedService||services[0]?.name||'';
 const defaultService=services.find(s=>s.name===defaultServiceName)||services[0];
 const scheduleCustomer=scheduleCustomerId?customers.find(c=>c.id===scheduleCustomerId)??null:null;
 const lastVisitFor=(customerId:string)=>appointments.filter(a=>a.customerId===customerId&&a.status!=='Cancelled'&&a.date<=addDays(0)).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time))[0]??null;
 const lastVisit=scheduleCustomerId?lastVisitFor(scheduleCustomerId):null;
 const paymentFor=(appointmentId:string)=>payments.find(p=>p.appointmentId===appointmentId&&p.paidAt);
 const isPaid=(appointmentId:string)=>Boolean(paymentFor(appointmentId));
 const pastToSettle=useMemo(()=>appointments.filter(a=>a.date<=addDays(0)&&a.status!=='Cancelled'&&a.status!=='Pending'&&!isPaid(a.id)).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)),[appointments,payments]);
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
 function openDay(date:string){setSelectedDate(date);setDayPanelOpen(true);}
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
  const created:Appointment={id:crypto.randomUUID(),customerId,date,time,duration,service,price,status:'Confirmed',address:customerProperty(customer),oneOff:false,frequency:customer.frequency||6};
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
  if(raw.startsWith('appt:')) swapAppointments(raw.slice(5),targetId);
 }
 function closeSchedule(){setShowAdd(false);setScheduleCustomerId(null);setEditingAppointment(null);}
 const suggestedStartTime=editingAppointment?.time||nextAvailableTime(appointments,scheduleDate||selectedDate||addDays(0));
 function flash(s:string){setNotice(s);setTimeout(()=>setNotice(''),3000)}
 function jobOutcome(appointment:Appointment):'todo'|'done'|'paid'{
  if(isPaid(appointment.id)) return 'paid';
  if(appointment.status==='Completed') return 'done';
  return 'todo';
 }
 function markJobCompleted(id:string){
  setAppointments(p=>p.map(a=>a.id===id?{...a,status:'Completed'}:a));
  setEditingAppointment(a=>a&&a.id===id?{...a,status:'Completed'}:a);
  flash('Marked as done.');
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
 async function markJobPaid(appointment:Appointment, method='cash'){
  if(jobOutcome(appointment)==='todo'){flash('Mark the job as done before taking payment.');return;}
  const existing=payments.find(p=>p.appointmentId===appointment.id);
  const paidAt=addDays(0);
  if(existing){setPayments(p=>p.map(x=>x.id===existing.id?{...x,amount:appointment.price,paidAt,method}:x));}
  else {setPayments(p=>[...p,{id:crypto.randomUUID(),appointmentId:appointment.id,amount:appointment.price,paidAt,method}]);}
  if(appointment.status!=='Completed'){
    setAppointments(p=>p.map(a=>a.id===appointment.id?{...a,status:'Completed'}:a));
    setEditingAppointment(a=>a&&a.id===appointment.id?{...a,status:'Completed'}:a);
  }
  flash('Marked as paid.');
 }
 async function markJobUnpaid(appointmentId:string){
  const existing=payments.find(p=>p.appointmentId===appointmentId);
  if(!existing) return;
  if(businessId&&supabase){const {error}=await supabase.from('payments').delete().eq('business_id',businessId).eq('id',existing.id);if(error){flash('Could not remove payment from the database.');return;}}
  setPayments(p=>p.filter(x=>x.id!==existing.id));
  flash('Payment removed. Job is still done.');
 }
 function JobFlags({appointment}:{appointment:Appointment}){
  const outcome=jobOutcome(appointment);
  if(outcome==='todo') return null;
  return <span className="job-flags"><span className="job-flag flag-done">Done</span>{outcome==='paid'&&<span className="job-flag flag-paid">Paid</span>}</span>;
 }
 function JobQuickActions({appointment}:{appointment:Appointment}){
  const outcome=jobOutcome(appointment);
  return <div className="job-quick-actions" onClick={e=>e.stopPropagation()}>
   {outcome==='todo'&&<button type="button" className="button tiny primary" onClick={()=>markJobCompleted(appointment.id)}>Done</button>}
   {outcome==='done'&&<button type="button" className="button tiny primary" onClick={()=>void markJobPaid(appointment)}>Pay</button>}
   {outcome==='paid'&&<span className="button tiny secondary paid-state">Paid</span>}
  </div>;
 }
 function setMainService(name:string){setSettings(s=>({...s,mainService:name}));flash(`“${name}” is now your main service.`);}
 function assignCustomerToService(customerId:string, serviceName:string){setCustomers(p=>p.map(c=>{if(c.id!==customerId||customerHasService(c,serviceName))return c;const catalog=services.find(s=>s.name===serviceName);return withServiceLines(c,[...customerServiceNames(c).map(name=>customerLineFor(c,name)!).filter(Boolean),{service:serviceName,price:0,duration:catalog?.duration??30}]);}));flash('Customer assigned to service.');}
 function unassignCustomerFromService(customerId:string){setCustomers(p=>p.map(c=>{if(c.id!==customerId)return c;const remaining=(c.serviceLines||[]).filter(line=>line.service!==selectedService);return withServiceLines(c,remaining);}));flash('Customer removed from this service.');}
 async function removeAppointment(id:string){const relatedPayments=payments.filter(p=>p.appointmentId===id);if(businessId&&supabase){for(const pay of relatedPayments){const {error}=await supabase.from('payments').delete().eq('business_id',businessId).eq('id',pay.id);if(error){flash('Could not delete related payments.');return;}}const {error}=await supabase.from('appointments').delete().eq('business_id',businessId).eq('id',id);if(error){flash('Could not delete the appointment from the database.');return;}}setPayments(p=>p.filter(x=>x.appointmentId!==id));setAppointments(p=>p.filter(x=>x.id!==id));flash('Appointment deleted.');}
 async function removeService(name:string){if(!window.confirm(`Remove “${name}”? Customers keep their history, but this service will no longer be offered.`))return;if(businessId&&supabase){const {error}=await supabase.from('services').delete().eq('business_id',businessId).eq('name',name);if(error){flash('Could not remove the service from the database.');return;}}setServices(p=>p.filter(x=>x.name!==name));setCustomers(p=>p.map(c=>withServiceLines(c,(c.serviceLines||[]).filter(line=>line.service!==name))));if(selectedService===name)setSelectedService(null);setSettings(s=>s.mainService===name?{...s,mainService:''}:s);flash('Service removed.');}
 function saveServiceForm(form:HTMLFormElement){const fd=new FormData(form);const name=String(fd.get('name')).trim();if(!name){flash('Please enter a service name.');return;}const duration=editingService?.duration??30;const price=editingService?.price??24;if(editingService){const oldName=editingService.name;if(name!==oldName&&services.some(s=>s.name===name)){flash('A service with that name already exists.');return;}setServices(p=>p.map(s=>s.name===oldName?{name,duration,price}:s));if(name!==oldName){setCustomers(p=>p.map(c=>withServiceLines(c,(c.serviceLines||[]).map(line=>line.service===oldName?{...line,service:name}:line))));setAppointments(p=>p.map(a=>a.service===oldName?{...a,service:name}:a));if(selectedService===oldName)setSelectedService(name);setSettings(s=>s.mainService===oldName?{...s,mainService:name}:s);}flash('Service updated.');}else{if(services.some(s=>s.name===name)){flash('A service with that name already exists.');return;}setServices(p=>[...p,{name,duration,price}]);if(!settings.mainService)setSettings(s=>({...s,mainService:name}));flash('Service added.');}setShowServiceForm(false);setEditingService(null);}
 function saveAppointment(form:HTMLFormElement){
  const fd=new FormData(form); const customerId=String(fd.get('customerId')); const customer=customers.find(c=>c.id===customerId); if(!customer)return;
  const date=String(fd.get('date')||editingAppointment?.date||'').trim(); const time=String(fd.get('time')||editingAppointment?.time||'').slice(0,5); const duration=Math.max(5,Number(fd.get('duration'))||editingAppointment?.duration||30);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){flash('Please enter the date as DD/MM/YYYY.');return;}
  if(!/^\d{2}:\d{2}$/.test(time)){flash('Please choose a start time.');return;}
  const service=String(fd.get('service')); const price=Number(fd.get('price')); const notes=String(fd.get('notes')||''); const address=customerProperty(customer);
  const cycleRaw=String(fd.get('cycle')||'');
  const oneOff=cycleRaw==='oneoff';
  const frequency=oneOff?6:(CYCLE_WEEKS.includes(Number(cycleRaw) as typeof CYCLE_WEEKS[number])?Number(cycleRaw):(customer.frequency||6));
  const applyCustomerCycle=()=>{
   if(oneOff) return;
   setCustomers(p=>p.map(c=>{
    if(c.id!==customerId) return c;
    const withFreq={...c,frequency};
    if(customerHasService(withFreq,service)) return withFreq;
    const catalog=services.find(x=>x.name===service);
    return withServiceLines(withFreq,[...(withFreq.serviceLines||[]),{service,price:price||catalog?.price||0,duration}]);
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
 function CustomersToSchedulePanel({limit}:{limit?:number}){
  const filtered=overdueFiltered;
  const list=!scheduleSearch.trim()&&typeof limit==='number'?filtered.slice(0,limit):filtered;
  return <section className="panel customer-panel"><div className="panel-heading"><div><h2>Customers to schedule</h2><p>Drag onto Day schedule to book</p></div><button className="text-button" onClick={()=>setPage('Customers')}>View all <ChevronRight size={15}/></button></div><div className="search-field schedule-search"><Search size={16}/><input value={scheduleSearch} onChange={e=>setScheduleSearch(e.target.value)} placeholder="Search customers, postcodes..."/></div>{overdue.length===0?<div className="success-empty"><CheckCircle2 size={20}/> All customers have an upcoming appointment.</div>:filtered.length===0?<div className="day-panel-empty">No customers match your search.</div>:<div className="compact-customers">{list.map(c=>{const prev=lastVisitFor(c.id);return <div className="compact-customer compact-customer-clickable" key={c.id} draggable role="button" tabIndex={0} onDragStart={e=>onCalDragStart(e,'cust:'+c.id)} onClick={()=>openCustomerForm(c)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCustomerForm(c);}}}><div className="customer-avatar">{initials(c.name)}</div><div className="compact-customer-info"><strong>{c.name}</strong><span>{[c.town,c.postcode].filter(Boolean).join(' · ')} · Every {c.frequency} weeks · {c.duration} min{prev?` · Last ${dateLabel(prev.date)}`:''}</span></div><div className="compact-price">{money(c.price)}</div><button className="round-plus" title={`Schedule ${c.name}`} onClick={e=>{e.stopPropagation();openSchedule(c.id);}}><Plus size={15}/></button></div>})}</div>}</section>;
 }
 function openCustomerForm(customer?:Customer|null){const original=customer?customers.find(c=>c.id===customer.id)??customer:null;setEditingCustomer(original);setShowCustomer(true);}
 function closeCustomerForm(){setShowCustomer(false);setEditingCustomer(null);}
 function saveCustomerForm(form:HTMLFormElement){const fd=new FormData(form); const name=String(fd.get('name')).trim(); if(!name)return; let serviceLines:CustomerServiceLine[]=[]; try{serviceLines=parseServiceLines(JSON.parse(String(fd.get('serviceLines')||'[]')));}catch{serviceLines=[];} if(!serviceLines.length){flash('Please add at least one service.');return;} if(serviceLines.some(line=>!Number.isFinite(line.price)||line.price<0||String(line.price)==='')){flash('Please enter a job price for each service.');return;} if(serviceLines.some(line=>!Number.isFinite(line.duration)||line.duration<5)){flash('Please enter a valid duration for each service.');return;} const primary=serviceLines[0]; const base={name,email:String(fd.get('email')),phone:String(fd.get('phone')),address:String(fd.get('address')),town:String(fd.get('town')||'').trim(),postcode:String(fd.get('postcode')).toUpperCase(),frequency:Number(fd.get('frequency')||6),notes:String(fd.get('notes')||''),service:primary.service,price:primary.price,duration:primary.duration,serviceLines}; if(editingCustomer){setCustomers(p=>p.map(c=>c.id===editingCustomer.id?normalizeCustomer({...c,...base}):c));closeCustomerForm();flash('Customer updated.');return;} const c=normalizeCustomer({id:crypto.randomUUID(),...base});setCustomers(p=>[c,...p]);closeCustomerForm();flash('Customer added successfully.');}
 async function removeCustomer(id:string){const customer=customers.find(c=>c.id===id);if(!customer)return;if(!window.confirm(`Delete ${customer.name}? Their future appointments will also be removed.`))return;const related=appointments.filter(a=>a.customerId===id);if(businessId&&supabase){for(const a of related){const {error}=await supabase.from('appointments').delete().eq('business_id',businessId).eq('id',a.id);if(error){flash('Could not delete related appointments.');return;}}const {error}=await supabase.from('customers').delete().eq('business_id',businessId).eq('id',id);if(error){flash('Could not delete the customer from the database.');return;}}setAppointments(p=>p.filter(a=>a.customerId!==id));setCustomers(p=>p.filter(c=>c.id!==id));flash('Customer deleted.');}
 function bookOnline(form:HTMLFormElement){const fd=new FormData(form);const name=String(fd.get('name')).trim();if(!name)return;const serviceName=String(fd.get('service'));const svc=services.find(s=>s.name===serviceName);const price=Number(fd.get('price'));let customer=customers.find(c=>c.email.toLowerCase()===String(fd.get('email')).toLowerCase());if(!customer){customer=normalizeCustomer({id:crypto.randomUUID(),name,email:String(fd.get('email')),phone:String(fd.get('phone')),address:String(fd.get('address')),town:'',postcode:String(fd.get('postcode')).toUpperCase(),price,duration:svc?.duration??30,frequency:6,notes:'',service:serviceName,serviceLines:[{service:serviceName,price,duration:svc?.duration??30}]});setCustomers(p=>[customer!,...p]);}else{setCustomers(p=>p.map(c=>{if(c.id!==customer!.id)return c;const next=customerHasService(c,serviceName)?c:withServiceLines(c,[...(c.serviceLines||[]),{service:serviceName,price,duration:svc?.duration??30}]);return {...next,phone:String(fd.get('phone'))||c.phone,address:String(fd.get('address'))||c.address,postcode:String(fd.get('postcode')).toUpperCase()||c.postcode};}));}const date=String(fd.get('date')||'').trim();const time=String(fd.get('time'));if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){flash('Please enter the date as DD/MM/YYYY.');return;}if(date<addDays(1)){flash('Please choose a preferred date from tomorrow onwards.');return;}if(settings.preventOverlap&&appointments.some(a=>a.date===date&&a.time===time&&a.status!=='Cancelled')){flash('Sorry, that time has just been booked. Please choose another slot.');return;}setAppointments(p=>[{id:crypto.randomUUID(),customerId:customer!.id,date,time,duration:customer!.duration||svc?.duration||30,service:serviceName,price,status:settings.requireConfirmation?'Pending':'Confirmed',address:customerProperty({address:String(fd.get('address')),town:customer!.town,postcode:String(fd.get('postcode')).toUpperCase()}),oneOff:false,frequency:customer!.frequency||6},...p]);setShowBooking(false);setPage('Online bookings');flash(settings.requireConfirmation?'Booking request received. Review it in Online bookings.':'Booking confirmed and added to your calendar.');}
 async function saveSettings(form:HTMLFormElement){const fd=new FormData(form);const next:BusinessSettings={...settings,name:String(fd.get('name')).trim()||settings.name,email:String(fd.get('email')).trim(),phone:String(fd.get('phone')).trim(),postcode:String(fd.get('postcode')).trim().toUpperCase(),workingDays:String(fd.get('workingDays')),timezone:String(fd.get('timezone'))};setSettings(next);if(businessId&&supabase){const {error}=await supabase.from('businesses').update({name:next.name,email:next.email||null,phone:next.phone||null}).eq('id',businessId);if(error){flash('Could not save settings to Supabase: '+error.message);return;}}flash('Settings saved.');}
 const weekDates=Array.from({length:7},(_,i)=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()-((d.getDay()+6)%7)+i);return iso(d)});
 const dayDates=[selectedDate];
 const twoWeekDates=Array.from({length:14},(_,i)=>{const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()-((d.getDay()+6)%7)+i);return iso(d)});
 const monthDates=useMemo(()=>{
  const anchor=new Date(selectedDate+'T12:00:00');
  const first=new Date(anchor.getFullYear(),anchor.getMonth(),1);
  const last=new Date(anchor.getFullYear(),anchor.getMonth()+1,0);
  const gridStart=new Date(first); gridStart.setDate(first.getDate()-((first.getDay()+6)%7));
  const gridEnd=new Date(last); gridEnd.setDate(last.getDate()+((7-last.getDay())%7));
  const days:string[]=[];
  for(const d=new Date(gridStart);d<=gridEnd;d.setDate(d.getDate()+1)) days.push(iso(d));
  return days;
 },[selectedDate]);
 const calendarDates=calendarMode==='Day'?dayDates:calendarMode==='Week'?weekDates:calendarMode==='2weeks'?twoWeekDates:monthDates;
 const selectedMonth=new Date(selectedDate+'T12:00:00').getMonth();
 if(businessId&&!remoteReady){return <div className="auth-shell"><div className="auth-card"><div className="brand-mark auth-brand-mark"><Sparkles size={21}/></div><h1>{remoteError?'Could not load your workspace':'Connecting MyPurePlan'}</h1><p>{remoteError?'MyPurePlan could not read the database. Check that the SQL migration was run and the connection settings are correct.':'Loading your customers, services and appointments from Supabase…'}</p>{remoteError&&<><pre className="auth-error-detail">{remoteError}</pre><button className="button primary auth-submit" onClick={()=>window.location.reload()}>Try again</button></>}<button className="auth-text-button" onClick={()=>onSignOut?.()}>Sign out</button></div></div>}
 return <div className={`app-shell ${navExpanded?'nav-expanded':'nav-collapsed'}`}>
  <aside className={`sidebar ${navExpanded?'':'sidebar-collapsed'} ${menuOpen?'sidebar-open':''}`}>
   <div className="sidebar-tools"><button type="button" className="icon-button nav-toggle" aria-label={navExpanded?'Collapse navigation':'Expand navigation'} title={navExpanded?'Collapse menu':'Expand menu'} onClick={()=>{if(typeof window!=='undefined'&&window.matchMedia('(max-width:960px)').matches){setMenuOpen(false);return;}setNavExpanded(v=>!v);}}><Menu size={20}/></button><button type="button" className="icon-button mobile-close" aria-label="Close menu" onClick={()=>setMenuOpen(false)}><X size={18}/></button></div>
   <div className="brand"><div className="brand-mark" title="MyPurePlan"><Sparkles size={20}/></div><div className="brand-copy"><strong>MyPurePlan</strong><span>WINDOW CARE PRO</span></div></div>
   <div className="workspace" title={settings.name||businessName||'Business'}><div className="workspace-avatar">{initials(settings.name||businessName||'Business')}</div><div className="workspace-copy"><strong>{settings.name||businessName||'Business workspace'}</strong><span>Business workspace</span></div><ChevronDown size={15}/></div>
   <div className="nav-label">WORKSPACE</div><nav>{nav.map(item=><button key={item.id} title={item.id} className={`nav-item ${page===item.id?'active':''}`} onClick={()=>{setPage(item.id);setMenuOpen(false)}}><item.icon size={18}/><span>{item.id}</span>{item.id==='Online bookings'&&pending>0&&<b className="nav-count">{pending}</b>}</button>)}</nav>
   <div className="nav-label tools-label">MANAGE</div><button title="Finance" className={`nav-item ${page==='Finance'?'active':''}`} onClick={()=>setPage('Finance')}><Wallet size={18}/><span>Finance</span></button><button title="Reports" className={`nav-item ${page==='Reports'?'active':''}`} onClick={()=>setPage('Reports')}><Activity size={18}/><span>Reports</span></button><button title="Settings" className={`nav-item ${page==='Settings'?'active':''}`} onClick={()=>setPage('Settings')}><Settings size={18}/><span>Settings</span></button>
   <div className="sidebar-bottom"><div className="upgrade-card"><div className="upgrade-icon"><Sparkles size={17}/></div><strong>Make every day count</strong><p>Keep your rounds organised and your customers happy.</p><button onClick={()=>setPage('Finance')}>View finance <ArrowUpRight size={14}/></button></div><div className="profile-row" title="Business owner"><div className="profile-avatar">RB</div><div className="profile-copy"><strong>Business owner</strong><span>Free workspace</span></div><MoreHorizontal size={18}/></div></div>
  </aside>
  <main className="main-area"><header className="topbar"><div className="topbar-left"><button type="button" className="icon-button nav-toggle mobile-menu" aria-label="Open navigation" title="Open menu" onClick={()=>setMenuOpen(true)}><Menu size={20}/></button><div className="breadcrumb">Workspace <ChevronRight size={14}/> <strong>{page}</strong></div></div><div className="topbar-actions"><button className="online-link" onClick={()=>setShowBooking(true)}><ExternalLink size={15}/> Booking page</button><span className="topbar-divider"/><button className="avatar-small" title="Sign out" onClick={()=>onSignOut?.()}>{(userEmail||'BO').slice(0,1).toUpperCase()}</button></div></header>
  <div className="content">
   {page==='Dashboard'&&<><div className="page-heading"><div><div className="eyebrow"><CloudSun size={14}/> YOUR BUSINESS AT A GLANCE</div><h1>Good morning, Robert <span className="wave">✦</span></h1><p>Here’s what’s happening with your window cleaning business.</p></div><div className="heading-actions"><button className="button secondary" onClick={()=>{setSelectedDate(addDays(0));setPage('Calendar')}}><CalendarDays size={16}/> View calendar</button><button className="button primary" onClick={()=>openSchedule()}><Plus size={17}/> New appointment</button></div></div>
    <div className="stats-grid"><Stat icon={<CalendarCheck size={19}/>} label="Today's appointments" value={String(todayAppointments.length)} sub={`${appointments.filter(a=>a.date===addDays(0)&&a.status==='Completed').length} completed`} tone="blue"/><Stat icon={<CircleDollarSign size={20}/>} label="Scheduled revenue today" value={money(todaysTotal)} sub="Based on booked jobs" tone="green"/><Stat icon={<Clock3 size={19}/>} label="Awaiting confirmation" value={String(pending)} sub="Online booking requests" tone="amber"/><Stat icon={<Users size={19}/>} label="Customers to schedule" value={String(overdue.length)} sub="No upcoming appointment" tone="purple"/></div>
    <div className="dashboard-grid"><section className="panel schedule-panel"><div className="panel-heading schedule-heading"><div className="schedule-heading-main"><h2>{selectedDate===addDays(0)?"Today's schedule":'Day schedule'}</h2><div className="schedule-date-nav"><button type="button" className="icon-button" aria-label="Previous day" onClick={()=>setSelectedDate(shiftIsoDate(selectedDate,-1))}><ChevronLeft size={16}/></button><UkDateInput name="dashboardScheduleDate" value={selectedDate} onIsoChange={setSelectedDate} required/><button type="button" className="icon-button" aria-label="Next day" onClick={()=>setSelectedDate(shiftIsoDate(selectedDate,1))}><ChevronRight size={16}/></button><button type="button" className={`button tiny secondary schedule-today-btn${selectedDate===addDays(0)?' is-placeholder':''}`} aria-hidden={selectedDate===addDays(0)} tabIndex={selectedDate===addDays(0)?-1:0} onClick={()=>setSelectedDate(addDays(0))}>Today</button></div></div><button className="text-button" onClick={()=>setPage('Calendar')}>Full calendar <ChevronRight size={15}/></button></div><div className="schedule-list" onDragOver={onDayDragOver} onDrop={e=>onDayDrop(e,selectedDate)}>{todayAppointments.length===0?<EmptyState title="Nothing scheduled for this day" text="Drop a customer here, or add an appointment." action="Add appointment" onClick={()=>openSchedule()}/>:todayAppointments.map(a=><div className={`schedule-item schedule-item-clickable outcome-${jobOutcome(a)}`} key={a.id} draggable role="button" tabIndex={0} onDragStart={e=>onCalDragStart(e,'appt:'+a.id)} onDragOver={onDayDragOver} onDrop={e=>onApptDrop(e,a.id)} onClick={()=>openEditAppointment(a)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openEditAppointment(a);}}}><div className="time-col"><strong>{timeRange(a)}</strong></div><div className="schedule-details"><div className="schedule-title-row"><strong>{customerName(a.customerId)}</strong><JobFlags appointment={a}/></div><div className="schedule-meta"><span><MapPin size={13}/>{a.address}</span><span><Wrench size={13}/>{a.service}</span></div></div><div className="schedule-price"><JobQuickActions appointment={a}/><strong className="schedule-amount">{money(a.price)}</strong><button className="mini-more" title="Edit appointment" onClick={e=>{e.stopPropagation();openEditAppointment(a)}}><Pencil size={15}/></button></div></div>)}</div><button className="add-inline" onClick={()=>openSchedule()}><Plus size={15}/> Add appointment</button></section>
    <section className="panel week-panel"><div className="panel-heading"><div><h2>This week</h2><p>Your upcoming workload</p></div><button className="icon-button" onClick={()=>setPage('Calendar')}><ArrowUpRight size={17}/></button></div><div className="week-summary"><div><span className="summary-number">{appointments.filter(a=>weekDates.includes(a.date)&&a.status!=='Cancelled').length}</span><span className="summary-label">Scheduled jobs</span></div><div><span className="summary-number">{money(appointments.filter(a=>weekDates.includes(a.date)&&a.status!=='Cancelled').reduce((s,a)=>s+a.price,0))}</span><span className="summary-label">Potential revenue</span></div></div><div className="mini-week">{weekDates.map((d,i)=>{const count=appointments.filter(a=>a.date===d&&a.status!=='Cancelled').length;const isSelected=d===selectedDate;return <button key={d} className={`mini-day ${isSelected?'selected':''} ${d===addDays(0)?'is-today':''}`} onClick={()=>setSelectedDate(d)}><span>{new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short'})}</span><strong>{new Date(d+'T12:00:00').getDate()}</strong><i className={count?'has-jobs':''}/></button>})}</div><div className="week-legend"><span><i className="legend-dot blue-dot"/> Appointment scheduled</span><span><i className="legend-dot gray-dot"/> Available</span></div><div className="next-job"><div className="next-job-icon"><MapPin size={16}/></div><div><span className="small-label">NEXT ON THE ROUTE</span><strong>{appointments.filter(a=>a.date>=addDays(0)&&a.status!=='Cancelled').sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))[0]?.address??'No upcoming jobs'}</strong><span>{appointments.filter(a=>a.date>=addDays(0)&&a.status!=='Cancelled').sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))[0]?`${customerName(appointments.filter(a=>a.date>=addDays(0)&&a.status!=='Cancelled').sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))[0].customerId)} · ${dateLabel(appointments.filter(a=>a.date>=addDays(0)&&a.status!=='Cancelled').sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))[0].date)}`:'Add a job to start planning your route'}</span></div></div></section></div>
    <div className="bottom-grid"><CustomersToSchedulePanel limit={4}/><section className="panel settle-panel"><div className="panel-heading"><div><h2>Past jobs to settle</h2><p>Needs Done or Pay</p></div><button className="text-button" onClick={()=>setPage('Finance')}>Open Finance <ChevronRight size={15}/></button></div>{pastToSettle.length===0?<div className="success-empty"><CheckCircle2 size={20}/> All past jobs are marked paid.</div>:<div className="settle-list">{pastToSettle.slice(0,6).map(a=><div className={`settle-row outcome-${jobOutcome(a)}`} key={a.id}><div className="settle-main" role="button" tabIndex={0} onClick={()=>openEditAppointment(a)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openEditAppointment(a);}}}><strong>{customerName(a.customerId)}</strong><span>{dateLabel(a.date)} · {a.time} · {money(a.price)}</span><JobFlags appointment={a}/></div><JobQuickActions appointment={a}/></div>)}</div>}</section></div>
   </>}
   {page==='Calendar'&&<><div className="page-heading"><div><div className="eyebrow"><CalendarDays size={14}/> PLAN YOUR ROUNDS</div><h1>Calendar</h1><p>Drag jobs to swap them, or onto another day. Drag customers from To schedule.</p></div><div className="heading-actions"><div className="segmented"><button className={calendarMode==='Day'?'chosen':''} onClick={()=>setCalendarMode('Day')}>Day</button><button className={calendarMode==='Week'?'chosen':''} onClick={()=>setCalendarMode('Week')}>Week</button><button className={calendarMode==='2weeks'?'chosen':''} onClick={()=>setCalendarMode('2weeks')}>2 weeks</button><button className={calendarMode==='Month'?'chosen':''} onClick={()=>setCalendarMode('Month')}>Month</button></div><button className="button primary" onClick={()=>openSchedule()}><Plus size={17}/> New appointment</button></div></div>
    <div className={`calendar-layout${dayPanelOpen?' has-day-panel':''}`}>
     <aside className="unassigned-rail">
      <div className="unassigned-rail-head"><h3>To schedule</h3><span>{scheduleSearch.trim()?overdueFiltered.length:overdue.length}</span></div>
      <div className="search-field schedule-search"><Search size={16}/><input value={scheduleSearch} onChange={e=>setScheduleSearch(e.target.value)} placeholder="Search customers, postcodes..."/></div>
      <p className="queue-hint">Drag onto a day to book.</p>
      <div className="queue-list">{overdue.length===0?<div className="day-panel-empty">All customers are scheduled.</div>:overdueFiltered.length===0?<div className="day-panel-empty">No customers match your search.</div>:overdueFiltered.map(c=>{const prev=lastVisitFor(c.id);return <div key={c.id} className="queue-card" draggable onDragStart={e=>onCalDragStart(e,'cust:'+c.id)}><div className="customer-avatar">{initials(c.name)}</div><div className="queue-card-info"><strong>{c.name}</strong><span>{[c.town,c.postcode].filter(Boolean).join(' · ')||'No address'}{prev?` · Last ${dateLabel(prev.date)}`:''}</span></div><button type="button" className="round-plus" title={`Schedule ${c.name}`} onClick={()=>openSchedule(c.id)}><Plus size={15}/></button></div>})}</div>
     </aside>
     <div className="panel calendar-panel">
      <div className="calendar-toolbar"><div className="calendar-date-title"><h2>{calendarMode==='Day'?dateLabel(selectedDate):calendarMode==='Week'?`${dateLabel(weekDates[0])} – ${dateLabel(weekDates[6])}`:calendarMode==='2weeks'?`${dateLabel(twoWeekDates[0])} – ${dateLabel(twoWeekDates[13])}`:dateLabel(selectedDate).slice(3)}</h2><button className="button tiny secondary" onClick={()=>openDay(addDays(0))}>Today</button></div><div className="calendar-nav"><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');if(calendarMode==='Day'){d.setDate(d.getDate()-1);}else if(calendarMode==='Week'){d.setDate(d.getDate()-7);}else if(calendarMode==='2weeks'){d.setDate(d.getDate()-14);}else{d.setMonth(d.getMonth()-1,1);}setSelectedDate(iso(d))}}><ChevronLeft size={17}/></button><button className="icon-button" onClick={()=>{const d=new Date(selectedDate+'T12:00:00');if(calendarMode==='Day'){d.setDate(d.getDate()+1);}else if(calendarMode==='Week'){d.setDate(d.getDate()+7);}else if(calendarMode==='2weeks'){d.setDate(d.getDate()+14);}else{d.setMonth(d.getMonth()+1,1);}setSelectedDate(iso(d))}}><ChevronRight size={17}/></button></div></div>
      {(calendarMode==='Month'||calendarMode==='2weeks')&&<div className="calendar-weekday-row">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=><span key={d}>{d}</span>)}</div>}
      <div className={`calendar-grid ${calendarMode==='Month'||calendarMode==='2weeks'?'calendar-grid-month':''} ${calendarMode==='Week'?'calendar-grid-week':''} ${calendarMode==='Day'?'calendar-grid-day':''}`}>{calendarDates.map(d=>{const inMonth=new Date(d+'T12:00:00').getMonth()===selectedMonth;const dayJobs=appointments.filter(a=>a.date===d&&a.status!=='Cancelled').sort((a,b)=>a.time.localeCompare(b.time));return <div className={`calendar-day ${d===selectedDate&&dayPanelOpen?'day-selected':''} ${d===addDays(0)?'day-today':''} ${calendarMode==='Month'&&!inMonth?'day-outside':''}`} key={d} role="button" tabIndex={0} onClick={()=>openDay(d)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openDay(d);}}} onDragOver={onDayDragOver} onDrop={e=>onDayDrop(e,d)}><div className="day-head"><span>{calendarMode==='Month'||calendarMode==='2weeks'?'':new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:calendarMode==='Day'?'long':'short'})}</span><strong>{new Date(d+'T12:00:00').getDate()}</strong></div><div className="day-events">{dayJobs.map(a=><div key={a.id} draggable className={`event-chip ${a.status==='Pending'?'event-pending':''}`} onDragStart={e=>{e.stopPropagation();onCalDragStart(e,'appt:'+a.id);}} onDragOver={onDayDragOver} onDrop={e=>onApptDrop(e,a.id)} onClick={e=>{e.stopPropagation();openEditAppointment(a);}}><b>{timeRange(a)}</b> {customerName(a.customerId).split(' ')[0]} <i className="chip-service">{serviceShort(a.service)}</i><i className="chip-cycle">{cycleShort(a)}</i></div>)}{dayJobs.length===0&&inMonth&&<span className="no-event">Drop here</span>}</div></div>})}</div>
     </div>
     {dayPanelOpen&&<aside className="day-panel"><div className="day-panel-head"><div><h3>{dateLabel(selectedDate)}</h3><p>{todayAppointments.length} job{todayAppointments.length===1?'':'s'} · {money(todaysTotal)}</p></div><button type="button" className="icon-button" aria-label="Close day panel" onClick={()=>setDayPanelOpen(false)}><X size={17}/></button></div><div className="day-panel-actions"><button type="button" className="button tiny primary" onClick={()=>openSchedule()}><Plus size={14}/> Add</button></div><div className="day-panel-list" onDragOver={onDayDragOver} onDrop={e=>onDayDrop(e,selectedDate)}>{todayAppointments.length===0?<div className="day-panel-empty">No jobs. Drop a customer here or add one.</div>:todayAppointments.map(a=><div key={a.id} className={`day-job outcome-${jobOutcome(a)}`} draggable onDragStart={e=>onCalDragStart(e,'appt:'+a.id)} onDragOver={onDayDragOver} onDrop={e=>onApptDrop(e,a.id)} onClick={()=>openEditAppointment(a)} role="button" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openEditAppointment(a);}}}><div className="day-job-main"><strong>{timeRange(a)} · {customerName(a.customerId)}</strong><span>{a.service} · {cycleLabel(a)} · {money(a.price)}</span><JobFlags appointment={a}/></div><div className="day-job-actions" onClick={e=>e.stopPropagation()}><JobQuickActions appointment={a}/></div></div>)}</div></aside>}
    </div></>}
   
{page==='Customers'&&<><div className="page-heading"><div><div className="eyebrow"><Users size={14}/> CUSTOMER RELATIONSHIPS</div><h1>Customers</h1><p>Browse by service category, edit details, or schedule the next visit.</p></div><div className="heading-actions"><button className="button secondary" onClick={()=>exportCSV(customers)}><Download size={16}/> Export CSV</button><button className="button primary" onClick={()=>openCustomerForm()}><Plus size={17}/> Add customer</button></div></div>
    <div className="panel table-panel"><div className="table-controls"><div className="search-field"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customers, postcodes..."/></div><div className="filter-control"><Wrench size={15}/><select value={serviceFilter} onChange={e=>setServiceFilter(e.target.value)}><option>All services</option>{services.map(s=><option key={s.name} value={s.name}>{s.name}</option>)}<option>Unassigned</option></select></div><div className="filter-control"><Filter size={15}/><select value={customerFilter} onChange={e=>setCustomerFilter(e.target.value)}><option>All customers</option><option>4 weeks</option><option>6 weeks</option><option>8 weeks</option><option>10 weeks</option><option>12 weeks</option></select></div><span className="result-count">{filteredCustomers.length} customers</span></div></div>
    {customersByService.length===0?<div className="panel table-panel"><EmptyState title="No customers found" text="Try a different search or add a customer." action="Add customer" onClick={()=>openCustomerForm()}/></div>:customersByService.map(group=><div className="panel table-panel customer-service-group" key={group.name}><div className="panel-heading padded-heading"><div><h2>{group.name}</h2><p>{group.customers.length} customer{group.customers.length===1?'':'s'} in this service</p></div>{group.name!=='Unassigned'&&<button className="text-button" onClick={()=>{setSelectedService(group.name);setPage('Services & pricing');}}>Open service <ChevronRight size={15}/></button>}</div><div className="table-wrap"><table><thead><tr><th>Customer</th><th>Property</th><th>Cleaning cycle</th><th>Price</th><th>Contact</th><th></th></tr></thead><tbody>{group.customers.map(c=><tr key={c.id} className="clickable-row" role="button" tabIndex={0} onClick={()=>openCustomerForm(c)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCustomerForm(c);}}}><td><div className="table-customer"><div className="customer-avatar">{initials(c.name)}</div><div><strong>{c.name}</strong><small>{c.email||'No email added'}</small></div></div></td><td><span>{c.address}</span><small className="table-sub">{[c.town,c.postcode].filter(Boolean).join(' · ')}</small></td><td><span className="cycle-pill">Every {c.frequency} weeks · {c.duration} min</span></td><td><strong>{money(c.price)}</strong></td><td><span>{c.phone||'—'}</span></td><td><div className="row-actions" onClick={e=>e.stopPropagation()}><button className="icon-button" title="Schedule appointment" onClick={()=>openSchedule(c.id)}><Plus size={16}/></button><button className="icon-button" title="Edit customer" onClick={()=>openCustomerForm(c)}><Pencil size={15}/></button><button className="icon-button" title="Delete customer" onClick={()=>void removeCustomer(c.id)}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div></div>)}</>}
   {page==='Online bookings'&&<><div className="page-heading"><div><div className="eyebrow"><CalendarCheck size={14}/> CUSTOMER SELF-SERVICE</div><h1>Online bookings</h1><p>Review requests and manage your public booking page.</p></div><div className="heading-actions"><button className="button secondary" onClick={()=>setShowBooking(true)}><ExternalLink size={16}/> Preview booking page</button></div></div><div className="booking-banner"><div className="booking-banner-icon"><Link2 size={21}/></div><div><strong>Your online booking page is ready to preview</strong><p>Customers can request a window cleaning slot. Requests appear here as pending until you confirm them.</p></div><button className="button primary" onClick={()=>setShowBooking(true)}>Open booking page <ArrowUpRight size={15}/></button></div><div className="stats-grid compact-stats"><Stat icon={<Clock3 size={19}/>} label="Awaiting review" value={String(appointments.filter(a=>a.status==='Pending').length)} sub="Needs your attention" tone="amber"/><Stat icon={<CheckCircle2 size={19}/>} label="Confirmed appointments" value={String(appointments.filter(a=>a.status==='Confirmed').length)} sub="On your calendar" tone="green"/><Stat icon={<CalendarDays size={19}/>} label="All bookings" value={String(appointments.filter(a=>a.status!=='Cancelled').length)} sub="Including repeat visits" tone="blue"/><Stat icon={<CircleDollarSign size={20}/>} label="Booked value" value={money(appointments.filter(a=>a.status!=='Cancelled').reduce((s,a)=>s+a.price,0))} sub="Before expenses" tone="purple"/></div><div className="panel table-panel"><div className="panel-heading padded-heading"><div><h2>Booking requests & appointments</h2><p>Confirm a request to add it to your working schedule.</p></div></div><div className="table-wrap"><table><thead><tr><th>Date & time</th><th>Customer</th><th>Service / address</th><th>Status</th><th>Price</th><th>Actions</th></tr></thead><tbody>{appointments.filter(a=>a.status!=='Cancelled').sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(a=><tr key={a.id}><td><strong>{dateLabel(a.date)}</strong><small className="table-sub">{a.time} · {a.duration} min</small></td><td><strong>{customerName(a.customerId)}</strong></td><td><span>{a.service}</span><small className="table-sub">{a.address}</small></td><td><Status status={a.status}/></td><td><strong>{money(a.price)}</strong></td><td>{a.status==='Pending'?<button className="button tiny primary" onClick={()=>{setAppointments(p=>p.map(x=>x.id===a.id?{...x,status:'Confirmed'}:x));flash('Booking confirmed.')}}><Check size={14}/> Confirm</button>:<button className="button tiny secondary" onClick={()=>{setAppointments(p=>p.map(x=>x.id===a.id?{...x,status:'Cancelled'}:x));flash('Appointment cancelled.')}}>Cancel</button>}</td></tr>)}</tbody></table></div></div></>}
   {page==='Services & pricing'&&<><div className="page-heading"><div><div className="eyebrow"><Wrench size={14}/> WHAT YOU OFFER</div><h1>Services</h1><p>{selectedService?'Customers assigned to this service.':mainServiceName?`Main service: ${mainServiceName}. Pin another service to change the default when booking.`:'Choose a service to see customers and job value. Pin one as your main service for new bookings.'}</p></div><div className="heading-actions">{selectedService&&<button className="button secondary" onClick={()=>setSelectedService(null)}><ChevronLeft size={16}/> All services</button>}<button className="button primary" onClick={()=>{setEditingService(null);setShowServiceForm(true);}}><Plus size={17}/> Add service</button></div></div>
    {!selectedService&&<div className="panel table-panel"><div className="panel-heading padded-heading"><div><h2>Your services</h2><p>{services.length} service{services.length===1?'':'s'} · customer count and total job value</p></div></div><div className="table-wrap"><table><thead><tr><th>Service</th><th>Customers</th><th>Total job value</th><th></th></tr></thead><tbody>{services.map((s,i)=>{const count=customersForService(s.name).length;const value=serviceJobValue(s.name);const isMain=s.name===mainServiceName;return <tr key={s.name} className={`service-row ${isMain?'service-row-main':''}`} onClick={()=>setSelectedService(s.name)}><td><div className="table-customer"><div className={`customer-avatar service-avatar service-icon-${i%4}`}><Wrench size={15}/></div><div><strong>{s.name}</strong><small>{isMain?'Main service · used by default when adding jobs':'Tap to view assigned customers'}</small></div>{isMain&&<span className="main-badge"><Pin size={12}/> Main</span>}</div></td><td><span className="cycle-pill">{count} customer{count===1?'':'s'}</span></td><td><strong>{money(value)}</strong></td><td><div className="row-actions" onClick={e=>e.stopPropagation()}><button className={`button tiny ${isMain?'primary':'secondary'}`} title={isMain?'This is your main service':'Set as main service'} onClick={()=>setMainService(s.name)}><Pin size={14}/> {isMain?'Main':'Set main'}</button><button className="button tiny secondary" onClick={()=>{setEditingService(s);setShowServiceForm(true);}}>Rename</button><button className="icon-button" title="Remove service" onClick={()=>void removeService(s.name)}><Trash2 size={15}/></button></div></td></tr>})}</tbody></table>{services.length===0&&<EmptyState title="No services yet" text="Add your first service to start assigning customers." action="Add service" onClick={()=>{setEditingService(null);setShowServiceForm(true);}}/>}</div></div>}
    {selectedService&&(()=>{const service=services.find(s=>s.name===selectedService);const assigned=customersForService(selectedService);const available=unassignedForService(selectedService);const value=serviceJobValue(selectedService);const jobCount=appointments.filter(a=>a.service===selectedService&&a.status!=='Cancelled').length;const isMain=selectedService===mainServiceName;if(!service)return null;return <><div className="stats-grid compact-stats"><Stat icon={<Users size={19}/>} label="Assigned customers" value={String(assigned.length)} sub="On this service" tone="blue"/><Stat icon={<CircleDollarSign size={20}/>} label="Total job value" value={money(value)} sub={`${jobCount} active job${jobCount===1?'':'s'}`} tone="green"/><Stat icon={<CalendarCheck size={19}/>} label="Active jobs" value={String(jobCount)} sub="In calendar" tone="purple"/><Stat icon={<Pin size={19}/>} label="Main service" value={isMain?'Yes':'No'} sub={isMain?'Default when booking':'Pin to use by default'} tone="amber"/></div>
    <div className="panel table-panel"><div className="panel-heading padded-heading"><div><h2>{selectedService}{isMain?' · Main':''}</h2><p>Customers assigned to this service</p></div><div className="heading-actions"><button className={`button ${isMain?'primary':'secondary'}`} onClick={()=>setMainService(selectedService)}><Pin size={15}/> {isMain?'Main service':'Set as main'}</button><button className="button secondary" onClick={()=>{setEditingService(service);setShowServiceForm(true);}}>Rename</button></div></div><div className="table-wrap"><table><thead><tr><th>Customer</th><th>Property</th><th>Cycle</th><th>Price</th><th>Contact</th><th></th></tr></thead><tbody>{assigned.map(c=><tr key={c.id} className="clickable-row" role="button" tabIndex={0} onClick={()=>openCustomerForm(c)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCustomerForm(c);}}}><td><div className="table-customer"><div className="customer-avatar">{initials(c.name)}</div><div><strong>{c.name}</strong><small>{c.email||'No email'}</small></div></div></td><td><span>{c.address}</span><small className="table-sub">{[c.town,c.postcode].filter(Boolean).join(' · ')}</small></td><td><span className="cycle-pill">Every {c.frequency} weeks · {c.duration} min</span></td><td><strong>{money(c.price)}</strong></td><td><span>{c.phone||'—'}</span></td><td><div className="row-actions" onClick={e=>e.stopPropagation()}><button className="button tiny secondary" onClick={()=>openSchedule(c.id)}>Book</button><button className="icon-button" title="Edit customer" onClick={()=>openCustomerForm(c)}><Pencil size={15}/></button><button className="icon-button" title="Unassign" onClick={()=>unassignCustomerFromService(c.id)}><X size={15}/></button></div></td></tr>)}</tbody></table>{assigned.length===0&&<EmptyState title="No customers on this service yet" text="Assign an existing customer below, or add a new customer with this service." action="Add customer" onClick={()=>openCustomerForm()}/>}</div></div>
    {available.length>0&&<div className="panel table-panel" style={{marginTop:18}}><div className="panel-heading padded-heading"><div><h2>Assign a customer</h2><p>Customers not yet on this service</p></div></div><div className="table-wrap"><table><thead><tr><th>Customer</th><th>Current service</th><th>Property</th><th></th></tr></thead><tbody>{available.map(c=><tr key={c.id} className="clickable-row" role="button" tabIndex={0} onClick={()=>openCustomerForm(c)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCustomerForm(c);}}}><td><strong>{c.name}</strong></td><td><span className="cycle-pill">{customerServiceNames(c).join(', ')||'Unassigned'}</span></td><td><span>{[c.town,c.postcode].filter(Boolean).join(' · ')||'—'}</span></td><td><div className="row-actions" onClick={e=>e.stopPropagation()}><button className="button tiny primary" onClick={()=>assignCustomerToService(c.id,selectedService)}>Assign</button></div></td></tr>)}</tbody></table></div></div>}</>;})()}
    <div className="info-note"><AlertCircle size={17}/><p><strong>Tip:</strong> Pin a main service and it will be pre-selected whenever you add a job from the dashboard or calendar. Total job value is the sum of active appointments for that service.</p></div></>}
   {page==='Finance'&&<><div className="page-heading"><div><div className="eyebrow"><Wallet size={14}/> MONEY IN & OUTSTANDING</div><h1>Finance</h1><p>Track completed work, who paid, and who still owes you — by week, month or year.</p></div><div className="heading-actions"><div className="segmented"><button className={financePeriod==='week'?'chosen':''} onClick={()=>setFinancePeriod('week')}>Week</button><button className={financePeriod==='month'?'chosen':''} onClick={()=>setFinancePeriod('month')}>Month</button><button className={financePeriod==='year'?'chosen':''} onClick={()=>setFinancePeriod('year')}>Year</button></div><button className="button secondary" onClick={()=>exportCSV(financeJobs.map(a=>({date:a.date,time:a.time,customer:customerName(a.customerId),service:a.service,status:a.status,amount:a.price,payment:isPaid(a.id)?'Paid':'Unpaid',paidAt:paymentFor(a.id)?.paidAt||''})))}><Download size={16}/> Export CSV</button></div></div>
    <p className="finance-period-label">{dateLabel(financeRange.start)} – {dateLabel(financeRange.end)}</p>
    <div className="stats-grid"><Stat icon={<CircleDollarSign size={20}/>} label="Billed in period" value={money(financeBilled)} sub={`${financeJobs.length} billable jobs`} tone="blue"/><Stat icon={<CheckCircle2 size={19}/>} label="Collected" value={money(financeCollected)} sub={`${financePaid.length} paid`} tone="green"/><Stat icon={<AlertCircle size={19}/>} label="Outstanding" value={money(financeOutstanding)} sub={`${financeUnpaid.length} unpaid`} tone="amber"/><Stat icon={<CalendarCheck size={19}/>} label="Completed jobs" value={String(financeJobs.filter(a=>a.status==='Completed').length)} sub="Marked complete" tone="purple"/></div>
    <div className="panel table-panel"><div className="panel-heading padded-heading"><div><h2>Unpaid</h2><p>Customers who still need to pay for work in this period</p></div></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Customer</th><th>Service</th><th>Status</th><th>Amount</th><th></th></tr></thead><tbody>{financeUnpaid.map(a=><tr key={a.id}><td><strong>{dateLabel(a.date)}</strong><small className="table-sub">{a.time}</small></td><td><strong>{customerName(a.customerId)}</strong></td><td><span>{a.service}</span></td><td><Status status={a.status}/></td><td><strong>{money(a.price)}</strong></td><td><div className="row-actions">{a.status!=='Completed'&&!isPaid(a.id)?<button className="button tiny primary" onClick={()=>markJobCompleted(a.id)}>Done</button>:<button className="button tiny primary" onClick={()=>void markJobPaid(a)}>Pay</button>}</div></td></tr>)}</tbody></table>{financeUnpaid.length===0&&<div className="success-empty"><CheckCircle2 size={20}/> No outstanding payments in this period.</div>}</div></div>
    <div className="panel table-panel" style={{marginTop:18}}><div className="panel-heading padded-heading"><div><h2>Paid</h2><p>Payments collected in this period</p></div></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Customer</th><th>Service</th><th>Paid on</th><th>Amount</th><th></th></tr></thead><tbody>{financePaid.map(a=>{const pay=paymentFor(a.id)!;return <tr key={a.id}><td><strong>{dateLabel(a.date)}</strong><small className="table-sub">{a.time}</small></td><td><strong>{customerName(a.customerId)}</strong></td><td><span>{a.service}</span></td><td><span className="cycle-pill paid-pill">{pay.paidAt?dateLabel(pay.paidAt):'—'} · {pay.method}</span></td><td><strong>{money(a.price)}</strong></td><td><button className="button tiny secondary" onClick={()=>void markJobUnpaid(a.id)}>Undo</button></td></tr>})}</tbody></table>{financePaid.length===0&&<div className="empty-state"><div className="empty-icon"><Wallet size={21}/></div><strong>No payments recorded yet</strong><p>Mark a job as paid above to build your collection history.</p></div>}</div></div>
    <div className="info-note"><AlertCircle size={17}/><p><strong>How it works:</strong> Confirmed and completed jobs in the selected period appear here. Mark paid to store a payment in Supabase (`payments`). Outstanding = billed minus collected.</p></div></>}
   {page==='Reports'&&<><div className="page-heading"><div><div className="eyebrow"><Activity size={14}/> BUSINESS PERFORMANCE</div><h1>Reports</h1><p>A simple overview of your workload and scheduled revenue.</p></div><div className="heading-actions"><button className="button secondary" onClick={()=>setPage('Finance')}><Wallet size={16}/> Open Finance</button><button className="button secondary" onClick={()=>exportCSV(appointments.map(a=>({...a,customer:customerName(a.customerId)})) as unknown as Customer[])}><Download size={16}/> Export data</button></div></div><div className="stats-grid"><Stat icon={<CircleDollarSign size={20}/>} label="Scheduled revenue" value={money(appointments.filter(a=>a.status!=='Cancelled').reduce((s,a)=>s+a.price,0))} sub="All active appointments" tone="green"/><Stat icon={<Wallet size={19}/>} label="Collected (all time)" value={money(payments.filter(p=>p.paidAt).reduce((s,p)=>s+p.amount,0))} sub={`${payments.filter(p=>p.paidAt).length} payments`} tone="blue"/><Stat icon={<CheckCircle2 size={19}/>} label="Completed jobs" value={String(appointments.filter(a=>a.status==='Completed').length)} sub="Marked as completed" tone="purple"/><Stat icon={<Clock3 size={19}/>} label="Pending requests" value={String(pending)} sub="Needs review" tone="amber"/></div><div className="panel report-panel"><h2>Appointment status</h2><p>Distribution of active appointments in your workspace.</p>{(['Confirmed','Pending','Completed'] as const).map(s=>{const n=appointments.filter(a=>a.status===s).length;const total=Math.max(1,appointments.filter(a=>a.status!=='Cancelled').length);return <div className="report-bar-row" key={s}><div><span>{s}</span><strong>{n}</strong></div><div className="report-track"><div className={`report-fill fill-${s.toLowerCase()}`} style={{width:`${n/total*100}%`}}/></div></div>})}</div></>}
   {page==='Settings'&&<><div className="page-heading"><div><div className="eyebrow"><Settings size={14}/> YOUR WORKSPACE</div><h1>Settings</h1><p>Configure your business details and booking preferences.</p></div></div><div className="settings-layout"><div className="panel settings-card"><h2>Business profile</h2><p>These details appear in your workspace and booking page.</p><form onSubmit={e=>{e.preventDefault();void saveSettings(e.currentTarget);}} className="form-grid"><label>Business name<input name="name" defaultValue={settings.name} key={`name-${settings.name}`}/></label><label>Contact email<input name="email" type="email" defaultValue={settings.email} key={`email-${settings.email}`}/></label><label>Phone number<input name="phone" defaultValue={settings.phone} key={`phone-${settings.phone}`}/></label><label>Business postcode<input name="postcode" defaultValue={settings.postcode} key={`postcode-${settings.postcode}`}/></label><label>Default working days<select name="workingDays" defaultValue={settings.workingDays} key={`days-${settings.workingDays}`}><option>Monday to Friday</option><option>Monday to Saturday</option><option>Every day</option></select></label><label>Time zone<select name="timezone" defaultValue={settings.timezone} key={`tz-${settings.timezone}`}><option value="Europe/London">United Kingdom (GMT/BST)</option></select></label><div className="form-actions"><button className="button primary" type="submit">Save changes</button></div></form></div><div className="panel settings-card"><h2>Booking preferences</h2><p>Choose how customer requests are handled.</p><button type="button" className="preference-row preference-toggle" onClick={()=>setSettings(s=>{const next={...s,requireConfirmation:!s.requireConfirmation};flash(next.requireConfirmation?'Manual confirmation enabled.':'New bookings confirm automatically.');return next;})}><div><strong>Require manual confirmation</strong><span>New online requests stay pending until you confirm them.</span></div><span className={settings.requireConfirmation?'toggle-on':'toggle-off'}><i/></span></button><button type="button" className="preference-row preference-toggle" onClick={()=>setSettings(s=>{const next={...s,preventOverlap:!s.preventOverlap};flash(next.preventOverlap?'Overlap protection enabled.':'Overlap protection disabled.');return next;})}><div><strong>Prevent overlapping appointments</strong><span>Do not allow two jobs to start at the same time.</span></div><span className={settings.preventOverlap?'toggle-on':'toggle-off'}><i/></span></button><button type="button" className="preference-row preference-toggle" onClick={()=>setSettings(s=>{const next={...s,useRecurring:!s.useRecurring};flash(next.useRecurring?'Recurring cycles enabled.':'Recurring cycles disabled.');return next;})}><div><strong>Use recurring customer cycles</strong><span>Track regular visits every 4, 6, 8, 10 or 12 weeks.</span></div><span className={settings.useRecurring?'toggle-on':'toggle-off'}><i/></span></button><div className="info-note"><AlertCircle size={17}/><p>Preferences save automatically. Business profile is stored locally{businessId?' and synced to Supabase':''}.</p></div></div></div></>}
  </div><footer className="footer"><span>© 2026 MyPurePlan</span><span>Built for independent window cleaning businesses</span><span className="footer-status"><i/> {businessId?cloudStatus:'Demo workspace'}</span></footer></main>
  {notice&&<div className="toast"><CheckCircle2 size={17}/>{notice}<button onClick={()=>setNotice('')}><X size={15}/></button></div>}
  {showAdd&&<Modal title={editingAppointment?`Edit appointment · ${customerName(editingAppointment.customerId)}`:scheduleCustomer?`Schedule ${scheduleCustomer.name}`:'New appointment'} subtitle={editingAppointment?'Mark done or paid, or change the date and time below.':scheduleCustomer?'Review the last visit, then set date and service.':'Add a job to your working calendar.'} onClose={closeSchedule}><form className="modal-form" onSubmit={e=>{e.preventDefault();saveAppointment(e.currentTarget)}} key={`schedule-${scheduleFormKey}-${editingAppointment?.id||scheduleCustomerId||'new'}`}>
    {editingAppointment&&(()=>{const live=appointments.find(a=>a.id===editingAppointment.id)||editingAppointment;const outcome=jobOutcome(live);return <div className="job-outcome-card"><div className="last-visit-label">Status</div><p className="outcome-help">{outcome==='todo'?'Mark as done when finished, or change the date below.':outcome==='done'?'Done — take payment when the customer pays.':'Done and paid.'}</p><div className="outcome-actions"><JobQuickActions appointment={live}/>{outcome!=='todo'&&<JobFlags appointment={live}/>}{outcome==='done'&&<button type="button" className="text-button" onClick={()=>void markJobNotDone(live.id)}>Undo done</button>}{outcome==='paid'&&<button type="button" className="text-button" onClick={()=>void markJobUnpaid(live.id)}>Undo payment</button>}<button type="button" className="button tiny secondary" onClick={()=>(document.querySelector('input[name=date], .uk-date-input') as HTMLInputElement|null)?.focus()}>Change date</button></div></div>;})()}
    {!editingAppointment&&scheduleCustomer&&lastVisit&&<div className="last-visit-card"><div className="last-visit-label">Last visit</div><div className="last-visit-grid"><span><strong>Date</strong>{dateLabel(lastVisit.date)}</span><span><strong>Time</strong>{lastVisit.time}</span><span><strong>Price</strong>{money(lastVisit.price)}</span><span><strong>Service</strong>{lastVisit.service}</span></div>{(lastVisit.notes||scheduleCustomer.notes)?<p className="last-visit-note"><AlertCircle size={14}/><span>{lastVisit.notes||scheduleCustomer.notes}</span></p>:<p className="last-visit-note muted-note">No notes from the last visit.</p>}</div>}
    {!editingAppointment&&scheduleCustomer&&!lastVisit&&<div className="last-visit-card"><div className="last-visit-label">Last visit</div><p className="last-visit-note muted-note">No previous appointment found for this customer.</p></div>}
    <label>Customer<select name="customerId" required defaultValue={editingAppointment?.customerId||scheduleCustomer?.id||''}><option value="" disabled>Select a customer</option>{customers.map(c=><option value={c.id} key={c.id}>{c.name} — {c.postcode}</option>)}</select></label><div className="form-row"><label>Date<UkDateInput name="date" defaultValue={editingAppointment?.date||scheduleDate} onIsoChange={isoDate=>{setScheduleDate(isoDate);if(!editingAppointment)return;const updated={...editingAppointment,date:isoDate};setEditingAppointment(updated);setAppointments(p=>resolveOverlappingAppointments(cascadeFollowingAppointments(p, updated)));}} required/></label><label>Start time<input name="time" type="time" key={`time-${editingAppointment?.id||'new'}-${scheduleDate}-${suggestedStartTime}`} defaultValue={suggestedStartTime} required onChange={e=>{if(!editingAppointment)return;const nextTime=e.target.value.slice(0,5);if(!/^\d{2}:\d{2}$/.test(nextTime))return;const updated={...editingAppointment,time:nextTime,date:scheduleDate||editingAppointment.date};setEditingAppointment(updated);setAppointments(p=>resolveOverlappingAppointments(cascadeFollowingAppointments(p, updated)));}}/></label></div><div className="form-row"><label>Service<select name="service" defaultValue={editingAppointment?.service||scheduleCustomer?.service||defaultServiceName} onChange={e=>{const selectedName=e.target.value;const catalogItem=services.find(x=>x.name===selectedName);const customerId=(document.querySelector('select[name=customerId]') as HTMLSelectElement|null)?.value;const cust=customers.find(x=>x.id===customerId);const line=cust?customerLineFor(cust,selectedName):null;const priceInput=document.getElementById('appointment-price') as HTMLInputElement|null;const durationInput=document.getElementById('appointment-duration') as HTMLInputElement|null;const cycleInput=document.getElementById('appointment-cycle') as HTMLSelectElement|null;if(durationInput)durationInput.value=String(line?.duration??catalogItem?.duration??30);if(priceInput)priceInput.value=String(line&&line.price>0?line.price:(catalogItem?.price??0));if(cycleInput&&!line)cycleInput.value='oneoff';}}>{services.map(s=><option key={s.name} value={s.name}>{s.name}{s.name===mainServiceName?' (main)':''}</option>)}</select></label><label>Cycle<select id="appointment-cycle" name="cycle" defaultValue={editingAppointment?.oneOff?'oneoff':String(editingAppointment?.frequency||scheduleCustomer?.frequency||6)}><option value="oneoff">One-off</option>{CYCLE_WEEKS.map(w=><option key={w} value={w}>Every {w} weeks</option>)}</select></label></div><div className="form-row"><label>Duration (minutes)<input id="appointment-duration" name="duration" type="number" min="10" step="5" defaultValue={editingAppointment?.duration??scheduleCustomer?.duration??defaultService?.duration??30} required onChange={e=>{if(!editingAppointment)return;const nextDuration=Math.max(5,Number(e.target.value)||30);const updated={...editingAppointment,duration:nextDuration,date:scheduleDate||editingAppointment.date};setEditingAppointment(updated);setAppointments(p=>resolveOverlappingAppointments(cascadeFollowingAppointments(p, updated)));}}/></label><label>Price (£)<input id="appointment-price" className="price-input" name="price" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={editingAppointment?.price??(scheduleCustomer&&scheduleCustomer.price>0?scheduleCustomer.price:undefined)} placeholder="0.00" required/></label></div><label>Job notes (optional)<textarea name="notes" rows={2} defaultValue={editingAppointment?.notes||lastVisit?.notes||scheduleCustomer?.notes||''} placeholder="Access instructions, special requests..."/></label><div className="modal-actions"><button type="button" className="button secondary" onClick={closeSchedule}>Cancel</button>{editingAppointment&&<button type="button" className="button secondary" onClick={()=>{const id=editingAppointment.id;closeSchedule();void removeAppointment(id);}}>Delete</button>}<button className="button primary" type="submit">{editingAppointment?<><Check size={16}/> Save changes</>:<><Plus size={16}/> Create appointment</>}</button></div></form></Modal>}
  {showCustomer&&<Modal title={editingCustomer?'Edit customer':'Add customer'} subtitle={editingCustomer?'Update this customer’s details and services.':'Save a customer, property details, and one or more services.'} onClose={closeCustomerForm}><form className="modal-form" key={editingCustomer?.id||'new-customer'} onSubmit={e=>{e.preventDefault();saveCustomerForm(e.currentTarget)}}><label>Customer name<input name="name" defaultValue={editingCustomer?.name||''} placeholder="e.g. Jamie Smith" required/></label><div className="form-row"><label>Email address<input name="email" type="email" defaultValue={editingCustomer?.email||''} placeholder="jamie@example.com"/></label><label>Phone number<input name="phone" defaultValue={editingCustomer?.phone||''} placeholder="07..."/></label></div><label>Property address<input name="address" defaultValue={editingCustomer?.address||''} placeholder="House number and street" required/></label><div className="form-row"><label>Town / locality<input name="town" defaultValue={editingCustomer?.town||''} placeholder="e.g. Sidcup" required/></label><label>Postcode<input name="postcode" defaultValue={editingCustomer?.postcode||''} placeholder="DA15 8AB" required/></label></div><CustomerServiceEditor catalog={services} initialLines={editingCustomer?.serviceLines||[]} defaultServiceName={editingCustomer?.service||selectedService||defaultServiceName}/><label>Cleaning frequency<select name="frequency" defaultValue={String(editingCustomer?.frequency??6)}><option value="4">Every 4 weeks</option><option value="6">Every 6 weeks</option><option value="8">Every 8 weeks</option><option value="10">Every 10 weeks</option><option value="12">Every 12 weeks</option></select></label><label>Access notes (optional)<textarea name="notes" rows={2} defaultValue={editingCustomer?.notes||''} placeholder="Gate, pets, access instructions..."/></label><div className="modal-actions"><button type="button" className="button secondary" onClick={closeCustomerForm}>Cancel</button><button className="button primary" type="submit">{editingCustomer?'Save changes':'Save customer'}</button></div></form></Modal>}
  {showServiceForm&&<Modal title={editingService?'Rename service':'Add service'} subtitle={editingService?'Update the service name.':'Create a service customers can be assigned to.'} onClose={()=>{setShowServiceForm(false);setEditingService(null);}}><form className="modal-form" onSubmit={e=>{e.preventDefault();saveServiceForm(e.currentTarget);}}><label>Service name<input name="name" defaultValue={editingService?.name??''} placeholder="e.g. Window cleaning" required/></label><div className="modal-actions"><button type="button" className="button secondary" onClick={()=>{setShowServiceForm(false);setEditingService(null);}}>Cancel</button><button className="button primary" type="submit">{editingService?'Save changes':'Add service'}</button></div></form></Modal>}
  {showBooking&&<Modal title="Online booking page" subtitle="Customer-facing preview · English (UK)" onClose={()=>setShowBooking(false)} wide><div className="public-booking"><div className="public-brand"><div className="brand-mark"><Sparkles size={18}/></div><div><strong>{settings.name}</strong><span>PROFESSIONAL WINDOW CLEANING</span></div></div><div className="public-intro"><div className="eyebrow">SIMPLE · RELIABLE · LOCAL</div><h2>Book your window clean.</h2><p>Choose your service and preferred time. We'll confirm your appointment shortly.</p></div><form className="modal-form public-form" onSubmit={e=>{e.preventDefault();bookOnline(e.currentTarget)}}><div className="form-row"><label>Full name<input name="name" placeholder="Your name" required/></label><label>Email address<input name="email" type="email" placeholder="you@example.com" required/></label></div><div className="form-row"><label>Phone number<input name="phone" placeholder="07..." required/></label><label>Postcode<input name="postcode" placeholder="DA15 8AB" required/></label></div><label>Property address<input name="address" placeholder="House number and street" required/></label><label>Service<select name="service" defaultValue={defaultServiceName} onChange={e=>{const s=services.find(x=>x.name===e.target.value);const p=document.getElementById('public-price') as HTMLInputElement|null;if(s&&p)p.value=String(s.price)}}>{services.map(s=><option key={s.name} value={s.name}>{s.name}</option>)}</select></label><div className="form-row"><label>Preferred date<UkDateInput name="date" min={addDays(1)} defaultValue={addDays(1)} required/></label><label>Preferred time<select name="time"><option>08:30</option><option>09:30</option><option>10:30</option><option>11:30</option><option>13:00</option><option>14:00</option><option>15:00</option></select></label></div><input id="public-price" name="price" type="hidden" defaultValue={defaultService?.price??24}/><div className="public-disclaimer"><CheckCircle2 size={15}/> {settings.requireConfirmation?'This is a booking request. Your appointment is not confirmed until we contact you.':'Your booking will be confirmed automatically.'}</div><button className="button primary public-submit" type="submit">Request appointment <ArrowUpRight size={16}/></button></form><div className="public-footer">{settings.name} · Serving your local area</div></div></Modal>}
 </div>;
}
function Stat({icon,label,value,sub,tone}:{icon:React.ReactNode;label:string;value:string;sub:string;tone:string}){return <div className="stat-card"><div className={`stat-icon tone-${tone}`}>{icon}</div><div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div><ArrowUpRight className="stat-arrow" size={15}/></div>}
function Status({status}:{status:Appointment['status']}){return <span className={`status status-${status.toLowerCase()}`}><i/>{status}</span>}
function EmptyState({title,text,action,onClick}:{title:string;text:string;action:string;onClick:()=>void}){return <div className="empty-state"><div className="empty-icon"><CalendarDays size={21}/></div><strong>{title}</strong><p>{text}</p><button className="button secondary tiny" onClick={onClick}>{action}</button></div>}
function Modal({title,subtitle,onClose,children,wide=false}:{title:string;subtitle:string;onClose:()=>void;children:React.ReactNode;wide?:boolean}){return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className={`modal ${wide?'modal-wide':''}`} role="dialog" aria-modal="true"><div className="modal-header"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={onClose}><X size={19}/></button></div>{children}</div></div>}
function exportCSV(rows:unknown[]){if(!rows.length)return;const keys=Object.keys(rows[0] as object);const csv=[keys.join(','),...rows.map(row=>keys.map(k=>{let value=String((row as Record<string,unknown>)[k]??'');if(/^\d{4}-\d{2}-\d{2}/.test(value))value=dateLabel(value.slice(0,10));return `"${value.replace(/"/g,'""')}"`;}).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='mypureplan-export.csv';a.click();URL.revokeObjectURL(url)}
