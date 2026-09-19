import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type Bridge } from '../shared/ipc'

const invoke=(channel:string,...args:unknown[])=>ipcRenderer.invoke(channel,...args)
const bridge: Bridge = {
  corpus:{stats:()=>invoke(IPC.stats),sources:()=>invoke(IPC.sources),lookup:k=>invoke(IPC.lookup,k),clipAudio:id=>invoke(IPC.clipAudio,id),fxAudio:n=>invoke(IPC.fxAudio,n)},
  reply:{generate:i=>invoke(IPC.generate,i)},
  ingest:{pickFolder:()=>invoke(IPC.pickFolder),start:f=>invoke(IPC.startIngest,f),cancel:id=>invoke(IPC.cancelIngest,id),onProgress:cb=>{const h=(_:unknown,p:Parameters<typeof cb>[0])=>cb(p);ipcRenderer.on(IPC.ingestProgress,h);return()=>ipcRenderer.removeListener(IPC.ingestProgress,h)}},
  history:{list:(l,o)=>invoke(IPC.historyList,l,o),save:u=>invoke(IPC.historySave,u),remove:id=>invoke(IPC.historyRemove,id),clear:()=>invoke(IPC.historyClear)},
  settings:{get:()=>invoke(IPC.settingsGet),set:p=>invoke(IPC.settingsSet,p),pickExportFolder:()=>invoke(IPC.pickExport)},
  setup:{detect:()=>invoke(IPC.detect),pullWhisper:m=>invoke(IPC.pullWhisper,m),pullOllama:m=>invoke(IPC.pullOllama,m),onPullProgress:cb=>{const h=(_:unknown,p:Parameters<typeof cb>[0])=>cb(p);ipcRenderer.on(IPC.pullProgress,h);return()=>ipcRenderer.removeListener(IPC.pullProgress,h)}},
  review:{next:f=>invoke(IPC.reviewNext,f),tag:(id,t)=>invoke(IPC.reviewTag,id,t),reject:id=>invoke(IPC.reviewReject,id)},
  exportAudio:{write:(b,e,s,r)=>invoke(IPC.exportWrite,b,e,s,r)}
}
contextBridge.exposeInMainWorld('bridge',bridge)
