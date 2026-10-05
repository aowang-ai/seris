import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { ChatEvent, Cursor, StreamControl } from '../protocol.js';
export interface SequencedEvent { seq:number; data:ChatEvent }
const RING_CAPACITY=4096;
const MAX_QUEUE_BYTES=1024*1024;
export function serializeEvent(e:SequencedEvent):string { return `id: ${e.seq}\ndata: ${JSON.stringify(e.data)}\n\n`; }
interface Client {res:ServerResponse;queue:string[];bytes:number;blocked:boolean}
export class EventHub {
  readonly epoch=randomUUID();
  private clients=new Set<Client>();
  private ring:SequencedEvent[]=[];
  private seq=0;
  get lastSeq():number{return this.seq;}
  cursor():Cursor{return {epoch:this.epoch,seq:this.seq};}
  publish(data:ChatEvent):void {
    const e={seq:++this.seq,data};this.ring.push(e);
    if(this.ring.length>RING_CAPACITY)this.ring.shift();
    for(const client of this.clients)this.write(client,serializeEvent(e));
  }
  replay(since:number):SequencedEvent[]{return this.ring.filter(e=>e.seq>since);}
  private write(c:Client,frame:string):void {
    if(c.res.destroyed)return;
    if(c.blocked){
      c.bytes+=Buffer.byteLength(frame);c.queue.push(frame);
      if(c.bytes>MAX_QUEUE_BYTES)c.res.destroy();
    } else {
      try {c.blocked=!c.res.write(frame);}catch{c.res.destroy();}
    }
  }
  subscribe(res:ServerResponse,since?:number,epoch?:string):void {
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store, no-transform',connection:'keep-alive','x-accel-buffering':'no'});
    const c:Client={res,queue:[],bytes:0,blocked:false};this.clients.add(c);
    const drain=()=>{
      c.blocked=false;
      while(c.queue.length&&!c.blocked){const frame=c.queue.shift()!;c.bytes-=Buffer.byteLength(frame);this.write(c,frame);}
    };
    res.on('drain',drain);
    const hb=setInterval(()=>this.write(c,`: heartbeat\n\n`),15000);
    res.on('close',()=>{clearInterval(hb);res.off('drain',drain);this.clients.delete(c);c.queue=[];});
    const earliest=this.ring[0]?.seq??this.seq+1;
    const gap=since!==undefined&&(epoch!==this.epoch||since>this.seq||since<earliest-1);
    const control:StreamControl={type:gap?'resync-required':'stream-ready',...this.cursor()};
    this.write(c,`data: ${JSON.stringify(control)}\n\n`);
    if(!gap&&since!==undefined)for(const e of this.replay(since))this.write(c,serializeEvent(e));
  }
  close():void {for(const c of this.clients)c.res.end();this.clients.clear();}
}
