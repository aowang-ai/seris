import type {
  Instrument,
  MarketInterval,
  MarketChart,
  MarketQuote,
  MarketContextInput,
  MarketAlert,
  MarketNotification,
  MarketRule,
  MarketNews,
} from '../../core/src/markets/types';
import { PROTOCOL_VERSION, isModelConfig, isChatEvent, isCursor, isSnapshot, type ChatEvent, type Cursor, type SessionMeta, type SessionSnapshot, type ModelConfig, type ModelConnectionInput, type ModelSelection, type ProviderInfo, type ModelDiscovery, type LocalModelService } from '../../core/src/protocol';
export type { SessionMeta, HistoryEntry, RunRecord, ApprovalRequest, ModelConfig, ModelConnectionInput, ModelSelection, ProviderInfo, ConnectionStatus, ModelOption, LocalModelService } from '../../core/src/protocol';
declare global {
  interface Window {
    __SERIS_TICKET__?:string|null;
    __TAURI__?:{core:{invoke<T>(command:string):Promise<T>}};
  }
}
let base=import.meta.env.VITE_SERIS_GATEWAY_URL?.replace(/\/$/,'')??'';
let token=import.meta.env.VITE_SERIS_TOKEN??'';
let bootstrapped=false;
let bootstrapPromise:Promise<void>|null=null;
async function connection():Promise<void>{
  if(window.__TAURI__){
    const c=await window.__TAURI__.core.invoke<{url:string;token:string}|null>('gateway_connection');
    if(!c)throw new Error('Core is starting');
    base=c.url;token=c.token;return;
  }
  if(bootstrapped)return;
  if(!bootstrapPromise)bootstrapPromise=(async()=>{
    const u=new URL(location.href);
    const ticket=window.__SERIS_TICKET__??u.searchParams.get('ticket');
    u.searchParams.delete('ticket');history.replaceState(null,'',u);
    if(ticket){
      const res=await fetch(`${base}/api/bootstrap`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({ticket})});
      if(!res.ok)throw new Error('Startup link expired. Open the current gateway link.');
      const body=await res.json();token=body.token;
      window.__SERIS_TICKET__=null;
    }
    bootstrapped=true;
  })().finally(()=>{bootstrapPromise=null;});
  await bootstrapPromise;
}
async function call<T>(path:string,init?:RequestInit):Promise<T>{
  await connection();
  const res=await fetch(`${base}${path}`,{...init,credentials:token?'omit':'include',headers:{...(token?{authorization:`Bearer ${token}`}:{ }),...(init?.body?{'content-type':'application/json'}:{}),...init?.headers}});
  if(!res.ok){const body=await res.json().catch(()=>null);throw new Error(body?.error ?? `Request failed (${res.status})`);}
  return res.json();
}
const pause=(ms:number,signal:AbortSignal)=>new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,ms);signal.addEventListener('abort',finish,{once:true});if(signal.aborted)finish();});
export interface MarketsState {
  watchlist: Instrument[];
  alerts: MarketAlert[];
  notifications: MarketNotification[];
  provider: {
    connected: boolean;
    connecting: boolean;
    authorizationUrl?: string;
    error?: string;
  };
}
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
});
export const seris={
  marketsState: () => call<MarketsState>('/api/markets/state'),
  connectMarkets: () =>
    call<MarketsState['provider']>('/api/markets/connect', post({})),
  searchMarkets: (query: string) =>
    call<{ instruments: Instrument[] }>(
      `/api/markets/search?q=${encodeURIComponent(query)}`,
    ),
  marketWatchlist: (instrument: Instrument) =>
    call<{ watchlist: Instrument[] }>(
      '/api/markets/watchlist',
      post({ instrument }),
    ),
  removeMarket: (id: string) =>
    call<{ watchlist: Instrument[] }>(
      '/api/markets/watchlist/remove',
      post({ id }),
    ),
  marketQuotes: () =>
    call<{
      quotes: { instrument: Instrument; quote?: MarketQuote; error?: string }[];
    }>('/api/markets/quotes'),
  marketChart: (instrument: Instrument, interval: MarketInterval) =>
    call<MarketChart>('/api/markets/chart', post({ instrument, interval })),
  marketSnapshot: (id: string) =>
    call<MarketChart>(`/api/markets/snapshot?id=${encodeURIComponent(id)}`),
  marketNews: (instrument: Instrument) =>
    call<{ news: MarketNews[] }>('/api/markets/news', post({ instrument })),
  createAlert: (rule: MarketRule, requestId: string) =>
    call<{ alert: MarketAlert }>(
      '/api/markets/alerts',
      post({ rule, requestId }),
    ),
  setAlert: (id: string, status: MarketAlert['status']) =>
    call<{ alert: MarketAlert }>(
      '/api/markets/alerts/status',
      post({ id, status }),
    ),


  listSessions:()=>call<SessionMeta[]>('/api/sessions'),
  createSession:()=>call<SessionMeta>('/api/sessions',{method:'POST',body:'{}'}),
  snapshot:async(id:string):Promise<SessionSnapshot>=>{const s=await call<unknown>(`/api/sessions/${id}/snapshot`);if(!isSnapshot(s))throw new Error('Invalid session snapshot');return s;},
  config:async()=>{const c=await call<unknown>('/api/config');if(!isModelConfig(c))throw new Error('Invalid model configuration');return c;},
  providers:()=>call<ProviderInfo[]>('/api/config/providers'),
  localModels:()=>call<LocalModelService[]>('/api/config/local-models'),
  discoverModels:(config:ModelConnectionInput,signal?:AbortSignal)=>call<ModelDiscovery>('/api/config/discover',{...post(config),signal}),
  saveConnection:(config:ModelConnectionInput)=>call<ModelConfig>('/api/config/connections',post(config)),
  selectModel:(selection:ModelSelection)=>call<ModelConfig>('/api/config/select',post(selection)),
  removeConnection:(id:string)=>call<ModelConfig>('/api/config/remove',post({id})),
  testConnection:(id:string)=>call<ModelConfig>('/api/config/test',post({id})),
  prompt:(id:string,text:string,requestId:string,marketContext?:MarketContextInput)=>call<{accepted:boolean;runId:string}>(`/api/sessions/${id}/prompt`,{method:'POST',body:JSON.stringify({text,requestId,marketContext})}),
  abort:(id:string)=>call(`/api/sessions/${id}/abort`,{method:'POST',body:'{}'}),
  approve:(id:string,runId:string,allowed:boolean)=>call('/api/approvals',{method:'POST',body:JSON.stringify({kind:'tool',id,runId,decision:allowed?'approve':'reject'})}),
  goalApprovals:()=>call<{goals:{id:string;status:string;reason:string;payload:unknown}[]}>('/api/approvals'),
  decideGoal:(id:string,allowed:boolean)=>call('/api/approvals',{method:'POST',body:JSON.stringify({kind:'goal',id,decision:allowed?'approve':'reject'})}),
  shellStatus:()=>window.__TAURI__?.core.invoke<{ready:boolean;circuitBroken:boolean;tail:string}>('gateway_status'),
  /** Sequential reader: pause applying deltas while the UI restores a watermarked snapshot. */
  onChatEvent:(cb:(e:ChatEvent,cursor:Cursor)=>void,onReady:()=>Promise<void>,onStatus:(connected:boolean,error?:string)=>void):(()=>void)=>{
    const abort=new AbortController();let cursor:Cursor|undefined;
    void(async()=>{
      let delay=500;
      while(!abort.signal.aborted){
        try{
          await connection();
          const qs=cursor?`?epoch=${encodeURIComponent(cursor.epoch)}&after=${cursor.seq}`:'';
          const res=await fetch(`${base}/api/events${qs}`,{signal:abort.signal,credentials:token?'omit':'include',headers:token?{authorization:`Bearer ${token}`}:{}});
          if(!res.ok||!res.body)throw new Error(`Connection failed (${res.status})`);
          const reader=res.body.getReader();const decoder=new TextDecoder();let buffer='';
          try{
            for(;;){
              const {value,done}=await reader.read();if(done)throw new Error('Core disconnected');
              buffer+=decoder.decode(value,{stream:true});if(buffer.length>2*1024*1024)throw new Error('Event frame too large');
              let end:number;
              while((end=buffer.indexOf('\n\n'))>=0){
                const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
                const data=frame.split('\n').find(l=>l.startsWith('data: '));if(!data)continue;
                const event:unknown=JSON.parse(data.slice(6));
                if(isCursor(event)&&['stream-ready','resync-required'].includes(String((event as any).type))){
                  const info=await call<{protocolVersion:number}>('/api/app-info');
                  if(info.protocolVersion!==PROTOCOL_VERSION)throw new Error('Client/core protocol versions differ; restart the updated application');
                  await onReady();cursor={epoch:event.epoch,seq:event.seq};delay=500;onStatus(true);continue;
                }
                if(!cursor||!isChatEvent(event))throw new Error('Invalid event protocol');
                const seq=Number(frame.split('\n').find(l=>l.startsWith('id: '))?.slice(4));
                if(!Number.isSafeInteger(seq)||seq<=0)throw new Error('Invalid event sequence');
                // Replay can start before the control watermark; the snapshot filters it per session.
                cb(event,{epoch:cursor.epoch,seq});cursor.seq=Math.max(cursor.seq,seq);
              }
            }
          }finally{await reader.cancel().catch(()=>{});}
        }catch(e){if(abort.signal.aborted)break;onStatus(false,e instanceof Error?e.message:String(e));}
        await pause(delay,abort.signal);delay=Math.min(delay*1.8,15000);
      }
    })();
    return()=>abort.abort();
  },
};
