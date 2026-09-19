import { create } from 'zustand'
import type { CorpusStats, MachineInfo, Settings, Source, Utterance } from '../shared/types'
type Route='setup'|'radio'|'library'
interface State{route:Route;stats?:CorpusStats;sources:Source[];history:Utterance[];settings?:Settings;machine?:MachineInfo;setRoute:(route:Route)=>void;refresh:()=>Promise<void>}
export const useStore=create<State>((set)=>({route:'radio',sources:[],history:[],setRoute:route=>set({route}),refresh:async()=>{const[stats,sources,history,settings,machine]=await Promise.all([window.bridge.corpus.stats(),window.bridge.corpus.sources(),window.bridge.history.list(100,0),window.bridge.settings.get(),window.bridge.setup.detect()]);set({stats,sources,history,settings,machine,route:stats.clipCount?'radio':'setup'})}}))
