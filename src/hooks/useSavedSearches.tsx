import { useMasterCv } from './useMasterCv'
import { withLocalMutation } from '../lib/localMutation'
import { searchHasLiveSource, validateSearchSource } from '../lib/cvSources'
import { normalizeLibrary } from '../types/cv'
import { CV_LIBRARY_EVENT, recoverCvTransaction } from '../lib/cvLibrary'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from 'react'
import { rowToSavedSearch, savedSearchToRow } from '../lib/database'
import { supabase } from '../lib/supabase'
import { coalesceSearchQuery } from '../lib/adzunaQuery'
import {
  createEmptySavedSearch,
  DEFAULT_SAVED_SEARCHES,
  type SavedSearch,
} from '../types/job'
import { useAuth } from './useAuth'

const LOCAL_KEY = 'applytrack-saved-searches'
const SEEDED_KEY = 'applytrack-searches-seeded-v2'

function seededStorageKey(userId?: string | null): string {
  return userId ? `${SEEDED_KEY}:${userId}` : SEEDED_KEY
}

function hasSeeded(userId?: string | null): boolean {
  return localStorage.getItem(seededStorageKey(userId)) === '1'
}

function markSeeded(userId?: string | null): void {
  localStorage.setItem(seededStorageKey(userId), '1')
}

function normalizeSearch(
  search: SavedSearch & {
    whatOr?: string
    whatAnd?: string
    whatPhrase?: string
  },
  fallbackOrder = 0
): SavedSearch {
  const query = coalesceSearchQuery({
    query: search.query ?? '',
    whatOr: search.whatOr ?? '',
    whatAnd: search.whatAnd ?? '',
    whatPhrase: search.whatPhrase ?? '',
  })
  const track =
    typeof search.track === 'string' && search.track.trim()
      ? search.track
      : /power\s*(platform|apps|automate)|dataverse/i.test(query)
        ? 'powerPlatform'
        : /react|front\s*end|frontend|typescript/i.test(query)
          ? 'frontend'
          : 'auto'

  return {
    id: search.id,
    label: search.label ?? '',
    query,
    location: search.location ?? '',
    country: search.country || 'ca',
    maxDaysOld: search.maxDaysOld ?? 7,
    excludeTerms: search.excludeTerms ?? '',
    track,
    active: search.needsCvSelection ? false : search.active !== false,
    needsCvSelection: search.needsCvSelection === true,
    sortOrder: typeof search.sortOrder === 'number' ? search.sortOrder : fallbackOrder,
    createdAt: search.createdAt,
    updatedAt: search.updatedAt,
  }
}

/** Stable display / refresh order; reindexes 0..n-1. */
function sortSearches(searches: SavedSearch[]): SavedSearch[] {
  const sorted = [...searches].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.createdAt.localeCompare(b.createdAt)
  })
  return sorted.map((s, i) => (s.sortOrder === i ? s : { ...s, sortOrder: i }))
}

interface SavedSearchesContextValue {
  searches: SavedSearch[]
  loading: boolean
  addSearch: (search: SavedSearch) => Promise<void>
  updateSearch: (id: string, updates: Partial<SavedSearch>) => Promise<void>
  deleteSearch: (id: string) => Promise<void>
  /** Pause every search except this one (for testing one query at a time). */
  activateOnly: (id: string) => Promise<void>
  /** Activate every saved search. Returns the updated list for immediate refresh. */
  activateAll: () => Promise<SavedSearch[]>
  /** Persist a new order after drag-and-drop (fromIndex → toIndex). */
  reorderSearches: (fromIndex: number, toIndex: number) => Promise<void>
  seedDefaults: () => Promise<void>
}

const SavedSearchesContext = createContext<SavedSearchesContextValue | null>(null)

function readLocal(): SavedSearch[] {
  recoverCvTransaction(localStorage)
  try {
    const stored = localStorage.getItem(LOCAL_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored) as SavedSearch[]
    return sortSearches(parsed.map((s, i) => normalizeSearch(s, i)))
  } catch {
    return []
  }
}

function writeLocal(searches: SavedSearch[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(searches))
}

function buildDefaultSearches(): SavedSearch[] {
  const now = new Date().toISOString()
  return DEFAULT_SAVED_SEARCHES.map((s, i) =>
    createEmptySavedSearch({ ...s, sortOrder: s.sortOrder ?? i, createdAt: now, updatedAt: now })
  )
}

export function SavedSearchesProvider({ children }: { children: ReactNode }) {
  const { user, isCloudEnabled } = useAuth()
  const {library} = useMasterCv()
  const owner=isCloudEnabled ? user?.id ?? 'signed-out' : 'local'
  const live=useRef({owner,library}); live.current={owner,library}
  const queue=useRef<Promise<unknown>>(Promise.resolve())
  const version=useRef(0)
  const [searches,setSearches]=useState<SavedSearch[]>([])
  const [loading,setLoading]=useState(true)
  const cloud=isCloudEnabled && Boolean(user)
  const readCloud=useCallback(async()=>{
    const {data,error}=await supabase!.from('saved_searches').select('*').eq('user_id',user!.id).order('sort_order')
    if(error)throw error
    return sortSearches((data??[]).map((row,i)=>normalizeSearch(rowToSavedSearch(row),i)))
  },[user])
  const load=useCallback(async()=>{
    const attempt=++version.current, account=owner
    setLoading(true)
    try {
      let next=cloud ? await readCloud() : await withLocalMutation(readLocal)
      if(live.current.owner!==account || attempt!==version.current)return
      if(!next.length && !hasSeeded(user?.id)) {
        next=buildDefaultSearches()
        if(cloud){const {error}=await supabase!.from('saved_searches').insert(next.map(s=>savedSearchToRow(s,user!.id)));if(error)throw error}
        else next=await withLocalMutation(()=>{if(live.current.owner!==account)throw new Error('Account changed');const latest=readLocal();if(latest.length)return latest;writeLocal(next);return next})
      }
      if(live.current.owner!==account || attempt!==version.current)return
      markSeeded(user?.id);setSearches(next)
    } catch(error) {if(live.current.owner===account)console.error('Could not load saved searches',error)}
    finally {if(live.current.owner===account && attempt===version.current)setLoading(false)}
  },[cloud,readCloud,owner,user])
  const invalidateLoad=useCallback(()=>{version.current++},[])
  useEffect(()=>{setSearches([]);void load();const refresh=()=>{void load()};const storage=(event:StorageEvent)=>{if(!cloud && ['applytrack-saved-searches','applytrack-master-cv'].includes(event.key??''))refresh()};window.addEventListener(CV_LIBRARY_EVENT,refresh);window.addEventListener('storage',storage);return()=>{invalidateLoad();window.removeEventListener(CV_LIBRARY_EVENT,refresh);window.removeEventListener('storage',storage)}},[load,invalidateLoad,cloud])
  const mutate=useCallback((change:(current:SavedSearch[])=>SavedSearch[])=>{
    const account=owner
    const check=()=>{if(live.current.owner!==account || account==='signed-out')throw new Error('Account changed')}
    const operation=queue.current.catch(()=>{}).then(async()=>{
      check();version.current++
      let next:SavedSearch[]
      if(cloud){
        const before=await readCloud();check()
        next=sortSearches(change(before))
        next.forEach(search=>validateSearchSource(live.current.library,search))
        for(const search of next){
          const old=before.find(s=>s.id===search.id)
          const after=savedSearchToRow(search,user!.id)
          if(!old){const {error}=await supabase!.from('saved_searches').insert(after);if(error)throw error}
          else {
            const previous=savedSearchToRow(old,user!.id)
            const patch=Object.fromEntries(Object.entries(after).filter(([key,value])=>key!=='updated_at' && JSON.stringify(value)!==JSON.stringify(previous[key as keyof typeof previous])))
            if(Object.keys(patch).length){const {error}=await supabase!.from('saved_searches').update({...patch,updated_at:new Date().toISOString()}).eq('id',search.id).eq('user_id',user!.id);if(error)throw error}
          }
          check()
        }
        const removed=before.filter(s=>!next.some(n=>n.id===s.id)).map(s=>s.id)
        if(removed.length){const {error}=await supabase!.from('saved_searches').delete().eq('user_id',user!.id).in('id',removed);if(error)throw error}
        next=await readCloud()
      } else next=await withLocalMutation(()=>{
        check();const current=readLocal();const updated=sortSearches(change(current))
        const currentLibrary=normalizeLibrary(JSON.parse(localStorage.getItem('applytrack-master-cv')??'null'))
        updated.forEach(search=>validateSearchSource(currentLibrary,search));writeLocal(updated);return updated
      })
      check();version.current++;markSeeded(user?.id);setSearches(next);setLoading(false);return next
    })
    queue.current=operation.catch(()=>{});return operation
  },[owner,cloud,readCloud,user])
  const addSearch=useCallback(async(search:SavedSearch)=>{await mutate(current=>[...current,normalizeSearch({...search,needsCvSelection:false,sortOrder:current.length})])},[mutate])
  const updateSearch=useCallback(async(id:string,updates:Partial<SavedSearch>)=>{await mutate(current=>current.map(search=>{
    if(search.id!==id)return search
    const reselected=search.needsCvSelection && updates.track!==undefined && updates.track!==search.track
    return {...search,...updates,...(reselected?{needsCvSelection:false,active:false}:{}),updatedAt:new Date().toISOString()}
  }))},[mutate])
  const deleteSearch=useCallback(async(id:string)=>{await mutate(current=>current.filter(search=>search.id!==id))},[mutate])
  const activateOnly=useCallback(async(id:string)=>{await mutate(current=>{
    const selected=current.find(s=>s.id===id)
    if(!selected || !searchHasLiveSource(live.current.library,selected))throw new Error('Choose a CV for this search before running it.')
    return current.map(s=>({...s,active:s.id===id}))
  })},[mutate])
  const activateAll=useCallback(()=>mutate(current=>current.map(s=>({...s,active:searchHasLiveSource(live.current.library,s)}))),[mutate])
  const reorderSearches=useCallback(async(from:number,to:number)=>{await mutate(current=>{
    if(from<0||to<0||from>=current.length||to>=current.length)return current
    const next=[...current];next.splice(to,0,...next.splice(from,1));return next.map((s,i)=>({...s,sortOrder:i}))
  })},[mutate])
  const seedDefaults=useCallback(async()=>{for(const search of buildDefaultSearches())await addSearch(search)},[addSearch])
  const value=useMemo(()=>({searches,loading,addSearch,updateSearch,deleteSearch,activateOnly,activateAll,reorderSearches,seedDefaults}),[searches,loading,addSearch,updateSearch,deleteSearch,activateOnly,activateAll,reorderSearches,seedDefaults])
  return <SavedSearchesContext.Provider value={value}>{children}</SavedSearchesContext.Provider>
}
export function useSavedSearches() {
  const context = useContext(SavedSearchesContext)
  if (!context) throw new Error('useSavedSearches must be used within SavedSearchesProvider')
  return context
}
