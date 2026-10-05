/** Live HTTP/SSE smoke. Offline regression coverage is in test/architecture.test.mjs. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSerisRuntime } from './runtime/createSerisRuntime.js';
import { startGateway } from './gateway/server.js';
import type { ChatEvent, SessionMeta, SessionSnapshot } from './protocol.js';

async function main() {
  const dir=await mkdtemp(join(tmpdir(),'seris-gateway-smoke-'));
  process.env.SERIS_DATA_DIR=dir;
  const runtime=await createSerisRuntime({sessionsRoot:join(dir,'sessions'),cwd:join(dir,'workspace')});
  const gw=await startGateway({runtime});
  const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),120000);
  const readers:ReadableStreamDefaultReader<Uint8Array>[]=[];
  try {
    assert.ok(runtime.configured,'Set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN for this live smoke');
    const headers={authorization:`Bearer ${gw.token}`,'content-type':'application/json'};
    const get=async(path:string,init?:RequestInit)=>{
      const res=await fetch(`${gw.url}${path}`,{...init,headers,signal:abort.signal});
      assert.ok(res.ok,`${path}: ${res.status} ${await (res.ok?Promise.resolve(''):res.text())}`);return res;
    };
    assert.equal((await fetch(`${gw.url}/api/sessions`,{signal:abort.signal})).status,401);
    const session:SessionMeta=await (await get('/api/sessions',{method:'POST',body:'{}'})).json();
    const response=await get('/api/events');const reader=response.body!.getReader();readers.push(reader);
    let buffer='';const decoder=new TextDecoder();const events:{seq:number;event:ChatEvent}[]=[];
    const consume=(async()=>{
      while(true){const {done,value}=await reader.read();if(done)throw new Error('Stream ended before run-end');buffer+=decoder.decode(value,{stream:true});
        let end:number;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const lines=frame.split('\n');const data=lines.find(l=>l.startsWith('data: '));const id=lines.find(l=>l.startsWith('id: '));
          if(!data||!id)continue;const event=JSON.parse(data.slice(6)) as ChatEvent;if(event.sessionId!==session.id)continue;
          events.push({seq:Number(id.slice(4)),event});if(event.type==='text-delta')process.stdout.write(event.delta??'');if(event.type==='run-end')return event;
        }
      }
    })();
    // Attach the rejection handler immediately while POST is pending.
    void consume.catch(()=>{});
    const requestId=randomUUID();
    const prompt=process.argv[2]??'What is the current BTC funding rate on Hyperliquid? One short sentence.';
    assert.equal((await get(`/api/sessions/${session.id}/prompt`,{method:'POST',body:JSON.stringify({text:prompt,requestId})})).status,202);
    const ended=await consume;assert.equal(ended.status,'completed',ended.error);
    const snapshot:SessionSnapshot=await (await get(`/api/sessions/${session.id}/snapshot`)).json();
    assert.equal(snapshot.run?.status,'completed');assert.equal(snapshot.messages[0].text,prompt);
    for(const {event} of events.filter(e=>e.event.type==='tool-start'))assert.ok(snapshot.messages.some(m=>m.role==='tool'&&m.toolCallId===event.toolCallId),'Missing durable tool result');
    // The replay test reads only the finite expected suffix, then cancels.
    const last=events.at(-1)!;const replay=await get(`/api/events?epoch=${snapshot.epoch}&after=${last.seq-1}`);const replayReader=replay.body!.getReader();readers.push(replayReader);
    let replayText='';while(!replayText.includes(`id: ${last.seq}\n`)){const value=await replayReader.read();assert.equal(value.done,false);replayText+=decoder.decode(value.value,{stream:true});}
    assert.ok(replayText.includes('run-end'));assert.ok(events.some(e=>e.event.type==='message'));
    console.log(`\nOK: ${snapshot.messages.length} messages, full tool history, authenticated SSE and replay`);
  } finally {
    clearTimeout(timer);abort.abort();await Promise.all(readers.map(r=>r.cancel().catch(()=>{})));
    await runtime.dispose();await gw.close();await rm(dir,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
