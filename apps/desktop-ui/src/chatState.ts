import type { ChatEvent, HistoryEntry, SessionSnapshot } from '../../core/src/protocol';
/** Stable message/tool IDs make live updates and restored history interchangeable. */
export function applyChatEvent(messages:HistoryEntry[],e:ChatEvent):HistoryEntry[]{
  const list=[...messages];
  const put=(m:HistoryEntry)=>{const i=list.findIndex(x=>x.id===m.id);if(i<0)list.push(m);else list[i]=m;};
  if(e.type==='message'&&e.message)put({...e.message,pending:false});
  if(e.type==='text-delta'&&e.messageId){
    const old=list.find(m=>m.id===e.messageId);
    if(!old||old.pending)put({id:e.messageId,role:'assistant',text:(old?.text??'')+(e.delta??''),pending:true});
  }
  if(e.type==='tool-start')put({id:`${e.runId}:tool:${e.toolCallId}`,role:'tool',text:'',toolCallId:e.toolCallId,toolName:e.toolName,pending:true});
  if(e.type==='tool-end'){
    const i=list.findIndex(m=>m.toolCallId===e.toolCallId);
    if(i>=0)list[i]={...list[i],pending:false,isError:e.isError};
  }
  if(e.type==='run-end'){
    for(let i=0;i<list.length;i++)if(list[i].id.startsWith(`${e.runId}:`))list[i]={...list[i],pending:false};
    if(e.error)put({id:`${e.runId}:error`,role:'tool',toolName:'error',text:e.error,isError:true});
  }
  return list;
}

export function snapshotMessages(snapshot:SessionSnapshot):HistoryEntry[] {
  const run=snapshot.run;
  return run && ['completed','failed','cancelled','interrupted'].includes(run.status)
    ? applyChatEvent(snapshot.messages,{type:'run-end',sessionId:run.sessionId,runId:run.id,status:run.status,error:run.error})
    : snapshot.messages;
}
