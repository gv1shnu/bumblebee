import { describe, expect, it } from 'vitest'
import { mulberry32 } from './audio'
describe('seeded audio randomness',()=>{it('replays an identical sequence',()=>{const a=mulberry32(42),b=mulberry32(42);expect([a(),a(),a()]).toEqual([b(),b(),b()])})})
